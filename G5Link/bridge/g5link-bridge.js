#!/usr/bin/env node
// G5Link bridge: connects the FS25_G5Link mod to the G5 web display.
//
//   FS25 mod --(telemetry.xml)--> bridge --(Server-Sent Events)--> iPad browser
//   iPad --(POST /api/cmd)--> bridge --(commands.xml)--> FS25 mod
//
// Zero dependencies. Requires Node.js 18+.
//
// Usage:
//   node g5link-bridge.js                 watch the game (default folder)
//   node g5link-bridge.js --demo          fake data, no game needed (tractor + planter)
//   node g5link-bridge.js --demo combine  fake combine with Realistic Harvesting data
//   node g5link-bridge.js --demo tillage  fake tractor + field cultivator (Cultivator Settings, Realistic Tillage depth)
//   node g5link-bridge.js --demo --demo-speed 8   run the demo 8x faster (to see maps fill quickly)
//   node g5link-bridge.js --dir <folder>  custom modSettings/FS25_G5Link folder
//   node g5link-bridge.js --port 8765

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------- options
const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const DEMO_OPT = opt('demo', false);
const DEMO = DEMO_OPT !== false;
const DEMO_BIG = DEMO_OPT === 'bigfield';           // stress test: a 1500 ac odd-shaped field, 4 headland laps (demo-bigfield.js)
const DEMO_COMBINE = DEMO_OPT === 'combine' || DEMO_BIG;
const DEMO_TILLAGE = DEMO_OPT === 'tillage';
const DEMO_SPEED = Math.max(1, Math.min(60, Number(opt('demo-speed', 1)) || 1)); // demo time multiplier
const PORT = Number(opt('port', 8765));
const DEFAULT_DIR = path.join(os.homedir(), 'Documents', 'My Games', 'FarmingSimulator2025',
  'modSettings', 'FS25_G5Link');
const DIR = String(opt('dir', DEFAULT_DIR));
const TELEMETRY = path.join(DIR, 'telemetry.xml');
const COMMANDS = path.join(DIR, 'commands.xml');
const PROVIDERS = path.join(DIR, 'providers.json'); // other mods: soil, Courseplay, AutoDrive, mud (1 Hz)
const COURSE = path.join(DIR, 'course.json');       // Courseplay course + field boundary (on change)
const FIELDS = path.join(DIR, 'fields.json');       // map fields with polygons and owners (on change)
const EQUIPMENT = path.join(DIR, 'equipment.json'); // the farm's machines (every 5 s)
const ECONOMY = path.join(DIR, 'economy.json');
const RTK = path.join(DIR, 'rtk.json');
const FLEET = path.join(DIR, 'fleet.xml');         // other working machines (AI workers, Courseplay), every 0.5 s             // RTK package: receivers, subscriptions, bases, ledger (on change)     // prices, input costs, farm finances (every 30 s)
const PROVIDER_STALE_MS = 6000;
const APP_DIR = path.resolve(__dirname, '..', 'app');
const STALE_MS = 3000; // no new seq for this long => game considered paused/closed
const { CoverageStore } = require('./coverage.js');
const { FieldStore, simplifyRing } = require('./fields.js');
const { HeadlandLink } = require('./headland.js');
let headlandLink = null;
const headland = () => headlandLink || (headlandLink = new HeadlandLink({ dir: DIR, write: !DEMO }));

// ---------------------------------------------------------------- tiny XML parser
// Handles the flat, attribute-only XML the mod writes. Not a general parser.
function decodeEntities(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    switch (e.toLowerCase()) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    return e[1].toLowerCase() === 'x'
      ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : String.fromCodePoint(parseInt(e.slice(1), 10));
  });
}
function typed(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v)) return Number(v);
  return v;
}
function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const [, closing, name, attrText, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { name, attrs: {}, children: [] };
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(attrText)) !== null) node.attrs[a[1]] = typed(decodeEntities(a[2]));
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('unbalanced XML (partial write?)');
  return root.children[0];
}
function child(node, name) { return node && node.children.find(c => c.name === name); }
function children(node, name) { return node ? node.children.filter(c => c.name === name) : []; }

function telemetryFromXml(text) {
  const g5 = parseXml(text);
  if (!g5 || g5.name !== 'g5') throw new Error('not a G5Link telemetry file');
  const implementsNode = child(g5, 'implements');
  return {
    seq: g5.attrs.seq,
    version: g5.attrs.version,
    state: g5.attrs.state,       // vehicle | onfoot | unloaded
    time: g5.attrs.time,
    lastCmd: g5.attrs.lastCmd || 0,
    game: (child(g5, 'game') || {}).attrs || {},
    vehicle: (child(g5, 'vehicle') || {}).attrs || null,
    work: (child(g5, 'work') || {}).attrs || {},
    implements: children(implementsNode, 'implement').map(n => ({
      ...n.attrs,
      areas: String(n.attrs.areas ?? '').split('').map(c => c === '1'),
      fills: children(n, 'fill').map(f => f.attrs),
      geometry: children(n, 'area').map(a => a.attrs),
      seeder: seederFromNode(child(n, 'seeder')),
      section: sectionFromNode(child(n, 'section')),
      tillage: (child(n, 'tillage') || {}).attrs || null,
    })),
    combine: (child(g5, 'combine') || {}).attrs || null,
    rh: rhFromNode(child(g5, 'rh')),
    controls: controlsFromNode(child(g5, 'controls')),
    headland: (child(g5, 'headland') || {}).attrs || null,
    grainCart: (child(g5, 'grainCart') || {}).attrs || null,
    gnss: gnssFromNode(child(g5, 'gnss')),
    autotrac: (child(g5, 'autotrac') || {}).attrs || null,
    rate: (child(g5, 'rate') || {}).attrs || null,
    section: (child(g5, 'section') || {}).attrs || null,
    harvestAuto: (child(g5, 'harvestAuto') || {}).attrs || null,
  };
}

// RTK package: the driven machine's receiver, correction, error, base, gates and the last rtk command result.
function gnssFromNode(n) {
  if (!n) return null;
  return { ...n.attrs, gate: (child(n, 'gate') || {}).attrs || {}, result: (child(n, 'result') || {}).attrs || null };
}

// fleet.xml: every other working machine, each shaped like a telemetry frame so the recorder can map it.
function fleetFromXml(text) {
  const root = parseXml(text);
  if (!root || root.name !== 'fleet') throw new Error('not a G5Link fleet file');
  return { seq: root.attrs.seq, vehicles: children(root, 'vehicle').map(n => ({
    id: String(n.attrs.id),
    vehicle: { ...n.attrs },
    implements: children(child(n, 'implements'), 'implement').map(m => ({
      ...m.attrs,
      areas: String(m.attrs.areas ?? '').split('').map(c => c === '1'),
      fills: children(m, 'fill').map(f => f.attrs),
      geometry: children(m, 'area').map(a => a.attrs),
      seeder: seederFromNode(child(m, 'seeder')),
      section: sectionFromNode(child(m, 'section')),
      tillage: (child(m, 'tillage') || {}).attrs || null,
    })),
    combine: (child(n, 'combine') || {}).attrs || null,
    rh: rhFromNode(child(n, 'rh')),
  })) };
}
let fleetSeq = null, fleetSeen = new Set(), fleet = [];
function pollFleet() {
  let text;
  try { text = fs.readFileSync(FLEET, 'utf8'); } catch (e) { return; }
  let f;
  try { f = fleetFromXml(text); } catch (e) { return; }   // half-written: next poll
  if (f.seq === fleetSeq) return;
  fleetSeq = f.seq;
  takeFleet(f.vehicles);
}
// Records each working machine's coverage under its own id; machines that stopped are closed off.
function takeFleet(vehicles) {
  const seen = new Set();
  for (const fv of vehicles) {
    seen.add(fv.id);
    const frame = { state: 'vehicle', game: latest.game, workSetup: latest.workSetup, providers: null, vehicle: fv.vehicle,
      implements: fv.implements, combine: fv.combine, rh: fv.rh };
    try { mapStore().onFrame(frame, 'm:' + fv.id); } catch (e) { console.warn('Fleet map recording failed:', e.message); }
  }
  for (const id of fleetSeen) if (!seen.has(id)) { try { mapStore().onFrame(null, 'm:' + id); } catch (e) { /* ignore */ } }
  fleetSeen = seen;
  fleet = vehicles.map(v => ({ id: v.id, name: v.vehicle.name, ai: v.vehicle.ai, x: v.vehicle.x, z: v.vehicle.z, field: v.vehicle.field,
    working: v.implements.some(i => i.areas.some(Boolean)) }));
}

// Shortcut key state: lights, beacon, hazard, unloading pipe and fold (absent when the machine has none).
function controlsFromNode(n) {
  if (!n) return null;
  return { ...n.attrs, pipe: (child(n, 'pipe') || {}).attrs || null, fold: (child(n, 'fold') || {}).attrs || null };
}

// Realistic Seeder block (per implement): attributes plus per-row readings.
function seederFromNode(n) {
  if (!n) return null;
  return { ...n.attrs, rows: children(n, 'row').map(r => r.attrs) };
}

// Row/section shutoff of one implement (Realistic Seeder 2.6+): lane states 1 on, 0 off, a = shut off automatically.
function sectionFromNode(n) {
  if (!n) return null;
  return { ...n.attrs, states: String(n.attrs.rows ?? '').split('') };
}

// Realistic Harvesting block: attributes plus settings and the trip odometer.
function rhFromNode(n) {
  if (!n) return null;
  return {
    ...n.attrs,
    settings: children(n, 'setting').map(c => c.attrs),
    trip: (child(n, 'trip') || {}).attrs || null,
  };
}

// ---------------------------------------------------------------- state + SSE
let latest = { state: 'waiting', link: 'waiting' };
let lastSeq = null;
let lastSeqAt = 0;
const clients = new Set();

function broadcast() {
  const payload = 'data: ' + JSON.stringify(latest) + '\n\n';
  for (const res of clients) res.write(payload);
}

// Data from other mods arrives in providers.json and is merged into every frame.
let extras = { providers: null, providerStatus: null, providerSource: null, field: null, courseKey: null };
let extrasAt = 0;
let course = { key: null, waypoints: [], field: [] };
function setExtras(frame) {
  extras = {
    providers: frame.providers && typeof frame.providers === 'object' && !Array.isArray(frame.providers) ? frame.providers : {},
    providerStatus: frame.status && !Array.isArray(frame.status) ? frame.status : {},
    providerSource: frame.source || null,
    field: frame.fieldId ?? null,
    courseKey: frame.courseKey ?? null,
  };
  extrasAt = Date.now();
}
function currentExtras() {
  if (!DEMO && extrasAt && Date.now() - extrasAt > PROVIDER_STALE_MS) return { ...extras, providers: null };
  return extras;
}

// Coverage and map layers (see coverage.js). In demo mode nothing is written to disk.
let maps = null;
function mapStore() {
  if (!maps) maps = new CoverageStore({ dir: DIR, persist: !DEMO });
  return maps;
}

// ---------------------------------------------------------------- Ops Center: fields, equipment, boundary recording
let ops = null;
function fieldStore() {
  if (!ops) ops = new FieldStore({ dir: DIR, persist: !DEMO, coverage: mapStore() });
  return ops;
}
const currentSave = () => (latest.game && latest.game.save) || 'unsaved';
let gameFields = null, gameFieldsSave = null;          // fields.json waits until the savegame is known
let equipment = { vehicles: [] }, equipmentAt = 0;
let economy = null;
function takeGameFields(json) {
  gameFields = json; gameFieldsSave = null;
  if (latest.state === 'vehicle' || latest.state === 'onfoot') importGameFields();
}
function importGameFields() {
  if (!gameFields || gameFieldsSave === currentSave()) return;
  gameFieldsSave = currentSave();
  fieldStore().importGame(gameFieldsSave, gameFields);
}

// Driven boundary: positions of the vehicle (or offset to the implement edge) while recording.
let rec = { active: false };
function boundaryFrame(t) {
  if (!rec.active || rec.paused || !t.vehicle || typeof t.vehicle.x !== 'number') return;
  const h = (t.vehicle.heading || 0) * Math.PI / 180, r = { x: Math.cos(h), z: Math.sin(h) };
  const side = rec.side === 'left' ? -1 : rec.side === 'right' ? 1 : 0;
  const x = t.vehicle.x + r.x * rec.offset * side, z = t.vehicle.z + r.z * rec.offset * side;
  const last = rec.points[rec.points.length - 1];
  if (last && Math.hypot(x - last[0], z - last[1]) < 1) return;
  if (last) rec.length += Math.hypot(x - last[0], z - last[1]);
  if (rec.points.length < 20000) rec.points.push([+x.toFixed(2), +z.toFixed(2)]);
}
function boundaryStatus() {
  if (!rec.active) return { active: false, saved: rec.saved || null };
  const first = rec.points[0], last = rec.points[rec.points.length - 1];
  return { active: true, paused: !!rec.paused, points: rec.points.length, length: Math.round(rec.length), side: rec.side, offset: rec.offset,
    fieldId: rec.fieldId, name: rec.name, gap: first && last ? Math.round(Math.hypot(first[0] - last[0], first[1] - last[1])) : null };
}
function boundaryCommand(c) {
  const a = c.action;
  if (a === 'start') {
    rec = { active: true, paused: false, points: [], length: 0, side: ['left', 'right'].includes(c.side) ? c.side : 'center',
      offset: Math.max(0, Math.min(30, Number(c.offset) || 0)), fieldId: c.fieldId ? String(c.fieldId) : null, name: c.name ? String(c.name).slice(0, 60) : null,
      newField: !c.fieldId };
    return boundaryStatus();
  }
  if (!rec.active) throw new Error('not recording');
  if (a === 'pause') rec.paused = true;
  else if (a === 'resume') rec.paused = false;
  else if (a === 'cancel') rec = { active: false };
  else if (a === 'finish') {
    if (rec.points.length < 3 || rec.length < 30) throw new Error('drive at least 30 m around the field before saving');
    const polygon = simplifyRing(rec.points, 0.5);
    const r = fieldStore().addBoundary(currentSave(), { fieldId: rec.fieldId, name: rec.name, source: 'driven', polygon, newField: rec.newField });
    rec = { active: false, saved: r };
    return { active: false, saved: r };
  } else throw new Error('unknown action');
  return boundaryStatus();
}

function setTelemetry(t) {
  const fresh = t.seq !== lastSeq;
  if (fresh) {
    lastSeq = t.seq;
    lastSeqAt = Date.now();
  }
  latest = { ...t, ...currentExtras(), link: 'live' };
  try { latest.workSetup = fieldStore().workSetup(currentSave()); } catch (e) { latest.workSetup = null; }
  if (fresh) {
    try { mapStore().onFrame(latest); } catch (e) { console.warn('Map recording failed:', e.message); }
    try { boundaryFrame(latest); importGameFields(); } catch (e) { console.warn('Field update failed:', e.message); }
    try { headland().update(latest, fieldStore(), currentSave(), mapStore()); } catch (e) { console.warn('Headland update failed:', e.message); }
  }
  latest.headlandLink = headland().status;
  try { syncRx(); } catch (e) { /* store not ready */ }
  latest.fleet = fleet;
  latest.rtkInfo = DEMO ? demoRtkSummary() : rtkState ? { day: rtkState.day, payer: rtkState.payer || null, gates: rtkState.gates, bases: (rtkState.bases || []).length } : null;
  if (DEMO) latest.headland = demoHeadland(latest);
  latest.map = mapStore().status();
  latest.ops = { fields: fieldStore().version, boundary: boundaryStatus() };
  broadcast();
}

// Heartbeat: flag the game as stale if the file stops changing.
function heartbeat() {
  if (DEMO) return;
  const stale = lastSeqAt && Date.now() - lastSeqAt > STALE_MS;
  const link = !lastSeqAt ? 'waiting' : stale ? 'stale' : 'live';
  if (link !== latest.link) {
    latest = { ...latest, link };
    broadcast();
  }
  for (const res of clients) res.write(': ping\n\n');
}

// ---------------------------------------------------------------- game file watcher
let lastMtime = 0;
let parseErrors = 0;
function pollTelemetry() {
  fs.stat(TELEMETRY, (err, st) => {
    if (err || st.mtimeMs === lastMtime) return;
    lastMtime = st.mtimeMs;
    fs.readFile(TELEMETRY, 'utf8', (err2, text) => {
      if (err2) return;
      try {
        setTelemetry(telemetryFromXml(text));
        parseErrors = 0;
      } catch (e) {
        // The game may be mid-write; the next poll will pick up the full file.
        if (++parseErrors === 20) console.warn('Telemetry unreadable for a while:', e.message);
        lastMtime = 0;
      }
    });
  });
}

// JSON files written by the mod (providers.json, course.json). A half-written file fails to
// parse; the mtime is reset so the next poll reads it again.
function jsonPoller(file, onData) {
  let mtime = 0;
  return () => fs.stat(file, (err, st) => {
    if (err || st.mtimeMs === mtime) return;
    mtime = st.mtimeMs;
    fs.readFile(file, 'utf8', (err2, text) => {
      if (err2) return;
      try { onData(JSON.parse(text)); } catch (e) { mtime = 0; }
    });
  });
}
const pollProviders = jsonPoller(PROVIDERS, frame => {
  setExtras(frame);
  latest = { ...latest, ...currentExtras() };
  broadcast();
});
const pollFields = jsonPoller(FIELDS, takeGameFields);
let rtkState = null;
const pollRtk = jsonPoller(RTK, r => { rtkState = r && typeof r === 'object' ? r : null; });
const pollEconomy = jsonPoller(ECONOMY, e => { economy = e && typeof e === 'object' ? e : null; });
const pollEquipment = jsonPoller(EQUIPMENT, e => { equipment = e && Array.isArray(e.vehicles) ? e : { vehicles: [] }; equipmentAt = Date.now(); });
const pollCourse = jsonPoller(COURSE, c => { course = { key: c.key ?? null, name: c.name, workWidth: c.workWidth, waypoints: c.waypoints || [], field: c.field || [] }; });

// ---------------------------------------------------------------- prescriptions -> rx.xml (RateControl.lua)
let rxV = 0, rxKey = null;
function syncRx() {
  let rx = null;
  try { rx = fieldStore().activeRx(currentSave()); } catch (e) { return; }
  const key = rx ? rx.id + '|' + rx.rates.join(',') + '|' + currentSave() : 'none|' + currentSave();
  if (key === rxKey) return;
  rxKey = key; rxV++;
  if (DEMO) return;
  const file = path.join(DIR, 'rx.xml');
  try {
    if (!rx) { fs.writeFileSync(file, `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<rx v="${rxV}" active="false"/>\n`); return; }
    const a = v => String(v).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = fieldStore().rxRows(rx).map((row, i) => `  <r i="${i}" m="${row.join(',')}"/>`).join('\n');
    fs.writeFileSync(file + '.tmp', `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<rx v="${rxV}" id="${a(rx.id)}" name="${a(rx.name)}" field="${a(rx.fieldId)}" cell="${rx.cell}" ox="${rx.ox}" oz="${rx.oz}" cols="${rx.cols}" active="true">\n${rows}\n</rx>\n`);
    fs.renameSync(file + '.tmp', file);
  } catch (e) { console.warn('Could not write rx.xml:', e.message); }
}

// ---------------------------------------------------------------- AutoTrac guidance (to the mod's Steering.lua)
// The display posts its selected track, spacing, shift and Turn Automation settings; the mod reads guidance.xml.
let guidanceState = null, guidanceV = 0, guidanceKey = '';
function setGuidance(g) {
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  const t = g && g.track && num(g.track.ax, -1e6, 1e6) !== null && num(g.track.az, -1e6, 1e6) !== null && num(g.track.h, -720, 720) !== null
    ? { id: String(g.track.id || ''), name: String(g.track.name || '').slice(0, 60), ax: g.track.ax, az: g.track.az, h: g.track.h } : null;
  const turn = g && g.turn || {};
  const next = { track: t, spacing: num(g && g.spacing, 0.5, 200) || 0, shift: num(g && g.shift, -1000, 1000) || 0,
    steerOn: !(g && g.steerOn === false), sens: Math.round(num(g && g.sens, 50, 200) || 70),
    turn: { on: turn.on === true, skip: Math.round(num(turn.skip, 0, 10) || 0), dir: ['left', 'right'].includes(turn.dir) ? turn.dir : 'auto',
      radius: num(turn.radius, 0, 50) || 0 } };
  const key = JSON.stringify(next);
  if (key === guidanceKey) return guidanceState;
  guidanceKey = key; guidanceState = next; guidanceV++;
  if (!DEMO) {
    const a = v => String(v).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
    const xml = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<guidance v="${guidanceV}" spacing="${next.spacing}" shift="${next.shift}" steerOn="${next.steerOn}" sens="${next.sens}">\n` +
      (t ? `  <track id="${a(t.id)}" name="${a(t.name)}" ax="${t.ax}" az="${t.az}" h="${t.h}"/>\n` : '') +
      `  <turn on="${next.turn.on}" skip="${next.turn.skip}" dir="${next.turn.dir}" radius="${next.turn.radius}"/>\n</guidance>\n`;
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'guidance.xml.tmp'), xml); fs.renameSync(path.join(DIR, 'guidance.xml.tmp'), path.join(DIR, 'guidance.xml')); }
    catch (e) { console.warn('Could not write guidance.xml:', e.message); }
  }
  return next;
}

// ---------------------------------------------------------------- commands
const ALLOWED = new Set(['motorToggle', 'cruiseToggle', 'cruiseSet', 'cruiseAdjust',
  'lowerAll', 'turnOnAll', 'implTurnOn', 'resetWork',
  'pipeToggle', 'foldToggle', 'lightsToggle', 'workLightsToggle', 'beaconToggle', 'hazardToggle',
  'harvestAuto', 'harvestAutoMax', 'tillageDepth', 'tillageDepthAdjust', 'tillageLevel', 'grainCart', 'grainCartNext', 'rtk', 'autotrac', 'rateAuto', 'rateStep', 'section', 'sectionOverlap']);
let cmdQueue = [];
let nextCmdId = 1;

function loadExistingCommandIds() {
  try {
    const root = parseXml(fs.readFileSync(COMMANDS, 'utf8'));
    for (const c of children(root, 'cmd')) nextCmdId = Math.max(nextCmdId, Number(c.attrs.id || 0) + 1);
  } catch { /* no file yet */ }
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeCommands() {
  const body = cmdQueue.map(c =>
    `    <cmd id="${c.id}" name="${escAttr(c.name)}" value="${Number(c.value) || 0}" index="${c.index | 0}"${c.arg ? ` arg="${escAttr(c.arg)}"` : ''}/>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<commands>\n${body}\n</commands>\n`;
  const tmp = COMMANDS + '.tmp';
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(tmp, xml);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.renameSync(tmp, COMMANDS); return; } catch (e) {
      if (attempt === 4) throw e; // file briefly locked by the game on Windows
    }
  }
}

function queueCommand(cmd) {
  if (!ALLOWED.has(cmd.name)) throw new Error('unknown command ' + cmd.name);
  // arg: "key=value;key=value" text for commands that need more than a number (rtk)
  const arg = typeof cmd.arg === 'string' ? cmd.arg.slice(0, 200).replace(/[^\w=;.\- ]/g, '') : '';
  const entry = { id: nextCmdId++, name: cmd.name, value: Number(cmd.value) || 0, index: cmd.index | 0, arg };
  if (DEMO) { demoCommand(entry); return entry; }
  cmdQueue.push(entry);
  if (cmdQueue.length > 30) cmdQueue = cmdQueue.slice(-30);
  writeCommands();
  return entry;
}

// ---------------------------------------------------------------- demo simulator
const demo = {
  t: 0, speed: 0, target: 11.5, motorOn: true, cc: 1, ccSpeed: 11.5, fuel: 512, def: 64,
  lowered: true, turnedOn: true, heading: 92, x: -120, z: 340, seed: 2800,
  tank: 3200, unloading: false, massKg: 0, lostKg: 0,
  lights: false, workLights: true, beacon: false, hazard: false, unfolded: true,
  auto: { on: false, max: 10, state: 'off', target: null, timer: 0 }, recSpeed: null,
  till: { level: 3, depth: 15, target: 15 },
  gc: { kind: 'waiting', paused: false, released: false, nudge: 0, nudgeX: 0, x: -60, z: 300, fill: 4000 },
  work: { area: 0, time: 0, distance: 0, totalDistance: 0, fuelUsed: 0, totalFuel: 0 },
};
function demoCommand(c) {
  switch (c.name) {
    case 'motorToggle': demo.motorOn = !demo.motorOn; break;
    case 'cruiseToggle': demo.cc = demo.cc ? 0 : 1; break;
    case 'cruiseSet': demo.ccSpeed = Math.max(1, Math.min(40, c.value)); break;
    case 'cruiseAdjust': demo.ccSpeed = Math.max(1, Math.min(40, demo.ccSpeed + c.value)); break;
    case 'lowerAll': demo.lowered = !demo.lowered; break;
    case 'turnOnAll': case 'implTurnOn': demo.turnedOn = !demo.turnedOn; break;
    case 'resetWork': Object.keys(demo.work).forEach(k => { demo.work[k] = 0; }); break;
    case 'lightsToggle': demo.lights = !demo.lights; break;
    case 'workLightsToggle': demo.workLights = !demo.workLights; break;
    case 'beaconToggle': demo.beacon = !demo.beacon; break;
    case 'hazardToggle': demo.hazard = !demo.hazard; break;
    case 'pipeToggle': if (DEMO_COMBINE) demo.unloading = !demo.unloading; break;
    case 'foldToggle': demo.unfolded = !demo.unfolded; if (!demo.unfolded) demo.lowered = false; break;
    case 'harvestAuto': {
      const on = c.value === 1 ? true : c.value === 0 ? false : !demo.auto.on;
      demo.auto = { ...demo.auto, on: on && DEMO_COMBINE, state: on && DEMO_COMBINE ? 'standby' : 'off', target: null, timer: 1000 };
      break;
    }
    case 'tillageDepth': demo.till.target = Math.max(2, Math.min(38, c.value));
      demo.till.level = c.value <= 10 ? 2 : c.value <= 22 ? 3 : 4; break;
    case 'tillageDepthAdjust': demo.till.target = Math.max(2, Math.min(38, demo.till.target + c.value)); break;
    case 'tillageLevel': demo.till.level = Math.max(2, Math.min(4, Math.round(c.value))); break;
    case 'grainCart': demoGrainCartCommand(c.index); break;
    case 'rateAuto': demo.rate = { ...(demo.rate || { idx: 3 }), auto: c.value === 1 }; break;
    case 'rateStep': demo.rate = { ...(demo.rate || { auto: false, idx: 3 }), idx: Math.max(1, Math.min(6, (demo.rate ? demo.rate.idx : 3) + (c.value > 0 ? 1 : -1))) }; break;
    case 'autotrac': {
      const want = c.value === 1 ? true : c.value === 0 ? false : !demo.at;
      const gs = guidanceState;
      const why = !want ? 'off' : !(gs && gs.track) ? 'noTrack' : !gs.steerOn ? 'steerOff' : null;
      demo.at = want && !why; demo.atExit = demo.at ? demo.atExit : why || demo.atExit;
      break;
    }
    case 'rtk': demoRtkCommand(c); break;
    case 'section': demo.section.on = c.value === 1 ? true : c.value === 0 ? false : !demo.section.on; break;
    case 'sectionOverlap': if ([0, 1, 2].includes(c.value)) demo.section.overlap = c.value; break;
    case 'grainCartNext': break;
    case 'harvestAutoMax': demo.auto.max = Math.max(1, Math.min(40, c.value)); break;
  }
  demo.lastCmd = c.id;
}
if (DEMO_COMBINE) { demo.ccSpeed = 6.2; demo.target = 6.2; }

// RTK package, simulated like Rtk.lua: SF1 free, subscriptions, an own base, pull-in, and the GNSS error.
const RTK_LEVELS = { NONE: [0.8, 600, 1.5], SF1: [0.086, 1800, 0.15], SF2: [0.029, 1800, 0.05], SF3: [0.017, 1800, 0.03], RTK: [0.012, 3600, 0.025] };
const RTK_PRICES = { SF2: 70, SF3: 120, MRTK: 130, SFRTK: 170, RTK: 2500, AUTOTRAC: 1500, SECTION: 1500, SF3000: 4000, SF6000: 7000, SF7000: 9000, SHOP_GPS: 1, BASE: 15000, BASE_UPKEEP: 10 };
// the demo farm has an RTK station built next to field 23 (already surveyed)
demo.rtkState = { receiver: 'SF6000', rtk: false, subs: [], bases: [{ id: 'placeable12', name: 'John Deere RTK Station', x: DEMO_BIG ? 0 : -40, z: DEMO_BIG ? -1600 : 250, farmId: 1, placedAt: -1e9 }],
  ledger: [], gates: true, prices: { ...RTK_PRICES }, nextBase: 1,
  ex: 0.05, ez: -0.04, startedAt: 0, rtkAt: null, level: 'SF1', src: 'SF1', accuracy: 1, result: null };
function demoRtkSummary() { const r = demo.rtkState; return { day: 3, payer: null, gates: r.gates, bases: r.bases.length }; }
function demoRtkState() {
  const r = demo.rtkState;
  return { save: 'demo', gates: r.gates, prices: r.prices, payer: null, baseRange: 3000, surveyMin: 120, gateLevels: { headland: 'SF2', grainCart: 'SF3' },
    vehicles: [{ id: 'demo1', name: DEMO_COMBINE ? 'Demo S7 Combine' : 'Demo 8R Tractor', farmId: 1, receiver: r.receiver,
      receiverName: r.receiver === 'SF7000' ? 'StarFire 7000' : 'StarFire 6000', hwSource: 'g5link', rtk: r.rtk, autotrac: !!r.autotrac, section: !!r.section, subs: r.subs,
      monthly: r.subs.reduce((a, k) => a + (r.prices[k] || 0), 0), level: r.level, src: r.src },
    { id: 'demo2', name: 'Demo 9RX Tractor', farmId: 1, receiver: 'SF3000', receiverName: 'StarFire 3000', hwSource: 'shop', hwOption: 'StarFire 3000', rtk: false, subs: [], monthly: 0, level: null, src: null },
    { id: 'demo3', name: 'Demo R4045 Sprayer', farmId: 1, receiver: 'SF7000', receiverName: 'StarFire 7000', hwSource: 'shop', hwOption: 'StarFire 7000 RTK', rtk: true, subs: ['SFRTK'], monthly: 170, level: null, src: null },
    { id: 'demo4', name: 'Demo Semi Truck', farmId: 1, receiver: 'NONE', receiverName: 'No GPS receiver', hwSource: 'shop', hwOption: 'No', rtk: false, subs: [], monthly: 0, level: null, src: null }],
    bases: r.bases.map(b => ({ ...b, state: demo.t - b.placedAt < 20000 ? 'survey' : 'ok', surveyLeftMin: Math.max(0, Math.ceil((20000 - (demo.t - b.placedAt)) / 1000)) })),
    ledger: r.ledger, day: 3,
    stationItems: [{ name: 'RTK Station Standalone', xml: 'mods/fs25_jd_rtkstations/rtkstandalone.xml', modPrice: 8800, modUpkeep: 15,
      price: r.prices.BASE || 8800, upkeep: r.prices.BASE ? r.prices.BASE_UPKEEP : 15 }] };
}
function demoRtkCommand(c) {
  const r = demo.rtkState, a = Object.fromEntries((c.arg || '').split(';').map(kv => kv.split('=')));
  const charge = (amount, kind, item, text) => r.ledger.push({ period: 4, day: 3, farmId: 1, amount, kind, item, paidBy: 'G5Link', text });
  let ok = true, error;
  if (a.action === 'sub') {
    if (a.on === '1' && a.item === 'SFRTK' && r.receiver !== 'SF7000') { ok = false; error = 'needsSF7000'; }
    else if (a.on === '1') { if (!r.subs.includes(a.item)) r.subs.push(a.item); if (a.item === 'SF3') r.subs = r.subs.filter(k => k !== 'SF2'); r.startedAt = demo.t; }
    else r.subs = r.subs.filter(k => k !== a.item);
  } else if (a.action === 'buy') {
    if (a.item === 'SF7000' && r.receiver !== 'SF7000') { r.receiver = 'SF7000'; charge(r.prices.SF7000, 'purchase', 'SF7000', 'StarFire 7000 receiver'); }
    else if (a.item === 'RTK' && !r.rtk) { r.rtk = true; charge(r.prices.RTK, 'purchase', 'RTK', 'RTK activation'); }
    else if (a.item === 'AUTOTRAC' && !r.autotrac) { r.autotrac = true; charge(r.prices.AUTOTRAC, 'purchase', 'AUTOTRAC', 'AutoTrac activation'); }
    else if (a.item === 'SECTION' && !r.section) { r.section = true; charge(r.prices.SECTION, 'purchase', 'SECTION', 'Section Control activation'); }
  } else if (a.action === 'gates') r.gates = a.on === '1';
  else if (a.action === 'price' && r.prices[a.item] !== undefined && Number(a.value) >= 0) r.prices[a.item] = Number(a.value);
  r.result = { id: c.id, ok, action: a.action, error };
}
function demoGnss(t, dt) {
  const r = demo.rtkState;
  let level = 'SF1', src = 'SF1', pull = 0;
  if (r.subs.includes('SFRTK') && r.receiver === 'SF7000') { level = 'RTK'; src = 'SF-RTK'; pull = 30000; }
  else if (r.subs.includes('SF3')) { level = 'SF3'; src = 'SF3'; pull = 24000; }
  else if (r.subs.includes('SF2')) { level = 'SF2'; src = 'SF2'; pull = 12000; }
  const base = r.bases[0], dist = base ? Math.hypot(base.x - demo.x, base.z - demo.z) : null;
  const baseOk = base && demo.t - base.placedAt >= 20000;
  if ((r.rtk && baseOk && dist <= 3000) || r.subs.includes('MRTK')) { level = 'RTK'; src = r.rtk && baseOk && dist <= 3000 ? 'RTK' : 'M-RTK'; pull = 0; }
  const accuracy = pull ? Math.min(1, (demo.t - r.startedAt) / pull) : 1;
  const [sig, tau] = RTK_LEVELS[level], s1 = RTK_LEVELS.SF1[0], sigma = pull ? s1 + (sig - s1) * accuracy : sig;
  if (level === 'RTK' && r.level !== 'RTK') { r.ex *= 0.1; r.ez *= 0.1; }
  const h = dt / 1000, k = Math.sqrt(2 * h / tau) * sigma * DEMO_SPEED;
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
  r.ex += -r.ex * h / tau + k * gauss(); r.ez += -r.ez * h / tau + k * gauss();
  Object.assign(r, { level, src, accuracy });
  const need = { headland: 'SF2', grainCart: 'SF3' }, rank = { NONE: 0, SF1: 1, SF2: 2, SF3: 3, RTK: 4 };
  const gates = Object.fromEntries(Object.entries(need).map(([f, l]) => [f, !r.gates || (rank[level] >= rank[l] && accuracy >= 1)]));
  // the G5 only knows the GNSS position
  t.vehicle.x = +(t.vehicle.x + r.ex).toFixed(2); t.vehicle.z = +(t.vehicle.z + r.ez).toFixed(2);
  for (const imp of t.implements || []) for (const g of imp.geometry || []) { g.sx += r.ex; g.wx += r.ex; g.hx += r.ex; g.sz += r.ez; g.wz += r.ez; g.hz += r.ez; }
  t.gnss = { receiver: r.receiver, receiverName: r.receiver === 'SF7000' ? 'StarFire 7000' : 'StarFire 6000', hwSource: 'g5link', rtkActivated: r.rtk, level, src, accuracy: Math.round(accuracy * 100), p2p: RTK_LEVELS[level][2], ex: +r.ex.toFixed(3), ez: +r.ez.toFixed(3),
    gate: gates, result: r.result, gates: r.gates };
  if (base) Object.assign(t.gnss, { base: base.name, baseState: baseOk ? 'ok' : 'survey', baseDist: Math.round(dist),
    baseBearing: Math.round((Math.atan2(base.x - demo.x, -(base.z - demo.z)) * 180 / Math.PI + 360) % 360), inRange: dist <= 3000 });
  return t;
}

// Courseplay Grain Cart add-on, simulated: the cart drives to the left of the combine, follows it under the
// pipe, fills while the auger is out, and drives off to a truck when told to unload.
function demoGrainCartCommand(i) {
  const g = demo.gc;
  if (i === 1) Object.assign(g, { kind: 'driving', paused: false, released: false });
  else if (i === 4) g.paused = !g.paused;
  else if (i === 5) Object.assign(g, { kind: 'waiting', released: true, paused: false, nudge: 0, nudgeX: 0 });
  else if (i === 6) Object.assign(g, { kind: 'goingToUnload', paused: false, nudge: 0, nudgeX: 0 });
  else if (i === 9) Object.assign(g, { kind: 'movingAway', released: true, paused: false, nudge: 0, nudgeX: 0 });
  else if (i === 2) g.nudge = Math.min(10, g.nudge + 1);
  else if (i === 3) g.nudge = Math.max(-10, g.nudge - 1);
  else if (i === 7) g.nudgeX = Math.min(5, g.nudgeX + 0.5);
  else if (i === 8) g.nudgeX = Math.max(-5, g.nudgeX - 0.5);
}
function demoGrainCart(dt) {
  const g = demo.gc, cap = 36000, h = demo.heading * Math.PI / 180;
  const fx = Math.sin(h), fz = -Math.cos(h);                       // forward (heading 0 = north = -z)
  const lx = fz, lz = -fx;                                         // left
  let tx = g.x, tz = g.z;
  if (g.kind === 'driving' || g.kind === 'unloading') {
    tx = demo.x + lx * (7 + g.nudgeX) + fx * (-2 + g.nudge); tz = demo.z + lz * (7 + g.nudgeX) + fz * (-2 + g.nudge);
  } else if (g.kind === 'goingToUnload') { tx = -200; tz = 420; }
  else if (g.kind === 'movingAway') { tx = demo.x + lx * 25; tz = demo.z + lz * 25; }
  const d = Math.hypot(tx - g.x, tz - g.z), step = (g.paused ? 0 : (g.kind === 'unloading' ? 30 : 6)) * dt / 1000;
  if (d > 0.01) { const k = Math.min(1, step / d); g.x += (tx - g.x) * k; g.z += (tz - g.z) * k; }
  if (g.kind === 'driving' && d < 3) g.kind = 'unloading';
  if (g.kind === 'unloading' && demo.unloading && !g.paused) g.fill = Math.min(cap, g.fill + 450 * dt / 1000);
  if (g.kind === 'goingToUnload' && d < 2) { g.fill = Math.max(0, g.fill - 2000 * dt / 1000); if (g.fill === 0) g.kind = 'waiting'; }
  if (g.kind === 'movingAway' && d < 2) g.kind = 'waiting';
  const kind = g.kind === 'goingToUnload' && d >= 2 ? 'driving' : g.kind;
  return { carts: 1, inCart: false, name: 'Demo 8R + 1300 Cart', state: g.kind.toUpperCase(), kind: g.kind === 'goingToUnload' ? 'goingToUnload' : kind,
    paused: g.paused, outOfPosition: false, released: g.released, nudge: g.nudge, nudgeX: g.nudgeX,
    fill: Math.round(g.fill), cap, x: +g.x.toFixed(1), z: +g.z.toFixed(1), dist: Math.round(Math.hypot(g.x - demo.x, g.z - demo.z)) };
}

// Turns the tractor demo frame into a combine with a header and Realistic Harvesting data.
const DEMO_SETTINGS = [
  ['concave', 31, 24, 6], ['fan', 70, 72, 6], ['feeder', 36, 35, 4],
  ['lowerSieve', 22, 20, 5], ['rotor', 64, 67, 6], ['upperSieve', 33, 35, 5],
];
function demoCombine(t, dt, working, meters) {
  const width = 12.19;
  const big = DEMO_BIG && require('./demo-bigfield.js');
  const yieldT = big ? big.yieldAt(demo.x, demo.z) : Math.max(2, 6.6 + 1.4 * Math.sin(demo.x / 45) + 0.7 * Math.sin(demo.z / 23 + demo.t / 20000)); // t/ha
  const haph = working ? width * demo.speed / 10 : 0;
  const tph = yieldT * haph;
  const moisture = big ? big.moistureAt(demo.x, demo.z, demo.t) : 14.2 + 1.6 * Math.sin(demo.t / 45000);
  const load = demo.motorOn ? (working ? 38 + tph * 1.25 : 22) : 0;
  const target = 85;
  const lossSettings = working ? 0.35 : 0;
  const lossOverload = working ? Math.max(0, load - 100) * 0.09 : 0;
  const lossMoisture = working ? Math.max(0, moisture - 14.5) * 0.35 : 0;
  const loss = lossSettings + lossOverload + lossMoisture;
  const kg = tph * 1000 / 3600 * dt / 1000;                     // harvested this tick
  demo.massKg += kg; demo.lostKg += kg * loss / 100;
  const cap = 14100;
  if (demo.unloading) { demo.tank = Math.max(0, demo.tank - 450 * dt / 1000); if (demo.tank === 0) demo.unloading = false; }
  else { demo.tank += kg / 0.78; if (demo.tank >= cap) { demo.tank = cap; demo.unloading = true; } }  // the driver opens the pipe when full
  const rank = loss < 1 ? 'A' : loss < 2.5 ? 'B' : loss < 5 ? 'C' : 'D';
  t.vehicle.name = 'Demo S7 Combine';
  t.vehicle.load = Math.round(Math.min(100, load));
  t.implements = [{
    name: 'Demo HD40F Header', canLower: true, lowered: demo.lowered && !demo.turning, canTurnOn: true, turnedOn: demo.turnedOn,
    width, areas: [working], fills: [], geometry: demoAreas(1, width, 4.5),
  }];
  t.combine = { name: 'Demo S7 Combine', tank: Math.round(demo.tank), tankCap: cap, crop: 'WHEAT', cropTitle: 'Wheat', turnedOn: demo.turnedOn };
  t.grainCart = demoGrainCart(dt);
  t.controls = { ...t.controls, pipe: { state: demo.unloading ? 2 : 1, target: demo.unloading ? 2 : 1, states: 2, open: demo.unloading } };
  t.controls.fold.name = 'Demo HD40F Header';
  t.rh = {
    version: 'demo', crop: 'WHEAT', mode: 'MANUAL', harvesting: working, ai: false, moistureHigh: moisture > 14.5, tier: 3,
    yield: +yieldT.toFixed(2), lastYield: +yieldT.toFixed(2), tph: +tph.toFixed(2), haph: +haph.toFixed(2),
    avgHaph: 6.9, lph: working ? 58 : 18, width, massKg: Math.round(demo.massKg),
    moisture: +moisture.toFixed(1), moistureLimit: 14.5, weeds: 0.04,
    loss: +loss.toFixed(2), lossOverload: +lossOverload.toFixed(2), lossMoisture: +lossMoisture.toFixed(2),
    lossSettings, lossSlope: 0, lossWear: 0, rank,
    load: +load.toFixed(1), targetLoad: target, recSpeed: demo.recSpeed = +(demo.speed * Math.min(1.25, target / Math.max(1, load))).toFixed(1),
    efficiency: 0.94,
    settings: DEMO_SETTINGS.map(([name, value, opt, tol]) => ({ name, value, opt, tol, min: opt - 20, max: opt + 20 })),
    trip: {
      areaHa: +(demo.work.area / 10000).toFixed(3), massKg: Math.round(demo.massKg), liters: Math.round(demo.massKg / 0.78),
      lostLiters: Math.round(demo.lostKg / 0.78), fuelL: +demo.work.fuelUsed.toFixed(1), seconds: Math.round(demo.work.time / 1000),
      field: 23, rank,
    },
  };
  return t;
}
// Headland automation as the mod reports it: the demo's turns are the headlands.
function demoHeadland(t) {
  let h;
  try { h = fieldStore().headland(currentSave()); } catch (e) { return null; }
  if (!h.armed) return { armed: false, state: 'off', source: 'none', v: 0, events: 0 };
  if (t.gnss && t.gnss.gates && t.gnss.gate && t.gnss.gate.headland === false) return { armed: true, state: 'noSignal', source: 'none', v: 1, events: demo.hlEvents || 0 };
  const P = demoPath;
  let dist = null;
  if (P && demo.pathI !== undefined) {
    const want = !demo.turning;                       // working: distance to the next turn; turning: to the next pass
    for (let i = demo.pathI + 1; i < P.length; i++) {
      const isWork = P[i - 1].work && P[i].work;
      if (isWork !== want) { dist = Math.max(0, P[i - 1].s - demo.pathS); break; }
    }
  }
  if (demo.hlTurning !== demo.turning) { demo.hlEvents = (demo.hlEvents || 0) + 1; demo.hlTurning = demo.turning; }
  return { armed: true, state: demo.turning ? 'headland' : 'work', source: h.useBoundary ? 'boundary' : 'coverage',
    dist: dist === null ? undefined : +dist.toFixed(1), v: 1, events: demo.hlEvents || 0, steer: 'base', steerOn: !demo.turning };
}

// Harvest Automation as the mod runs it: cruise speed steps toward RH's recommended speed, 0.5 km/h per second.
function demoAuto(dt) {
  const a = demo.auto;
  if (!a.on) return;
  a.timer += dt;
  if (a.timer < 1000) return;
  a.timer = 0;
  if (!demo.cc) { a.state = 'cruiseOff'; return; }
  if (!demo.turnedOn) { a.state = 'notThreshing'; return; }
  if (!demo.lowered || demo.turning || demo.recSpeed === null) { a.state = 'noCrop'; return; }
  a.target = Math.max(1, Math.min(a.max, demo.recSpeed));
  const step = Math.max(-0.5, Math.min(0.5, a.target - demo.ccSpeed));
  if (Math.abs(step) >= 0.05) demo.ccSpeed = +(demo.ccSpeed + step).toFixed(1);
  a.state = 'active';
}
// Tractor + field cultivator: Cultivator Settings levels and Realistic Tillage depth (actual depth eases to the set point).
const LEVEL_NAMES = { 2: 'shallow', 3: 'normal', 4: 'deep' };
function demoTillage(t, dt, working) {
  const k = demo.till;
  k.depth += (k.target - k.depth) * Math.min(1, dt / 2500);
  const draft = (working ? 1 : 0) * (0.6 + k.depth / 30 + (k.level === 4 ? 0.25 : 0));
  t.vehicle.name = 'Demo 8R 410 Tractor';
  t.vehicle.load = t.vehicle.motorOn ? Math.round(Math.min(100, 24 + draft * 52 + 4 * Math.sin(demo.t / 2600))) : 0;
  t.implements = [{
    name: 'Demo 2230FH Field Cultivator', canLower: true, lowered: demo.lowered && !demo.turning, canTurnOn: false, turnedOn: false,
    width: 12.19, areas: [working], fills: [], geometry: demoAreas(1, 12.19, -7.5),
    tillage: {
      type: 'cultivator', deep: k.level > 2, subsoil: k.level === 4, level: LEVEL_NAMES[k.level], levels: 'shallow,normal,deep',
      modeSource: 'cultivatorSettings', locked: false, changeAllowed: true,
      depth: +k.depth.toFixed(1), target: k.target, min: 2, max: 38, limited: working && t.vehicle.load > 96, canSet: true, source: 'realisticTillage',
    },
  }];
  t.controls.fold.name = 'Demo 2230FH Field Cultivator';
  return t;
}
function demoTick(dt) {
  demo.t += dt;
  if (DEMO_COMBINE) demoAuto(dt);
  let hlSpeed = 0;
  try { const h = fieldStore().headland(currentSave()); if (h.armed && demo.turning && h.headSpeed > 0) hlSpeed = h.headSpeed; } catch (e) { /* no store yet */ }
  const target = !demo.motorOn ? 0 : hlSpeed || (demo.cc ? demo.ccSpeed : 6 + 4 * Math.sin(demo.t / 9000));
  demo.speed += (target - demo.speed) * Math.min(1, dt / 1500);
  const meters = demo.speed / 3.6 * dt / 1000;
  const working = demo.lowered && demo.unfolded && demo.turnedOn && demo.speed > 0.3 && !demo.turning;
  const burn = demo.motorOn ? (working ? 38 : 12) / 3600 * dt / 1000 : 0; // l per tick
  demo.fuel = Math.max(0, demo.fuel - burn);
  demo.def = Math.max(0, demo.def - burn * 0.05);
  demoMove(meters);
  demo.work.totalDistance += meters;
  demo.work.totalFuel += burn;
  if (working) {
    demo.work.area += 12.19 * meters;
    demo.work.time += dt;
    demo.work.distance += meters;
    demo.work.fuelUsed += burn;
    demo.seed = Math.max(0, demo.seed - 0.004 * 12.19 * meters);
  }
  const rpm = demo.motorOn ? 850 + demo.speed * 55 + (working ? 250 : 0) : 0;
  const minutes = 6 * 60 + Math.floor(demo.t / 2500);
  const frame = ({
    seq: Math.floor(demo.t / 250), version: 'demo', state: 'vehicle', time: Math.floor(demo.t),
    lastCmd: demo.lastCmd || 0,
    game: { day: DEMO_DAY, hour: Math.floor(minutes / 60) % 24, minute: minutes % 60 },
    vehicle: {
      name: 'Demo 8R Tractor', speed: +demo.speed.toFixed(1), motorOn: demo.motorOn, ai: false, onField: true,
      rpm: Math.round(rpm), maxRpm: 2100, load: demo.motorOn ? Math.round(working ? 62 + 8 * Math.sin(demo.t / 3000) : 18) : 0,
      gear: demo.speed > 0.2 ? 'D' : 'N', cvt: true, dir: demo.speed > 0.2 ? 1 : 0,
      ccState: demo.cc, ccSpeed: demo.ccSpeed, ccMax: 40,
      fuel: +demo.fuel.toFixed(1), fuelCap: 680, fuelType: 'DIESEL', def: +demo.def.toFixed(1), defCap: 72,
      damage: 12.5, hours: 1287.4, x: +demo.x.toFixed(1), z: +demo.z.toFixed(1), heading: Math.round(demo.heading), farmland: 23,
    },
    implements: [{
      name: 'Demo 1775NT Planter', canLower: true, lowered: demo.lowered && !demo.turning, canTurnOn: true, turnedOn: demo.turnedOn,
      width: 12.19, areas: demoRowStates(working).map(c => working && c === '1'),
      geometry: demoAreas(16, 12.19, -7.5),
      section: demoSectionBlock(working),
      fills: [{ title: 'Seeds', type: 'SEEDS', level: +demo.seed.toFixed(1), cap: 2800 }, { title: 'Liquid Fertilizer', type: 'LIQUIDFERTILIZER', level: 1600, cap: 2271 }],
      seeder: demoSeeder(working),
    }],
    controls: {
      lights: demo.lights, workFront: demo.workLights, workBack: demo.workLights, hazard: demo.hazard, beacon: demo.beacon,
      pipe: null, fold: { unfolded: demo.unfolded, moving: false, name: 'Demo 1775NT Planter' },
    },
    harvestAuto: DEMO_COMBINE ? { on: demo.auto.on, state: demo.auto.state, max: demo.auto.max, target: demo.auto.target ?? undefined, source: demo.auto.on ? 'rh' : undefined } : { on: false, state: 'off', max: 10 },
    work: {
      recording: working, area: Math.round(demo.work.area), time: Math.round(demo.work.time / 1000),
      distance: Math.round(demo.work.distance), totalDistance: Math.round(demo.work.totalDistance),
      fuelUsed: +demo.work.fuelUsed.toFixed(2), totalFuel: +demo.work.totalFuel.toFixed(2),
    },
  });
  setExtras(demoProviders(working));
  if (!gameFields) takeGameFields(demoFields());
  // tracks, a re-driven boundary and a prescription, once the farm's fields are in the field store
  if (!demo.farmStore && gameFieldsSave === currentSave()) {
    demo.farmStore = true;
    try { const r = require('./demo-farm.js').seedStore(fieldStore(), currentSave(), demoFarm(), DEMO_DAY); console.log(`Demo farm: ${r.tracks} tracks${r.rx ? ', prescription ' + r.rx : ''}`); }
    catch (e) { console.warn('Demo farm setup failed:', e.message); }
  }
  if (!economy) economy = demoEconomy();
  equipment = demoEquipment(); equipmentAt = Date.now();
  let arx = null;
  try { arx = fieldStore().activeRx(currentSave()); } catch (e) { /* none */ }
  demo.rate = demo.rate || { auto: true, idx: 3 };
  const steps = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  // rate control only on the planter demo (its liquid fertilizer); a combine or a cultivator has none
  if (!DEMO_COMBINE && !DEMO_TILLAGE) frame.rate = { system: 'sf', auto: arx ? false : demo.rate.auto, value: steps[demo.rate.idx - 1], steps: steps.join(','),
    rx: arx ? arx.id : undefined, rxName: arx ? arx.name : undefined, rxActive: !!arx && working,
    rxRate: arx && working ? arx.rates[Math.floor(demo.t / 20000) % arx.zones] : undefined };
  if (!DEMO_COMBINE && !DEMO_TILLAGE) {
    const r = demo.rtkState;
    frame.section = { allowed: !!r.section || !r.gates, need: r.section || !r.gates ? undefined : 'activation', on: demo.section.on, overlap: demo.section.overlap,
      overlapName: ['Minimize Skips', '50% Covered', 'Minimize Overlap'][demo.section.overlap], implements: 1 };
  }
  const gs = guidanceState;
  if (demo.at && gs && !gs.steerOn) { demo.at = false; demo.atExit = 'steerOff'; }
  const hasTrack = !!(gs && gs.track), steerOn = !gs || gs.steerOn !== false;
  const diag = { activation: 1, receiver: 1, steerable: 1, track: +hasTrack, noAi: 1, steerOn: +steerOn, speed: +(demo.speed > 0.5), heading: 1, onTrack: 1 };
  frame.autotrac = Object.assign(demo.at
    ? { state: demo.turning && gs && gs.turn.on ? 'turning' : 'engaged', stage: 4, track: gs.track.id, pass: 3, xte: +(0.02 * Math.sin(demo.t / 4000)).toFixed(3), turnOn: gs.turn.on, turns: Math.floor(demo.t / 60000) }
    : { state: hasTrack ? 'ready' : 'notReady', stage: !hasTrack ? 1 : steerOn ? 3 : 2, reason: !hasTrack ? 'noTrack' : steerOn ? undefined : 'steerOff', last: demo.atExit, turnOn: !!(gs && gs.turn.on), turns: 0 },
  { steerOn, sens: gs ? gs.sens : 70, diag: Object.entries(diag).map(([k, v]) => k + '=' + v).join(';') });
  setTelemetry(demoGnss(DEMO_COMBINE ? demoCombine(frame, dt, working, meters) : DEMO_TILLAGE ? demoTillage(frame, dt, working) : frame, dt));
}

// Demo planter row clutches: row 6 switched off now and then; with Section Control on (activation bought,
// master on) rows 15-16 shut off over ground already planted at a point row.
demo.section = { on: true, overlap: 0 };
function demoSectionActive() { return !!(demo.rtkState && demo.rtkState.section) && demo.section.on; }
function demoRowStates(working) {
  return Array.from({ length: 16 }, (_, i) => {
    if (i === 5 && Math.sin(demo.t / 5000) > 0.6) return '0';
    if (working && demoSectionActive() && i >= 14 && Math.sin(demo.t / 7000) > 0.7) return 'a';
    return '1';
  });
}
function demoSectionBlock(working) {
  const rows = demoRowStates(working);
  return { kind: 'row', lanes: 16, rowsPerLane: 1, controller: demo.rtkState && demo.rtkState.section ? 'G5Link' : '', auto: demoSectionActive(), perRowRate: true, rows: rows.join(''), states: rows };
}

// Realistic Seeder snapshot as G5Link writes it (seed monitor fitted, row drive, no depth sensor).
function demoSeeder(working) {
  const s = demo.t / 1000;
  const skips = +(1.1 + 0.9 * Math.max(0, Math.sin(demo.x / 37 + s / 50))).toFixed(2);
  const doubles = +(0.5 + 0.5 * Math.max(0, Math.sin(demo.z / 29 + 1))).toFixed(2);
  const rate = 34000, actual = Math.round(rate * (1 - skips / 100 + doubles / 100));
  const states = demoRowStates(working);
  return {
    kind: 'planter', crop: 'MAIZE', unit: 'seedsPerAcre', monitor: true, depthSensor: false, fresh: working,
    rate, actual, skips, doubles, depthSet: 50, pressure: 55, closing: 50,
    moisture: +(0.24 + 0.07 * Math.sin(demo.x / 53) * Math.cos(demo.z / 41)).toFixed(3), compaction: 0.22, soilSource: 'SeasonalCropStress',
    popTarget: rate, popEstablished: Math.round(actual * 0.97), yieldPotential: +(97.5 - skips * 0.8).toFixed(1),
    lph: 39.2,                                       // ~34,000 seeds/ac of corn at ~3,000 seeds/kg, 0.72 kg/L
    rows: Array.from({ length: 16 }, (_, i) => ({ r: i + 1, on: working && states[i] === '1', target: rate,
      actual: working && states[i] === '1' ? Math.round(actual * (1 + 0.012 * Math.sin(i * 1.7 + s / 7))) : 0, skips, doubles })),
  };
}

// Demo values shaped like the real adapters' snapshots (Realistic Soil & Fertilizer getFieldInfo,
// Courseplay vehicle functions, AutoDrive state module, Mud System Physics).
// Demo field: back-and-forth passes along 92°, slightly narrow on every other pass so the
// coverage shows overlap, with half-circle turns (implement raised) at both ends.
const DEMO_W = 12.19, DEMO_LEN = 320, DEMO_H = 92;
const BIG = DEMO_BIG ? require('./demo-bigfield.js').build({ width: 12.19 }) : null;
if (BIG) console.log(`Big field demo: ${(BIG.ha * 2.47105).toFixed(0)} ac, ${BIG.headlands} headland laps, ${BIG.blocks} blocks, ${BIG.passes} passes, ${(BIG.path[BIG.path.length - 1].s / 1000).toFixed(0)} km to drive`);
const demoPath = BIG ? BIG.path : (() => {
  const h = DEMO_H * Math.PI / 180, f = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  const pts = [];
  let off = 0;
  for (let k = 0; k < 14; k++) {
    const dir = k % 2 ? -1 : 1, a0 = dir > 0 ? 0 : DEMO_LEN;
    for (let a = 0; a <= DEMO_LEN; a += 4) {
      const L = a0 + dir * a;
      pts.push({ x: -120 + f.x * L + r.x * off, z: 340 + f.z * L + r.z * off, work: true });
    }
    const spacing = DEMO_W * (k % 2 ? 1.0 : 0.9);
    const endL = a0 + dir * DEMO_LEN, rad0 = spacing / 2;
    for (let i = 1; i < 12; i++) {                       // turn: half circle to the next pass
      const th = Math.PI * i / 12;
      const along = endL + dir * (Math.sin(th) * rad0 + 6 * Math.sin(th));
      const side = off + rad0 - Math.cos(th) * rad0;
      pts.push({ x: -120 + f.x * along + r.x * side, z: 340 + f.z * along + r.z * side, work: false });
    }
    off += spacing;
  }
  let s = 0;
  pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.s = s; });
  return pts;
})();
demo.pathS = 0; demo.turning = false;
function demoMove(meters) {
  const P = demoPath, total = P[P.length - 1].s;
  demo.pathS = (demo.pathS + meters) % total;
  let i = demo.pathI || 0;
  if (P[i].s > demo.pathS) i = 0;
  while (i < P.length - 2 && P[i + 1].s < demo.pathS) i++;
  demo.pathI = i;
  const a = P[i], b = P[i + 1], u = (demo.pathS - a.s) / Math.max(0.001, b.s - a.s);
  demo.x = a.x + (b.x - a.x) * u;
  demo.z = a.z + (b.z - a.z) * u;
  demo.heading = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
  demo.turning = !(a.work && b.work);
}
// World corners of a work area across the implement bar (start/width/height like FS work areas).
function demoAreas(n, width, back, active) {
  const h = demo.heading * Math.PI / 180, f = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  const bx = demo.x + f.x * back, bz = demo.z + f.z * back, out = [];
  for (let i = 0; i < n; i++) {
    const l0 = -width / 2 + width * i / n, l1 = -width / 2 + width * (i + 1) / n;
    out.push({ i, sx: +(bx + r.x * l0).toFixed(2), sz: +(bz + r.z * l0).toFixed(2), wx: +(bx + r.x * l1).toFixed(2), wz: +(bz + r.z * l1).toFixed(2),
      hx: +(bx + r.x * l0 - f.x).toFixed(2), hz: +(bz + r.z * l0 - f.z).toFixed(2) });
  }
  return out;
}

function demoCourse() {
  // The Courseplay course is the demo's own driving path, so the course lines match the coverage.
  const pts = demoPath.filter((p, i) => i % 2 === 0);
  const waypoints = pts.map((p, i) => {
    const prev = pts[i - 1], next = pts[i + 1];
    const flags = p.work && (!prev || !prev.work) ? 1 : p.work && next && !next.work ? 2 : 0;
    return [+p.x.toFixed(1), +p.z.toFixed(1), flags];
  });
  if (BIG) return { key: 'demo-course', name: 'Field 23 (1500 ac) demo course', workWidth: DEMO_W, waypoints,
    field: BIG.field.filter((q, i) => i % 3 === 0).map(q => q.map(n => +n.toFixed(1))) };
  const xs = demoPath.map(p => p.x), zs = demoPath.map(p => p.z), m = 18;
  const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, z0 = Math.min(...zs) - m, z1 = Math.max(...zs) + m;
  return { key: 'demo-course', name: 'Field 23 demo course', workWidth: DEMO_W, waypoints,
    field: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(q => q.map(n => +n.toFixed(1))) };
}
if (DEMO) course = demoCourse();
// Demo map fields: Field 23 covers the first ten passes only, so the last four show up as
// work outside the field (as after cultivating new ground) for "Expand from coverage".
// The demo farm (demo-farm.js): 50 fields, 2500 ac, in different states of the season, with Field 23 the
// one the demo machine works. Field 23 covers the first ten passes of the demo route only, so the last four show up
// as work outside the field (as after cultivating new ground) for "Expand from coverage".
const DEMO_DAY = 60;                                  // game day: the farm's records are spread over the days before
let FARM = null;
function demoFarm() {
  if (FARM) return FARM;
  const farmLib = require('./demo-farm.js');
  const h = DEMO_H * Math.PI / 180, f = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  const pt = (L, off) => [+(-120 + f.x * L + r.x * off).toFixed(1), +(340 + f.z * L + r.z * off).toFixed(1)];
  const edge = DEMO_W * 0.95 * 10 - DEMO_W / 2;      // ~ the first ten passes
  const f23 = BIG ? BIG.field.filter((q, i) => i % 3 === 0).map(q => q.map(n => +n.toFixed(1)))
    : [pt(-8, -DEMO_W / 2), pt(DEMO_LEN + 8, -DEMO_W / 2), pt(DEMO_LEN + 8, edge), pt(-8, edge)];
  const route = demoPath.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  FARM = farmLib.build({ fixed: { id: 23, polygon: f23 }, exclude: [{ x0: -230, x1: -130, z0: 270, z1: 390 }, route],
    region: BIG ? { x0: -2600, x1: 2600, z0: -3500 } : { x0: -1700, x1: 1900, z0: -1400 } });
  const t = farmLib.seedCoverage(mapStore(), 'unsaved', FARM, DEMO_DAY);
  console.log(`Demo farm: ${FARM.fields.length} fields, ${(FARM.ha * 2.47105).toFixed(0)} ac, ${t.frames} recorded frames (${t.ms} ms)`);
  return FARM;
}
function demoFields() { return require('./demo-farm.js').gameFields(demoFarm()); }
// Demo prices per litre and tonnes per litre, in the shape the mod writes economy.json.
function demoEconomy() {
  return { farmId: 1, balance: 412350, loan: 150000, equity: 1890000, fillTypes: {
    WHEAT: { title: 'Wheat', price: 0.218, cost: 0.24, mass: 0.00078 }, MAIZE: { title: 'Corn', price: 0.162, cost: 0.18, mass: 0.00072 },
    SOYBEAN: { title: 'Soybeans', price: 0.35, cost: 0.38, mass: 0.00072 }, SEEDS: { title: 'Seeds', price: 0.9, cost: 0.9, mass: 0.00045 },
    FERTILIZER: { title: 'Fertilizer', price: 1.6, cost: 1.6, mass: 0.001 }, LIQUIDFERTILIZER: { title: 'Liquid Fertilizer', price: 1.3, cost: 1.3, mass: 0.001 },
    HERBICIDE: { title: 'Herbicide', price: 1.2, cost: 1.2, mass: 0.001 }, DIESEL: { title: 'Diesel', price: 1.4, cost: 1.4, mass: 0.00084 } },
    farmFinance: { apiVersion: '1.0.0', bankActive: true, creditScore: 742, creditGrade: 'B',
      inputAccount: { enabled: true, limit: 120000, balance: 18450, available: 101550, pastDue: 0, dueCropYear: 2027, earlyPayDiscount: 0.03 },
      contracts: { 23: { kind: 'in', leaseType: 'share', landownerShare: 0.33, inputShare: 0.25, endCropYear: 2029 } },
      market: { baseRate: 0.0625, trend: 1, trendMonthsLeft: 3, cropYear: 2027, period: 4 },
      summary: {
        credit: { score: 742, grade: 'B', parts: { payment: 0.92, solvency: 0.71, liquidity: 0.58, repayment: 0.8, length: 0.35 },
          ratios: { debtToAsset: 0.21, currentRatio: 1.85, termDebtCoverage: 1.6, workingCapital: 268000, netWorth: 1890000, totalAssets: 2390000, totalDebt: 500000 },
          history: { onTime: 22, late: 1, missed: 0, monthsOnRecord: 23 } },
        loans: [
          { id: 'L1', productId: 'realEstate', label: 'Field 23 purchase', principal: 380000, balance: 318400, rate: 0.059, payment: 3100, monthsTotal: 180, monthsLeft: 141, status: 'active' },
          { id: 'L2', productId: 'equipment', label: 'Demo 9RX Tractor', principal: 210000, balance: 131600, rate: 0.071, payment: 4180, monthsTotal: 60, monthsLeft: 35, status: 'active', collateralUid: 'demo2' }],
        leases: [{ id: 'E1', name: 'Demo R4045 Sprayer', price: 420000, payment: 5200, residual: 210000, deposit: 25000, rate: 0.068, months: 48, monthsLeft: 30, hoursPerYear: 500, status: 'active', vehicleUid: 'demo3' }],
        land: [{ id: 'C1', kind: 'in', leaseType: 'share', farmlandId: 23, name: 'Field 23 (crop share)', landownerShare: 0.33, inputShare: 0.25, endCropYear: 2029 },
          { id: 'C2', kind: 'in', leaseType: 'cash', farmlandId: 24, name: 'Field 24', annualRent: 3400, endCropYear: 2028 }],
        operatingLine: { open: true, limit: 150000, balance: 42000, rate: 0.081 },
        inputAccount: { enabled: true, limit: 120000, balance: 18450, available: 101550, pastDue: 0, dueCropYear: 2027, earlyPayDiscount: 0.03 },
        ledger: { interestPaid: 48210, principalPaid: 139800, rentPaid: 10200, rentIncome: 0, income12: 612000, opex12: 388000 },
        debt: { debts: { realEstate: 318400, equipment: 131600, operating: 42000, imported: 0 }, total: 492000, debtService12: 87360, principal12: 58900, interest12: 28460, monthlyPayments: 7280 } } } };
}
function demoEquipment() {
  return { farmId: 1, vehicles: [
    { id: 'demo1', name: DEMO_COMBINE ? 'Demo S7 Combine' : DEMO_TILLAGE ? 'Demo 8R 410 Tractor' : 'Demo 8R Tractor', kind: DEMO_COMBINE ? 'combine' : 'tractor', x: +demo.x.toFixed(1), z: +demo.z.toFixed(1),
      heading: Math.round(demo.heading), speed: +demo.speed.toFixed(1), motorOn: demo.motorOn, ai: false, inUse: true, fuelPct: Math.round(demo.fuel / 680 * 100),
      hours: 1287.4, damage: 12, field: 23, implements: [DEMO_COMBINE ? 'Demo HD40F Header' : DEMO_TILLAGE ? 'Demo 2230FH Field Cultivator' : 'Demo 1775NT Planter'], ads: { state: 'READY', hours: 212.4, interval: 250 } },
    { id: 'demo2', name: 'Demo 9RX Tractor', kind: 'tractor', x: -160, z: 300, heading: 180, speed: 0, motorOn: false, ai: false, inUse: false, fuelPct: 64, hours: 2210.3, damage: 31, field: null, implements: ['Demo 2730 Ripper'], ads: { state: 'READY', hours: 268.0, interval: 250 } },
    { id: 'demo3', name: 'Demo R4045 Sprayer', kind: 'sprayer', x: -170, z: 360, heading: 90, speed: 0, motorOn: false, ai: false, inUse: false, fuelPct: 88, hours: 640.0, damage: 5, field: null, implements: [], ads: { state: 'MAINTENANCE', hours: 0.4, interval: 200 } },
    { id: 'demo4', name: 'Demo Semi Truck', kind: 'truck', x: -190, z: 330, heading: 0, speed: 0, motorOn: false, ai: false, inUse: false, fuelPct: 41, hours: 3301.9, damage: 18, field: null, implements: ['Demo Grain Trailer'] },
  ] };
}
function demoProviders(working) {
  const s = demo.t / 1000;
  const providers = {
    'soil-fertilizer': {
      sourceMode: 'public-api', fieldId: 23,
      values: {
        fieldId: 23, nitrogen: { value: 46, status: 'Fair' }, phosphorus: { value: 41, status: 'Good' },
        potassium: { value: 18, status: 'Poor' }, pH: +(6.4 + 0.1 * Math.sin(s / 30)).toFixed(2), pHStatus: 'LOCAL',
        organicMatter: 3.6, compaction: Math.round(22 + 6 * Math.sin(s / 40)), weedPressure: 12, pestPressure: 4,
        diseasePressure: 9, shownDiseasePressure: null, yieldEfficiency: 0.91, lastCrop: DEMO_COMBINE ? 'WHEAT' : 'SOYBEAN',
        rotationStatus: 'Good', daysSinceHarvest: 41,
      },
    },
    'mud-system-physics': {
      sourceMode: 'public-api', slip: +(0.06 + 0.03 * Math.sin(s / 9)).toFixed(3), sink: 0.04, fieldMudFactor: 0.18,
      groundType: 'field', tirePressure: 1.2, targetTirePressure: 1.0,
    },
  };
  if (DEMO_COMBINE) {
    providers.courseplay = {
      sourceMode: 'vehicle-functions', active: true, fieldworkActive: working, drivingToFieldwork: false,
      progress: BIG ? +(demo.pathS / BIG.path[BIG.path.length - 1].s).toFixed(4) : Math.min(1, (demo.work.area / 10000) / 7.5),
      waitingForUnload: demo.unloading, maneuvering: demo.turning,
      courseName: BIG ? 'Field 23 (1500 ac) demo course' : 'Field 23 demo course',
      course: BIG
        ? { name: 'Field 23 (1500 ac) demo course', workWidth: 12.19, headlands: BIG.headlands, waypointCount: BIG.path.length,
          remainingTurns: BIG.path[demo.pathI || 0].turnsLeft, remainingDistance: Math.round(BIG.path[BIG.path.length - 1].s - demo.pathS) }
        : { name: 'Field 23 demo course', workWidth: 12.19, headlands: 0, waypointCount: 630, remainingTurns: 8,
          remainingDistance: Math.max(0, 6200 - demo.work.distance) },
    };
  } else {
    providers.autodrive = { sourceMode: 'vehicle-state', active: false, task: '', destination: 'Grain Bins', remainingDriveTime: 0 };
  }
  return { providers, fieldId: 23, courseKey: DEMO_COMBINE ? 'demo-course' : null, source: 'demo',
    status: { 'soil-fertilizer': { available: true, mode: 'public-api' }, courseplay: { available: true, mode: 'vehicle-functions' },
      autodrive: { available: true, mode: 'vehicle-state' }, 'mud-system-physics': { available: true, mode: 'public-api' } } };
}

// ---------------------------------------------------------------- HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/ops') { res.writeHead(302, { Location: '/ops/' }).end(); return; }
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(APP_DIR, rel);
  if (!file.startsWith(APP_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    res.write('data: ' + JSON.stringify(latest) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url.startsWith('/api/ops/') || req.url.startsWith('/api/boundary') || req.url.startsWith('/api/rtk')) {
    const u = new URL(req.url, 'http://x');
    const json = (code, body) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(body));
    const store = fieldStore(), save = currentSave();
    const post = fn => {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 512 * 1024) req.destroy(); });
      req.on('end', () => {
        try { json(200, { ok: true, ...(fn(JSON.parse(body || '{}')) || {}) }); }
        catch (e) { json(400, { ok: false, error: e.message }); }
      });
    };
    if (req.method === 'GET') {
      if (u.pathname === '/api/ops/summary') {
        const v = latest.vehicle;
        const lw = store.lastWork(save);
        const fieldsOut = store.list(save).map(f => ({ ...f, lastWork: lw[f.id] || null }));
        return json(200, { save, farmId: gameFields ? gameFields.farmId : null, farmName: gameFields ? gameFields.farmName || null : null,
          settings: store.db(save).settings, fields: fieldsOut, version: store.version,
          equipment: equipment.vehicles, equipmentAge: equipmentAt ? Date.now() - equipmentAt : null,
          here: v && typeof v.x === 'number' ? { x: v.x, z: v.z, heading: v.heading, name: v.name } : null,
          game: latest.game || {}, link: latest.link, maps: mapStore().list().ops });
      }
      if (u.pathname === '/api/ops/field') {
        const f = store.field(save, u.searchParams.get('id'));
        return f ? json(200, { field: f, records: store.records(save, f.id) }) : json(404, { error: 'no such field' });
      }
      if (u.pathname === '/api/ops/records') return json(200, { records: store.records(save) });
      if (u.pathname === '/api/ops/profit') return json(200, { ...store.profit(save, economy), economyAge: economy ? 'live' : null });
      if (u.pathname === '/api/ops/tracks') {
        const fid = u.searchParams.get('field');
        return json(200, { tracks: fid === null ? store.tracks(save) : store.tracks(save, fid), version: store.version });
      }
      if (u.pathname === '/api/ops/work-setup') return json(200, { workSetup: store.workSetup(save), clientDefault: store.db(save).settings.client || null,
        farmDefault: gameFields ? gameFields.farmName || null : null });
      if (u.pathname === '/api/rtk') return json(200, { rtk: DEMO ? demoRtkState() : rtkState });
      if (u.pathname === '/api/ops/headland') return json(200, { headland: store.headland(save), status: headland().status });
      if (u.pathname === '/api/ops/rx') {
        const fid = u.searchParams.get('field');
        const a = store.activeRx(save);
        return json(200, { prescriptions: fid === null ? store.prescriptions(save) : store.prescriptions(save, fid), active: a ? a.id : null });
      }
      if (u.pathname === '/api/ops/finance') return json(200, { farmFinance: economy && economy.farmFinance || null, equipment: equipment.vehicles });
      if (u.pathname === '/api/boundary') return json(200, { ...boundaryStatus(), path: rec.active ? rec.points : [] });
      return json(404, { error: 'unknown route' });
    }
    if (req.method === 'POST') {
      if (u.pathname === '/api/boundary') return post(c => boundaryCommand(c));
      if (u.pathname === '/api/ops/settings') return post(c => ({ settings: store.setSettings(save, c) }));
      if (u.pathname === '/api/ops/tracks') return post(c => {
        if (c.action === 'add') return { track: store.addTrack(save, c.track || {}) };
        if (c.action === 'update') return { track: store.updateTrack(save, String(c.id), c.changes || {}) };
        if (c.action === 'delete') { store.deleteTrack(save, String(c.id)); return {}; }
        throw new Error('unknown action');
      });
      if (u.pathname === '/api/ops/work-setup') return post(c => ({ workSetup: store.setWorkSetup(save, c) }));
      if (u.pathname === '/api/ops/headland') return post(c => ({ headland: store.setHeadland(save, c) }));
      if (u.pathname === '/api/ops/rx') return post(c => {
        let out;
        if (c.action === 'create') out = { rx: store.createRx(save, c) };
        else if (c.action === 'update') out = { rx: store.updateRx(save, String(c.id), c.changes || {}) };
        else if (c.action === 'delete') { store.deleteRx(save, String(c.id)); out = {}; }
        else if (c.action === 'activate') out = { active: store.setActiveRx(save, c.id === null ? null : String(c.id)) };
        else throw new Error('unknown action');
        syncRx();
        return out;
      });
      if (u.pathname === '/api/ops/profit-settings') return post(c => ({ settings: store.setProfitSettings(save, c) }));
      if (u.pathname === '/api/ops/boundary') return post(c => store.addBoundary(save, { fieldId: c.fieldId, name: c.name, source: c.source, polygon: c.polygon, note: c.note, newField: !!c.newField }));
      if (u.pathname === '/api/ops/active') return post(c => { store.setActive(save, c.fieldId, Number(c.v)); });
      if (u.pathname === '/api/ops/rename') return post(c => { store.rename(save, c.fieldId, c.name); });
      if (u.pathname === '/api/ops/remove-boundary') return post(c => { store.removeBoundary(save, c.fieldId, Number(c.v)); });
      if (u.pathname === '/api/ops/from-coverage') return post(c => ({ proposal: store.fromCoverage(save, c.fieldId ? { fieldId: c.fieldId } : { x: Number(c.x), z: Number(c.z) }) }));
    }
    return json(404, { error: 'unknown route' });
  }
  if (req.url.startsWith('/api/map/')) {
    const u = new URL(req.url, 'http://x');
    const json = (code, body) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(body));
    const store = mapStore();
    if (u.pathname === '/api/map/ops') return json(200, store.list());
    if (u.pathname === '/api/map/frames') return json(200, store.frames(u.searchParams.get('op'), Number(u.searchParams.get('since')) || 0));
    if (u.pathname === '/api/map/overlap') return json(200, store.overlap(u.searchParams.get('op')));
    if (u.pathname === '/api/map/clear' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        try { const { op } = JSON.parse(body || '{}'); json(200, { ok: store.clear(String(op)) }); }
        catch (e) { json(400, { ok: false, error: e.message }); }
      });
      return;
    }
    return json(404, { error: 'unknown map route' });
  }
  if (req.url === '/api/course') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(course));
    return;
  }
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(latest));
    return;
  }
  if (req.url === '/api/guidance') {
    if (req.method === 'GET') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ guidance: guidanceState }));
    let body = '';
    req.on('data', d => { body += d; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      try { const g = setGuidance(JSON.parse(body || '{}')); res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, guidance: g })); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }
  if (req.url === '/api/cmd' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const entry = queueCommand(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, id: entry.id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  serveStatic(req, res);
});

function start() {
setInterval(heartbeat, 1000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`G5Link bridge ${DEMO ? '(DEMO MODE) ' : ''}on port ${PORT}`);
  if (!DEMO) console.log('Watching', TELEMETRY);
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('Open on your iPad:');
  for (const ip of ips) console.log(`   http://${ip}:${PORT}`);
  console.log(`   (this PC: http://localhost:${PORT})`);
});

if (DEMO) {
  demoFarm();                       // the farm's fields and recorded history first (a few seconds)
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    let dt = (now - last) * DEMO_SPEED; last = now;
    // at high --demo-speed, step in pieces of <= 1.5 s game time so coverage gets a frame every few metres
    while (dt > 0) { const step = Math.min(dt, 1500); demoTick(step); dt -= step; }
  }, 250);
} else {
  loadExistingCommandIds();
  setInterval(pollTelemetry, 100);
  setInterval(pollProviders, 500);
  setInterval(pollCourse, 1000);
  setInterval(pollFields, 2000);
  setInterval(pollEquipment, 1000);
  setInterval(pollEconomy, 5000);
  setInterval(pollRtk, 1000);
  setInterval(pollFleet, 500);
}
}

if (require.main === module) {
  start();
  const bye = () => { try { if (maps) maps.flush(Date.now(), true); } finally { process.exit(0); } };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

module.exports = { parseXml, telemetryFromXml, fleetFromXml };

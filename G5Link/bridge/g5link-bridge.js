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
const DEMO_COMBINE = DEMO_OPT === 'combine';
const PORT = Number(opt('port', 8765));
const DEFAULT_DIR = path.join(os.homedir(), 'Documents', 'My Games', 'FarmingSimulator2025',
  'modSettings', 'FS25_G5Link');
const DIR = String(opt('dir', DEFAULT_DIR));
const TELEMETRY = path.join(DIR, 'telemetry.xml');
const COMMANDS = path.join(DIR, 'commands.xml');
const PROVIDERS = path.join(DIR, 'providers.json'); // other mods: soil, Courseplay, AutoDrive, mud (1 Hz)
const COURSE = path.join(DIR, 'course.json');       // Courseplay course + field boundary (on change)
const PROVIDER_STALE_MS = 6000;
const APP_DIR = path.resolve(__dirname, '..', 'app');
const STALE_MS = 3000; // no new seq for this long => game considered paused/closed

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
    })),
    combine: (child(g5, 'combine') || {}).attrs || null,
    rh: rhFromNode(child(g5, 'rh')),
  };
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

function setTelemetry(t) {
  if (t.seq !== lastSeq) {
    lastSeq = t.seq;
    lastSeqAt = Date.now();
  }
  latest = { ...t, ...currentExtras(), link: 'live' };
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
const pollCourse = jsonPoller(COURSE, c => { course = { key: c.key ?? null, name: c.name, workWidth: c.workWidth, waypoints: c.waypoints || [], field: c.field || [] }; });

// ---------------------------------------------------------------- commands
const ALLOWED = new Set(['motorToggle', 'cruiseToggle', 'cruiseSet', 'cruiseAdjust',
  'lowerAll', 'turnOnAll', 'implTurnOn', 'resetWork']);
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
    `    <cmd id="${c.id}" name="${escAttr(c.name)}" value="${Number(c.value) || 0}" index="${c.index | 0}"/>`
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
  const entry = { id: nextCmdId++, name: cmd.name, value: Number(cmd.value) || 0, index: cmd.index | 0 };
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
  }
  demo.lastCmd = c.id;
}
if (DEMO_COMBINE) { demo.ccSpeed = 6.2; demo.target = 6.2; }

// Turns the tractor demo frame into a combine with a header and Realistic Harvesting data.
const DEMO_SETTINGS = [
  ['concave', 31, 24, 6], ['fan', 70, 72, 6], ['feeder', 36, 35, 4],
  ['lowerSieve', 22, 20, 5], ['rotor', 64, 67, 6], ['upperSieve', 33, 35, 5],
];
function demoCombine(t, dt, working, meters) {
  const width = 12.19;
  const yieldT = Math.max(2, 6.6 + 1.4 * Math.sin(demo.x / 45) + 0.7 * Math.sin(demo.z / 23 + demo.t / 20000)); // t/ha
  const haph = working ? width * demo.speed / 10 : 0;
  const tph = yieldT * haph;
  const moisture = 14.2 + 1.6 * Math.sin(demo.t / 45000);
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
  else { demo.tank += kg / 0.78; if (demo.tank >= cap) { demo.tank = cap; demo.unloading = true; } }
  const rank = loss < 1 ? 'A' : loss < 2.5 ? 'B' : loss < 5 ? 'C' : 'D';
  t.vehicle.name = 'Demo S7 Combine';
  t.vehicle.load = Math.round(Math.min(100, load));
  t.implements = [{
    name: 'Demo HD40F Header', canLower: true, lowered: demo.lowered, canTurnOn: true, turnedOn: demo.turnedOn,
    width, areas: [working], fills: [],
  }];
  t.combine = { name: 'Demo S7 Combine', tank: Math.round(demo.tank), tankCap: cap, crop: 'WHEAT', cropTitle: 'Wheat', turnedOn: demo.turnedOn };
  t.rh = {
    version: 'demo', crop: 'WHEAT', mode: 'MANUAL', harvesting: working, ai: false, moistureHigh: moisture > 14.5, tier: 3,
    yield: +yieldT.toFixed(2), lastYield: +yieldT.toFixed(2), tph: +tph.toFixed(2), haph: +haph.toFixed(2),
    avgHaph: 6.9, lph: working ? 58 : 18, width, massKg: Math.round(demo.massKg),
    moisture: +moisture.toFixed(1), moistureLimit: 14.5, weeds: 0.04,
    loss: +loss.toFixed(2), lossOverload: +lossOverload.toFixed(2), lossMoisture: +lossMoisture.toFixed(2),
    lossSettings, lossSlope: 0, lossWear: 0, rank,
    load: +load.toFixed(1), targetLoad: target, recSpeed: +(demo.speed * Math.min(1.25, target / Math.max(1, load))).toFixed(1),
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
function demoTick(dt) {
  demo.t += dt;
  const target = !demo.motorOn ? 0 : demo.cc ? demo.ccSpeed : 6 + 4 * Math.sin(demo.t / 9000);
  demo.speed += (target - demo.speed) * Math.min(1, dt / 1500);
  const meters = demo.speed / 3.6 * dt / 1000;
  const working = demo.lowered && demo.turnedOn && demo.speed > 0.3;
  const burn = demo.motorOn ? (working ? 38 : 12) / 3600 * dt / 1000 : 0; // l per tick
  demo.fuel = Math.max(0, demo.fuel - burn);
  demo.def = Math.max(0, demo.def - burn * 0.05);
  demo.heading = (demo.heading + 0.4 * Math.sin(demo.t / 4000)) % 360;
  demo.x += meters * Math.sin(demo.heading * Math.PI / 180);
  demo.z -= meters * Math.cos(demo.heading * Math.PI / 180);
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
    game: { day: 3, hour: Math.floor(minutes / 60) % 24, minute: minutes % 60 },
    vehicle: {
      name: 'Demo 8R Tractor', speed: +demo.speed.toFixed(1), motorOn: demo.motorOn, ai: false, onField: true,
      rpm: Math.round(rpm), maxRpm: 2100, load: demo.motorOn ? Math.round(working ? 62 + 8 * Math.sin(demo.t / 3000) : 18) : 0,
      gear: demo.speed > 0.2 ? 'D' : 'N', cvt: true, dir: demo.speed > 0.2 ? 1 : 0,
      ccState: demo.cc, ccSpeed: demo.ccSpeed, ccMax: 40,
      fuel: +demo.fuel.toFixed(1), fuelCap: 680, fuelType: 'DIESEL', def: +demo.def.toFixed(1), defCap: 72,
      damage: 12.5, hours: 1287.4, x: +demo.x.toFixed(1), z: +demo.z.toFixed(1), heading: Math.round(demo.heading), farmland: 23,
    },
    implements: [{
      name: 'Demo 1775NT Planter', canLower: true, lowered: demo.lowered, canTurnOn: true, turnedOn: demo.turnedOn,
      width: 12.19, areas: Array.from({ length: 16 }, (_, i) => working && !(i === 5 && Math.sin(demo.t / 5000) > 0.6)),
      fills: [{ title: 'Seeds', level: +demo.seed.toFixed(1), cap: 2800 }, { title: 'Liquid Fertilizer', level: 1600, cap: 2271 }],
    }],
    work: {
      recording: working, area: Math.round(demo.work.area), time: Math.round(demo.work.time / 1000),
      distance: Math.round(demo.work.distance), totalDistance: Math.round(demo.work.totalDistance),
      fuelUsed: +demo.work.fuelUsed.toFixed(2), totalFuel: +demo.work.totalFuel.toFixed(2),
    },
  });
  setExtras(demoProviders(working));
  setTelemetry(DEMO_COMBINE ? demoCombine(frame, dt, working, meters) : frame);
}

// Demo values shaped like the real adapters' snapshots (Realistic Soil & Fertilizer getFieldInfo,
// Courseplay vehicle functions, AutoDrive state module, Mud System Physics).
function demoCourse() {
  const h = 92 * Math.PI / 180, f = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const off = k * 12.19, along = k % 2 ? [620, 0] : [0, 620];
    for (let a = 0; a <= 620; a += 10) {
      const L = along[0] + (along[1] - along[0]) * a / 620;
      pts.push([+(-120 - f.x * 20 + f.x * L + r.x * off).toFixed(1), +(340 - f.z * 20 + f.z * L + r.z * off).toFixed(1),
        a === 0 ? 1 : a === 620 ? 2 : 0]);
    }
  }
  const c = (fo, ro) => [+(-120 + f.x * fo + r.x * ro).toFixed(1), +(340 + f.z * fo + r.z * ro).toFixed(1)];
  return { key: 'demo-course', name: 'Field 23 demo course', workWidth: 12.19, waypoints: pts,
    field: [c(-40, -14), c(640, -14), c(640, 126), c(-40, 126), c(-40, -14)] };
}
if (DEMO) course = demoCourse();
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
      progress: Math.min(1, (demo.work.area / 10000) / 7.5), waitingForUnload: demo.unloading, maneuvering: false,
      courseName: 'Field 23 demo course',
      course: { name: 'Field 23 demo course', workWidth: 12.19, headlands: 0, waypointCount: 630, remainingTurns: 8,
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
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
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
  if (req.url === '/api/course') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(course));
    return;
  }
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(latest));
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
  let last = Date.now();
  setInterval(() => { const now = Date.now(); demoTick(now - last); last = now; }, 250);
} else {
  loadExistingCommandIds();
  setInterval(pollTelemetry, 100);
  setInterval(pollProviders, 500);
  setInterval(pollCourse, 1000);
}
}

if (require.main === module) start();

module.exports = { parseXml, telemetryFromXml };

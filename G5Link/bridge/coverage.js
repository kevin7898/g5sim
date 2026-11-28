'use strict';
// G5Link coverage and map layers. The bridge records every telemetry frame here:
//   * each implement's active work areas (world corners from the mod) are swept into quads,
//   * quads are tagged with the layer values of that moment (speed, yield, moisture, rates, ...),
//   * a 1 m grid counts passes so overlap ("dark blue = more than once" on the G5) is known,
//   * everything is kept per savegame and per operation (Harvest · Wheat, Seeding · Soybean, ...)
//     and appended to <dir>/maps/<save>/<operation>.ndjson so it survives restarts.
// Zero dependencies.

const fs = require('fs');
const path = require('path');

const CELL = 1;                 // m, overlap grid
const TILE = 64;                // cells per tile side
const MAX_STEP = 8;             // m between frames before a sweep is treated as a jump
const TURN_DEG = 100;           // heading change from the pass start that starts a new pass
const ENDPOINT_TOLERANCE = 0.04; // m, work-area corners arrive rounded to centimetres
const MAX_FRAME_GAP = 2000;      // ms of mission time
const PROCESSING_GAP_DRIVEN = 800; // ms, up to two missed 4 Hz samples between confirmations
const PROCESSING_GAP_FLEET = 1100; // ms, one missed 2 Hz sample between confirmations
const FLUSH_MS = 2000;
const FRAME_LIMIT = 20000;      // frames per /api/map/frames response

const rad = d => d * Math.PI / 180;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const CROP_NAMES = { WV_SPRINGWHEAT: 'Spring Wheat', WV_WINTERWHEAT: 'Winter Wheat', MAIZE: 'Corn', SOYBEAN: 'Soybeans' };
const title = s => CROP_NAMES[String(s || '').toUpperCase()] || String(s || '').toLowerCase().replace(/(^|[\s_-])([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).trim();

// Value keys a frame can carry. The display maps these to layers and colors.
const operationId = ({ kind, product, variety }) => kind + (product ? ':' + slug(product) : '') + (variety ? ':' + slug(variety) : '');
const VALUE_KEYS = ['speed', 'yield', 'moisture', 'loss', 'rate', 'seedLph', 'skips', 'doubles', 'singulation', 'cv', 'depth',
  'soilMoisture', 'compaction', 'yieldPotential', 'soilN', 'soilP', 'soilK', 'soilPH', 'tillDepth'];
// Tillage tool types the mod reports (Controls.lua getTillage).
const TILL_NAMES = { plow: 'Plow', cultivator: 'Field Cultivator', disc: 'Disc', subsoiler: 'Ripper', ripper: 'Ripper',
  powerHarrow: 'Power Harrow', harrow: 'Harrow', spader: 'Spader', mulcher: 'Mulcher', roller: 'Roller', weeder: 'Weeder', ridgeformer: 'Ridge Former' };

function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}
function inQuad(q, x, z) {               // even-odd test, works for any simple quad
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i * 2], zi = q[i * 2 + 1], xj = q[j * 2], zj = q[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function crossing(a, b, c, d) {
  const ux = b[0] - a[0], uz = b[1] - a[1], vx = d[0] - c[0], vz = d[1] - c[1];
  const determinant = ux * vz - uz * vx;
  if (Math.abs(determinant) < 1e-9) return null;
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const t = (dx * vz - dz * vx) / determinant, u = (dx * uz - dz * ux) / determinant;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [a[0] + t * ux, a[1] + t * uz];
}

class Operation {
  constructor(id, meta) {
    this.id = id;
    this.meta = meta;            // {kind, product, title, rateUnit}
    this.frames = [];
    this.seq = 0;
    this.tiles = new Map();
    this.coveredCells = 0;
    this.overlapCells = 0;
    this.overlapVersion = 0;
    this.overlapCache = null;
    this.values = new Set();
    this.pending = [];           // lines to append
    this.hasApplication = false;
  }
  cell(cx, cz, create) {
    const tx = Math.floor(cx / TILE), tz = Math.floor(cz / TILE), key = tx + ',' + tz;
    let t = this.tiles.get(key);
    if (!t) {
      if (!create) return null;
      t = { tx, tz, cnt: new Uint8Array(TILE * TILE), pass: new Int32Array(TILE * TILE).fill(-1) };
      this.tiles.set(key, t);
    }
    return { t, i: (cz - tz * TILE) * TILE + (cx - tx * TILE) };
  }
  paint(q, pass) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      minX = Math.min(minX, q[i * 2]); maxX = Math.max(maxX, q[i * 2]);
      minZ = Math.min(minZ, q[i * 2 + 1]); maxZ = Math.max(maxZ, q[i * 2 + 1]);
    }
    let changed = false;
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        if (!inQuad(q, (cx + 0.5) * CELL, (cz + 0.5) * CELL)) continue;
        const { t, i } = this.cell(cx, cz, true);
        if (t.cnt[i] === 0) { t.cnt[i] = 1; t.pass[i] = pass; this.coveredCells++; }
        else if (t.pass[i] !== pass) {
          if (t.cnt[i] === 1) { this.overlapCells++; changed = true; }
          if (t.cnt[i] < 255) t.cnt[i]++;
          t.pass[i] = pass;
        }
      }
    }
    if (changed) { this.overlapVersion++; this.overlapCache = null; }
  }
  addFrame(frame, persist) {
    this.seq++;
    frame.s = this.seq;
    this.frames.push(frame);
    if (frame.application) this.hasApplication = true;
    for (const k of Object.keys(frame.v || {})) this.values.add(k);
    for (const q of frame.q) this.paint(q, frame.p);
    if (persist) this.pending.push(JSON.stringify(frame));
  }
  // Covered cells (worked at least once) within r metres of a point, as runs per grid row in cell units:
  // Map(cz -> [[cx0, cx1), ...]). Used for coverage-based headland automation (bridge/headland.js).
  coveredRowsNear(x, z, r) {
    const rows = new Map();
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    for (let tz = Math.floor(c0z / TILE); tz <= Math.floor(c1z / TILE); tz++) {
      for (let tx = Math.floor(c0x / TILE); tx <= Math.floor(c1x / TILE); tx++) {
        const t = this.tiles.get(tx + ',' + tz);
        if (!t) continue;
        for (let r0 = 0; r0 < TILE; r0++) {
          const cz = tz * TILE + r0;
          if (cz < c0z || cz > c1z) continue;
          let start = -1;
          for (let c = 0; c <= TILE; c++) {
            const cx = tx * TILE + c;
            const on = c < TILE && cx >= c0x && cx <= c1x && t.cnt[r0 * TILE + c] >= 1;
            if (on && start < 0) start = cx;
            if (!on && start >= 0) {
              if (!rows.has(cz)) rows.set(cz, []);
              const list = rows.get(cz), last = list[list.length - 1];
              if (last && last[1] === start) last[1] = cx; else list.push([start, cx]);   // join across tiles
              start = -1;
            }
          }
        }
      }
    }
    return rows;
  }
  // Overlap cells as runs per grid row: [x0, x1, z] in metres (cell edges).
  overlapRuns() {
    if (this.overlapCache) return this.overlapCache;
    const runs = [];
    for (const t of this.tiles.values()) {
      for (let r = 0; r < TILE; r++) {
        let start = -1;
        for (let c = 0; c <= TILE; c++) {
          const on = c < TILE && t.cnt[r * TILE + c] >= 2;
          if (on && start < 0) start = c;
          if (!on && start >= 0) {
            runs.push([(t.tx * TILE + start) * CELL, (t.tx * TILE + c) * CELL, (t.tz * TILE + r) * CELL]);
            start = -1;
          }
        }
      }
    }
    this.overlapCache = { version: this.overlapVersion, cell: CELL, runs };
    return this.overlapCache;
  }
  summary() {
    return {
      id: this.id, ...this.meta, frames: this.frames.length, seq: this.seq,
      areaHa: +(this.coveredCells * CELL * CELL / 10000).toFixed(3),
      overlapHa: +(this.overlapCells * CELL * CELL / 10000).toFixed(3),
      values: [...this.values].filter(k => VALUE_KEYS.includes(k)), overlapVersion: this.overlapVersion,
      hasApplication: this.hasApplication,
    };
  }
}

class CoverageStore {
  constructor({ dir = null, persist = false } = {}) {
    this.dir = dir;
    this.persist = !!(persist && dir);
    this.saves = new Map();      // save -> Map(opId -> Operation)
    this.save = null;
    this.current = null;         // op id being worked
    // per machine ('driven' = the player's, 'm:<uniqueId>' = AI workers and other machines from fleet.xml):
    // {track: Map(implement key -> {runs}), pass: {id, heading, working, op, x, z}}
    this.machines = new Map();
    this.drivenId = null;
    this.session = null;
    this.counter = null;
    this.jobView = null;
    this.passSeq = 0;            // pass ids are unique across machines
    this.rates = new Map();      // implement key -> {level, area, rate}
    this.lastFlush = 0;
  }

  ops(save = this.save) {
    if (!this.saves.has(save)) {
      const m = new Map();
      this.saves.set(save, m);
      if (this.persist) this.loadSave(save, m);
    }
    return this.saves.get(save);
  }
  saveDir(save) { return path.join(this.dir, 'maps', slug(save)); }

  loadSave(save, m) {
    const dir = this.saveDir(save);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.ndjson')); } catch (e) { return; }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { continue; }
      let op = null;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch (e) { continue; }   // a torn last line after a crash
        if (rec.meta) { op = new Operation(rec.meta.id, rec.meta); m.set(op.id, op); continue; }
        if (op && Array.isArray(rec.q)) {
          const frame = { p: rec.p, h: rec.h, d: rec.d, q: rec.q, v: rec.v || {} };
          if (rec.m) frame.m = rec.m;
          if (typeof rec.job === 'string') frame.job = rec.job;
          if (Number.isFinite(rec.dt)) frame.dt = rec.dt;
          if (Number.isFinite(rec.dist)) frame.dist = rec.dist;
          if (rec.application === true) frame.application = true;
          op.addFrame(frame, false);
          this.passSeq = Math.max(this.passSeq, (rec.p || 0) + 1);
        }
      }
    }
  }

  getOp(id, meta) {
    const m = this.ops();
    let op = m.get(id);
    if (!op) {
      op = new Operation(id, { id, ...meta });
      m.set(id, op);
      if (this.persist) op.pending.push(JSON.stringify({ meta: op.meta }));
    }
    if (meta.rateUnit && !op.meta.rateUnit) op.meta.rateUnit = meta.rateUnit;
    return op;
  }

  // Which operation an implement is doing right now.
  operationOf(t, impl) {
    if (t.combine) {
      const crop = (t.rh && t.rh.crop && t.rh.crop !== '--') ? t.rh.crop : t.combine.crop;
      return { kind: 'harvest', product: crop || '', title: 'Harvest' + (crop ? ' · ' + title(t.combine.cropTitle || crop) : '') };
    }
    const fills = impl.fills || [];
    const ws = t.workSetup || {};
    const seed = fills.find(f => /SEED/i.test(f.type || f.title || ''));
    if (impl.operation === 'seeding' || impl.seeder || seed && !impl.operation) {
      // crop from the seeder, else the Work Setup; the Work Setup variety splits maps per variety (like the G5)
      const crop = impl.seeder?.crop || impl.stockCrop || ws.crop;
      return { kind: 'seeding', product: crop || '', variety: ws.variety || null,
        title: 'Seeding' + (crop ? ' · ' + title(crop) : '') + (ws.variety ? ' · ' + ws.variety : ''),
        rateUnit: impl.seeder ? (impl.seeder.unit === 'poundsPerAcre' ? 'lb/ac' : 'seeds/ac') : 'L/ha' };
    }
    const product = fills.find(f => f.level > 0) || fills[0];
    if (impl.tillage?.type && impl.operation !== 'application' && (impl.operation === 'tillage' || !(product && impl.turnedOn))) {
      const tool = TILL_NAMES[impl.tillage.type] || title(impl.tillage.type);
      return { kind: 'tillage', product: impl.tillage.type, title: 'Tillage · ' + tool };
    }
    if (impl.operation === 'application' || product && impl.turnedOn) {
      const applied = impl.sprayer?.product || product?.type || product?.title || '';
      return { kind: 'application', product: applied, title: 'Application' + (applied ? ' · ' + title(applied) : ''), rateUnit: 'L/ha' };
    }
    return { kind: 'tillage', product: '', title: 'Tillage' };
  }

  // Keep area identity across samples. Width alone cannot identify two fore-aft work planes.
  spansOf(impl, v) {
    const r = { x: Math.cos(rad(v.heading || 0)), z: Math.sin(rad(v.heading || 0)) };
    const lat = (x, z) => (x - v.x) * r.x + (z - v.z) * r.z;
    const spans = new Map();
    if (impl.sprayer?.applying === false) return spans;
    (impl.geometry || []).forEach(g => {
      const i = g.i ?? 0;
      if (!impl.areas || !impl.areas[i]) return;
      if (impl.processing?.[i] === false && impl.sprayer?.applying !== true) return;
      if (![g.sx, g.sz, g.wx, g.wz].every(Number.isFinite)) return;
      const ls = lat(g.sx, g.sz), lw = lat(g.wx, g.wz);
      spans.set(i, { l: Math.min(ls, lw), reversed: ls > lw, a: [g.sx, g.sz], b: [g.wx, g.wz] });
    });
    return spans;
  }

  sweepsBetween(previous, current) {
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const strips = [];
    for (const [id, to] of [...current.entries()].sort(([, a], [, b]) => a.l - b.l)) {
      const prior = previous.get(id);
      if (!prior) continue;
      const step = Math.max(distance(prior.a, to.a), distance(prior.b, to.b));
      if (step < 0.02 || step > MAX_STEP) continue;
      // Match the same physical node across frames, even when the tool swings past
      // the tractor's lateral axis. Normalize winding only after matching.
      const [fromA, fromB] = to.reversed ? [prior.b, prior.a] : [prior.a, prior.b];
      const [toA, toB] = to.reversed ? [to.b, to.a] : [to.a, to.b];
      const left = strips.find(strip => distance(strip.fromB, fromA) < ENDPOINT_TOLERANCE && distance(strip.toB, toA) < ENDPOINT_TOLERANCE);
      if (left) { left.fromB = fromB; left.toB = toB; }
      else strips.push({ fromA, fromB, toA, toB });
    }
    const quads = strips.flatMap(({ fromA, fromB, toA, toB }) => {
      // On a pivot, the leading and trailing edges can cross. Keep both
      // swept lobes as triangles using the existing four-corner record format.
      const p = crossing(fromA, fromB, toA, toB);
      if (p) return [[...fromA, ...p, ...toA, ...toA], [...p, ...fromB, ...toB, ...toB]];
      return [[...fromA, ...fromB, ...toB, ...toA]];
    });
    return quads.map(q => q.map(n => +n.toFixed(2))).filter(q => quadArea(q) > 0.001);
  }

  // Values recorded with this frame's swaths.
  valuesOf(t, impl, op, key, areaM2) {
    const v = {};
    const set = (k, x, d = 2) => { const n = num(x); if (n !== undefined) v[k] = +n.toFixed(d); };
    set('speed', t.vehicle.speed, 1);
    if (op.kind === 'harvest' && t.rh) {
      if (num(t.rh.yield) > 0) set('yield', t.rh.yield, 2);
      set('moisture', t.rh.moisture, 1);
      set('loss', t.rh.loss, 2);
    }
    if (impl.tillage) set('tillDepth', impl.tillage.depth, 1);   // cm, from Realistic Tillage
    const sd = impl.seeder;
    if (sd) {
      set('rate', num(sd.actual) ?? sd.rate, 0);
      set('skips', sd.skips); set('doubles', sd.doubles); set('cv', sd.cv);
      if (num(sd.skips) !== undefined && num(sd.doubles) !== undefined) set('singulation', 100 - sd.skips - sd.doubles);
      set('depth', num(sd.depth) ?? sd.depthSet, 0);
      if (num(sd.moisture) !== undefined) set('soilMoisture', sd.moisture * 100, 1);
      if (num(sd.compaction) !== undefined) set('compaction', sd.compaction * 100, 1);
      set('yieldPotential', sd.yieldPotential, 1);
      set('seedLph', sd.lph, 2);                 // seed litres per hectare at the set rate (for seed cost)
    } else if (op.kind === 'seeding' || op.kind === 'application' && !impl.sprayer) {
      // As-applied rate from the product leaving the tank over the area worked (L/ha).
      const fill = (impl.fills || []).find(f => op.kind === 'seeding' ? /SEED/i.test(f.type || f.title || '') : (f.type || f.title) === op.product);
      let st = this.rates.get(key);
      if (!st) { st = { level: fill ? fill.level : null, area: 0, rate: null }; this.rates.set(key, st); }
      if (fill && st.level !== null) {
        st.area += areaM2;
        if (fill.level > st.level + 1) { st.level = fill.level; st.area = 0; }     // refilled
        else if (st.area >= 400) {
          const used = st.level - fill.level;
          if (used >= 0) st.rate = used / (st.area / 10000);
          st.level = fill.level; st.area = 0;
        }
      } else if (fill) st.level = fill.level;
      set('rate', st.rate, 1);
    }
    const soil = t.providers?.['soil-fertilizer']?.values;
    if (soil) { set('soilN', soil.nitrogen?.value, 0); set('soilP', soil.phosphorus?.value, 0); set('soilK', soil.potassium?.value, 0); set('soilPH', soil.pH, 2); }
    return v;
  }

  machine(id) {
    let m = this.machines.get(id);
    if (!m) {
      m = { track: new Map(), passes: new Map(), source: null, position: null, time: null, job: null,
        received: null, ground: new Map(), queue: [] };
      this.machines.set(id, m);
    }
    return m;
  }

  drainGround(ms, id, force = false) {
    while (ms.queue.length && (force || !ms.queue[0].pending.size)) {
      const { t, source, repairs } = ms.queue.shift();
      if (!repairs.length) {
        this.recordFrame(t, source, id, ms);
        continue;
      }
      const implements_ = t.implements.slice();
      for (const { index, area } of repairs) {
        if (implements_[index] === t.implements[index]) {
          implements_[index] = { ...implements_[index], processing: implements_[index].processing.slice() };
        }
        implements_[index].processing[area] = true;
      }
      this.recordFrame({ ...t, implements: implements_ }, source, id, ms);
    }
  }

  queueGround(t, source, id, ms, now) {
    const prev = ms.received, v = t.vehicle;
    if (prev?.source === source && t.seq != null && prev.t.seq === t.seq) return;
    if (prev && (prev.source !== source || prev.t.activeWork?.id !== t.activeWork?.id ||
        prev.t.work?.counterEpoch !== t.work?.counterEpoch || Math.hypot(v.x - prev.t.vehicle.x, v.z - prev.t.vehicle.z) > MAX_STEP ||
        !(t.time > prev.t.time && t.time - prev.t.time <= MAX_FRAME_GAP))) {
      this.drainGround(ms, id, true);
      ms.ground.clear();
    }
    const entry = { t, source, pending: new Map(), repairs: [] };
    const ground = new Map();
    const driven = source === 'driven';
    const maxGap = driven ? PROCESSING_GAP_DRIVEN : PROCESSING_GAP_FLEET;
    const maxMissed = driven ? 2 : 1;
    if (Number.isFinite(t.time) && v.onField === true && v.dir > 0 && v.speed > 0.3 && v.motorOn !== false) {
      for (const [index, impl] of (t.implements || []).entries()) {
        // Sprayers have a separate as-applied signal. For other tools the
        // engine's processing bit expires after 200 ms, before the next sample.
        if (!impl.processing || impl.sprayer || impl.canTurnOn && !impl.turnedOn) continue;
        const op = operationId(this.operationOf(t, impl));
        for (const g of impl.geometry || []) {
          const area = g.i ?? 0, changed = impl.processing[area];
          if (!impl.areas?.[area] || typeof changed !== 'boolean' || ![g.sx, g.sz, g.wx, g.wz].every(Number.isFinite)) continue;
          const key = JSON.stringify([impl.id ?? index, op, area]);
          const anchor = ms.ground.get(key);
          const continuous = anchor && t.time - anchor.time <= maxGap && (changed || anchor.missed < maxMissed) &&
            Math.max(Math.hypot(g.sx - anchor.g.sx, g.sz - anchor.g.sz), Math.hypot(g.wx - anchor.g.wx, g.wz - anchor.g.wz)) <= MAX_STEP;
          if (continuous) {
            ground.set(key, { time: changed ? t.time : anchor.time, g, continuous: true, changed, missed: changed ? 0 : anchor.missed + 1 });
            if (!changed) entry.pending.set(key, { index, area });
          } else if (changed) {
            ground.set(key, { time: t.time, g, continuous: false, changed, missed: 0 });
          }
        }
      }
    }
    for (const pending of ms.queue) {
      for (const [key, repair] of pending.pending) {
        const next = ground.get(key);
        if (next?.continuous && !next.changed) continue;
        pending.pending.delete(key);
        if (next?.continuous && next.changed) pending.repairs.push(repair);
      }
    }
    ms.received = entry;
    ms.ground = ground;
    ms.queue.push(entry);
    this.drainGround(ms, id);
    this.flush(now);
  }

  forgetMachine(id) {
    const ms = this.machines.get(id);
    if (ms) this.drainGround(ms, id, true);
    this.machines.delete(id);
  }

  interrupt() {
    const now = Date.now();
    for (const id of this.machines.keys()) this.forgetMachine(id);
    this.drivenId = null;
    this.current = null;
    this.rates.clear();
    this.flush(now, true);
  }
  // A vehicle may move between the driven and fleet feeds. The next source starts a fresh sweep.
  onFrame(t, source = 'driven') {
    const now = Date.now();
    const driven = source === 'driven';
    if (t?.game?.save || t?.state === 'vehicle') {
      const save = t.game?.save || 'unsaved';
      const session = t.session ?? null;
      if (save !== this.save || session !== this.session) {
        this.interrupt();
        this.save = save;
        this.session = session;
      }
    }
    const v = t?.vehicle;
    if (t?.state !== 'vehicle' || !Number.isFinite(v?.x) || !Number.isFinite(v?.z)) {
      const id = driven ? this.drivenId : source;
      // A late empty fleet report must not interrupt the driver's current pose.
      if (id && (driven || this.machines.get(id)?.received?.source !== 'driven')) this.forgetMachine(id);
      if (driven) { this.drivenId = null; this.current = null; }
      this.flush(now);
      return;
    }
    const id = driven && v.id != null ? `m:${v.id}` : source;
    if (!driven && id === this.drivenId) return;
    if (driven && this.drivenId !== id) {
      if (this.drivenId) this.forgetMachine(this.drivenId);
      this.drivenId = id;
    }
    this.queueGround(t, source, id, this.machine(id), now);
  }

  recordFrame(t, source, id, ms) {
    const driven = source === 'driven', v = t.vehicle;
    const distance = ms.position ? Math.hypot(v.x - ms.position[0], v.z - ms.position[1]) : 0;
    const elapsed = Number.isFinite(t.time) && ms.time !== null ? t.time - ms.time : null;
    const job = driven ? t.activeWork || null : null;
    if (source !== ms.source || ms.job !== job?.id || elapsed !== null && (elapsed < 0 || elapsed > MAX_FRAME_GAP) || distance > MAX_STEP) {
      ms.track.clear();
      ms.passes.clear();
    }
    ms.position = [v.x, v.z];
    ms.source = source;
    ms.time = Number.isFinite(t.time) ? t.time : null;
    ms.job = job?.id;

    let counterChanged = false;
    if (driven) {
      const scope = JSON.stringify([this.save, this.session, id, t.work?.counterEpoch]);
      counterChanged = this.counter?.scope !== scope;
      if (counterChanged) this.counter = { scope, areaM2: 0, distanceM: 0, timeS: Number.isFinite(t.time) ? 0 : null };
    }

    const tracks = new Map(), passes = new Map();
    const heading = v.heading || 0;
    let swept = 0;
    let jobSampleCounted = false;
    for (const [index, impl] of (t.implements || []).entries()) {
      const spans = this.spansOf(impl, v);
      if (!spans.size) continue;
      const meta = this.operationOf(t, impl);
      const opId = operationId(meta);
      const key = `${id}|${impl.id ?? `${index}:${impl.name || ''}`}|${opId}`;
      tracks.set(key, spans);
      let pass = passes.get(opId);
      if (!pass) {
        pass = ms.passes.get(opId);
        if (!pass || angleDiff(heading, pass.heading) > TURN_DEG) pass = { id: this.passSeq++, heading };
        passes.set(opId, pass);
      }
      const previous = ms.track.get(key);
      if (!previous) continue;
      const quads = this.sweepsBetween(previous, spans);
      if (!quads.length) continue;
      const areaM2 = quads.reduce((sum, q) => sum + quadArea(q), 0);
      swept += areaM2;
      const op = this.getOp(opId, meta);
      const day = num(t.game?.day);
      const frame = { p: pass.id, h: Math.round(heading), d: day, q: quads, v: this.valuesOf(t, impl, meta, key, areaM2) };
      if (!driven) frame.m = id.replace(/^m:/, '');
      if (meta.kind === 'application' && impl.sprayer?.applying === true) frame.application = true;
      if (job?.op === opId) {
        frame.job = job.id;
        if (!jobSampleCounted) {
          frame.dist = distance;
          if (Number.isFinite(elapsed)) frame.dt = elapsed;
          jobSampleCounted = true;
        }
      }
      op.addFrame(frame, this.persist);
    }
    ms.track = tracks;
    ms.passes = passes;
    if (driven) {
      this.current = passes.keys().next().value ?? null;
      if (swept > 0 && !counterChanged) {
        this.counter.areaM2 += swept;
        this.counter.distanceM += distance;
        if (elapsed > 0 && this.counter.timeS !== null) this.counter.timeS += elapsed / 1000;
      }
    }
  }

  passReport() {
    if (!this.counter) return null;
    const { areaM2, distanceM, timeS } = this.counter;
    return { areaM2, distanceM, timeS };
  }

  jobCoverage(save, job) {
    const op = this.ops(save).get(job.op);
    let view = this.jobView;
    if (!view || view.id !== job.id || view.save !== save || view.source !== op) {
      view = this.jobView = { id: job.id, save, source: op, cursor: 0, worked: new Operation(job.op, {}),
        applied: null, distanceM: 0, timeS: null, sweptM2: 0 };
    }
    if (op) for (; view.cursor < op.frames.length; view.cursor++) {
      const frame = op.frames[view.cursor];
      if (frame.job !== job.id) continue;
      view.worked.addFrame({ ...frame }, false);
      view.sweptM2 += frame.q.reduce((area, q) => area + quadArea(q), 0);
      view.distanceM += frame.dist || 0;
      if (frame.dt !== undefined) view.timeS = (view.timeS || 0) + frame.dt / 1000;
      if (frame.application) {
        if (!view.applied) view.applied = new Operation(job.op, {});
        view.applied.addFrame({ ...frame }, false);
      }
    }
    return view;
  }

  coverageClass(save, id, type) {
    const op = this.ops(save).get(id);
    if (type === 'worked') return op || null;
    if (type !== 'applied' || !op?.hasApplication) return null;
    if (!op.appliedView) op.appliedView = { op: new Operation(id, op.meta), cursor: 0 };
    const view = op.appliedView;
    for (; view.cursor < op.frames.length; view.cursor++) {
      if (op.frames[view.cursor].application) view.op.addFrame({ ...op.frames[view.cursor] }, false);
    }
    return view.op;
  }

  flush(now = Date.now(), force = false) {
    if (!this.persist || (!force && now - this.lastFlush < FLUSH_MS)) return true;
    this.lastFlush = now;
    let saved = true;
    for (const [save, m] of this.saves) {
      for (const op of m.values()) {
        if (!op.pending.length) continue;
        const dir = this.saveDir(save);
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(path.join(dir, slug(op.id) + '.ndjson'), op.pending.join('\n') + '\n');
          op.pending = [];
        } catch (e) { saved = false; /* retried on the next flush */ }
      }
    }
    return saved;
  }

  clear(opId) {
    for (const [id, ms] of this.machines) {
      this.drainGround(ms, id, true);
      ms.ground.clear();
    }
    const m = this.ops();
    if (!m.has(opId)) return false;
    m.delete(opId);
    if (this.persist) { try { fs.unlinkSync(path.join(this.saveDir(this.save), slug(opId) + '.ndjson')); } catch (e) { /* gone */ } }
    return true;
  }

  // ---- API views
  status() {
    const m = this.ops();
    const ops = {};
    for (const op of m.values()) ops[op.id] = [op.seq, op.overlapVersion, op.hasApplication];
    return { save: this.save, current: this.current, ops };
  }
  list() { return { save: this.save, current: this.current, ops: [...this.ops().values()].map(op => op.summary()) }; }
  frames(opId, since = 0) {
    const op = this.ops().get(opId);
    if (!op) return { save: this.save, op: opId, seq: 0, frames: [], more: false };
    const start = op.frames.findIndex(f => f.s > since);
    const slice = start < 0 ? [] : op.frames.slice(start, start + FRAME_LIMIT);
    return { save: this.save, op: opId, seq: op.seq, frames: slice, more: start >= 0 && start + FRAME_LIMIT < op.frames.length, meta: op.meta };
  }
  overlap(opId) {
    const op = this.ops().get(opId);
    return op ? op.overlapRuns() : { version: 0, cell: CELL, runs: [] };
  }
}

module.exports = { CoverageStore, VALUE_KEYS, TILL_NAMES, quadArea, CELL, TILE, operationId };

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
const RUN_JOIN = 0.35;          // m: work areas closer than this are merged into one swath
const FLUSH_MS = 2000;
const FRAME_LIMIT = 20000;      // frames per /api/map/frames response

const rad = d => d * Math.PI / 180;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const CROP_NAMES = { WV_SPRINGWHEAT: 'Spring Wheat', WV_WINTERWHEAT: 'Winter Wheat', MAIZE: 'Corn', SOYBEAN: 'Soybeans' };
const title = s => CROP_NAMES[String(s || '').toUpperCase()] || String(s || '').toLowerCase().replace(/(^|[\s_-])([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).trim();

// Value keys a frame can carry. The display maps these to layers and colors.
const VALUE_KEYS = ['speed', 'yield', 'moisture', 'loss', 'rate', 'seedLph', 'skips', 'doubles', 'singulation', 'cv', 'depth',
  'soilMoisture', 'compaction', 'yieldPotential', 'soilN', 'soilP', 'soilK', 'soilPH'];

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
    for (const k of Object.keys(frame.v || {})) this.values.add(k);
    for (const q of frame.q) this.paint(q, frame.p);
    if (persist) this.pending.push(JSON.stringify(frame));
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
    this.track = new Map();      // implement key -> {runs, x, z}
    this.pass = { id: 0, heading: null, working: false, op: null, x: null, z: null };
    this.rates = new Map();      // implement key -> {level, area, rate}
    this.soil = null;
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
          op.addFrame({ p: rec.p, h: rec.h, d: rec.d, q: rec.q, v: rec.v || {} }, false);
          this.pass.id = Math.max(this.pass.id, (rec.p || 0) + 1);
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
    const seed = fills.find(f => /SEED/i.test(f.type || f.title || ''));
    if (impl.seeder || seed) {
      const crop = impl.seeder && impl.seeder.crop;
      return { kind: 'seeding', product: crop || '', title: 'Seeding' + (crop ? ' · ' + title(crop) : ''),
        rateUnit: impl.seeder ? (impl.seeder.unit === 'poundsPerAcre' ? 'lb/ac' : 'seeds/ac') : 'L/ha' };
    }
    const product = fills.find(f => f.level > 0) || fills[0];
    if (product && impl.turnedOn) {
      return { kind: 'application', product: product.type || product.title, title: 'Application · ' + (product.title || title(product.type)), rateUnit: 'L/ha' };
    }
    return { kind: 'tillage', product: '', title: 'Tillage' };
  }

  // Swath runs of one implement this frame: merged active work areas, ends ordered left to right.
  runsOf(impl, v) {
    const r = { x: Math.cos(rad(v.heading || 0)), z: Math.sin(rad(v.heading || 0)) };
    const lat = (x, z) => (x - v.x) * r.x + (z - v.z) * r.z;
    const segs = [];
    (impl.geometry || []).forEach(g => {
      const i = g.i ?? 0;
      if (!impl.areas || !impl.areas[i]) return;
      if ([g.sx, g.sz, g.wx, g.wz].some(n => typeof n !== 'number')) return;
      const ls = lat(g.sx, g.sz), lw = lat(g.wx, g.wz);
      segs.push(ls <= lw ? { l0: ls, l1: lw, a: [g.sx, g.sz], b: [g.wx, g.wz] } : { l0: lw, l1: ls, a: [g.wx, g.wz], b: [g.sx, g.sz] });
    });
    segs.sort((p, q) => p.l0 - q.l0);
    const runs = [];
    for (const s of segs) {
      const last = runs[runs.length - 1];
      if (last && s.l0 <= last.l1 + RUN_JOIN) { if (s.l1 > last.l1) { last.l1 = s.l1; last.b = s.b; } }
      else runs.push({ ...s });
    }
    return { runs, lat };
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
    } else if (op.kind === 'seeding' || op.kind === 'application') {
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
    if (this.soil) { set('soilN', this.soil.n, 0); set('soilP', this.soil.p, 0); set('soilK', this.soil.k, 0); set('soilPH', this.soil.ph, 2); }
    return v;
  }

  onFrame(t) {
    const now = Date.now();
    if (!t || t.state !== 'vehicle' || !t.vehicle || typeof t.vehicle.x !== 'number') {
      this.track.clear();
      this.pass.working = false;
      this.current = null;
      this.flush(now);
      return;
    }
    const save = (t.game && t.game.save) || 'unsaved';
    if (save !== this.save) { this.flush(now, true); this.save = save; this.track.clear(); }
    const sv = t.providers && t.providers['soil-fertilizer'] && t.providers['soil-fertilizer'].values;
    if (sv) this.soil = { n: sv.nitrogen && sv.nitrogen.value, p: sv.phosphorus && sv.phosphorus.value, k: sv.potassium && sv.potassium.value, ph: sv.pH };

    const v = t.vehicle;
    const imps = t.implements || [];
    let workedThisFrame = false;
    let currentOp = null;
    imps.forEach((impl, idx) => {
      const key = idx + ':' + (impl.name || '');
      const { runs, lat } = this.runsOf(impl, v);
      const prev = this.track.get(key);
      this.track.set(key, { runs });
      if (!runs.length) return;
      const opMeta = this.operationOf(t, impl);
      const opId = opMeta.kind + (opMeta.product ? ':' + slug(opMeta.product) : '');
      currentOp = currentOp || opId;
      workedThisFrame = true;
      if (!prev || !prev.runs.length) return;

      // new pass on a turn-around, a jump, or a change of operation
      const mid = runs[0].a;
      if (!this.pass.working || this.pass.op !== opId || this.pass.heading === null
        || angleDiff(v.heading || 0, this.pass.heading) > TURN_DEG
        || (this.pass.x !== null && Math.hypot(mid[0] - this.pass.x, mid[1] - this.pass.z) > MAX_STEP * 2)) {
        this.pass.id++;
        this.pass.heading = v.heading || 0;
      }
      this.pass.working = true; this.pass.op = opId; this.pass.x = mid[0]; this.pass.z = mid[1];

      const quads = [];
      for (const run of runs) {
        // previous run with the most lateral overlap, measured on this frame's axis
        let best = null, bestOv = 0;
        for (const p of prev.runs) {
          const p0 = Math.min(lat(...p.a), lat(...p.b)), p1 = Math.max(lat(...p.a), lat(...p.b));
          const ov = Math.min(run.l1, p1) - Math.max(run.l0, p0);
          if (ov > bestOv) { bestOv = ov; best = p; }
        }
        if (!best) continue;
        const step = Math.hypot(run.a[0] - best.a[0], run.a[1] - best.a[1]);
        if (step < 0.02 || step > MAX_STEP) continue;
        const q = [best.a[0], best.a[1], best.b[0], best.b[1], run.b[0], run.b[1], run.a[0], run.a[1]].map(n => +n.toFixed(2));
        quads.push(q);
      }
      if (!quads.length) return;
      const areaM2 = quads.reduce((s, q) => s + quadArea(q), 0);
      const op = this.getOp(opId, opMeta);
      const day = t.game && typeof t.game.day === 'number' ? t.game.day : undefined;
      op.addFrame({ p: this.pass.id, h: Math.round(v.heading || 0), d: day, q: quads, v: this.valuesOf(t, impl, opMeta, key, areaM2) }, this.persist);
    });
    if (!workedThisFrame) this.pass.working = false;
    this.current = currentOp;
    this.flush(now);
  }

  flush(now = Date.now(), force = false) {
    if (!this.persist || (!force && now - this.lastFlush < FLUSH_MS)) return;
    this.lastFlush = now;
    for (const [save, m] of this.saves) {
      for (const op of m.values()) {
        if (!op.pending.length) continue;
        const dir = this.saveDir(save);
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(path.join(dir, slug(op.id) + '.ndjson'), op.pending.join('\n') + '\n');
          op.pending = [];
        } catch (e) { /* retried on the next flush */ }
      }
    }
  }

  clear(opId) {
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
    for (const op of m.values()) ops[op.id] = [op.seq, op.overlapVersion];
    return { save: this.save, current: this.current, ops };
  }
  list() { return { save: this.save, current: this.current, ops: [...this.ops().values()].map(op => op.summary()) }; }
  frames(opId, since = 0) {
    const op = this.ops().get(opId);
    if (!op) return { op: opId, seq: 0, frames: [], more: false };
    const start = op.frames.findIndex(f => f.s > since);
    const slice = start < 0 ? [] : op.frames.slice(start, start + FRAME_LIMIT);
    return { op: opId, seq: op.seq, frames: slice, more: start >= 0 && start + FRAME_LIMIT < op.frames.length, meta: op.meta };
  }
  overlap(opId) {
    const op = this.ops().get(opId);
    return op ? op.overlapRuns() : { version: 0, cell: CELL, runs: [] };
  }
}

module.exports = { CoverageStore, VALUE_KEYS, quadArea };

'use strict';
// G5Link Ops Center field store. Fields own versioned boundaries with a source:
//   game     imported from the map's field polygons (fields.json from the mod), optional per save
//   driven   recorded by driving the edge (Boundary app on the display)
//   coverage traced from recorded coverage, e.g. after plowing or cultivating new ground
//   drawn    drawn on the Ops Center map
// The newest driven/coverage/drawn boundary wins over game boundaries unless the operator picks a version.
// Work records are computed from coverage (coverage.js) against the active boundaries when asked,
// so correcting a boundary also corrects the records. Stored in <dir>/maps/<save>/ops-fields.json.
// Zero dependencies.

const fs = require('fs');
const path = require('path');
const { quadArea } = require('./coverage.js');

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

// ---------------------------------------------------------------- geometry
function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}
function bbox(poly) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1 };
}
function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; cx += (poly[j][0] + poly[i][0]) * f; cz += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0] ? { x: poly[0][0], z: poly[0][1] } : { x: 0, z: 0 };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}
// x-ranges of the polygon interior on the horizontal line z
function scanline(poly, z) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z)) xs.push(xi + (z - zi) * (xj - xi) / (zj - zi));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}
function simplify(points, tol) {                      // Douglas-Peucker on an open polyline
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = points[a], [bx, bz] = points[b];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dz - (points[i][1] - az) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
function simplifyRing(ring, tol) {
  if (ring.length < 4) return ring;
  // split at the point farthest from the first so both halves are open polylines
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(ring.slice(0, far + 1), tol), b = simplify(ring.slice(far).concat([ring[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
const round1 = p => p.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);

// Outer edge of a set of grid cells (Set of "cx,cz") as a polygon in metres, tracing cell edges.
function traceOutline(cells, cell) {
  const has = (x, z) => cells.has(x + ',' + z);
  const next = new Map();                             // vertex "x,z" -> list of next vertices
  const add = (x0, z0, x1, z1) => { const k = x0 + ',' + z0; if (!next.has(k)) next.set(k, []); next.get(k).push([x1, z1]); };
  for (const key of cells) {
    const [x, z] = key.split(',').map(Number);
    // edges with the inside on the left, walking counter-clockwise around each cell
    if (!has(x, z - 1)) add(x, z, x + 1, z);
    if (!has(x + 1, z)) add(x + 1, z, x + 1, z + 1);
    if (!has(x, z + 1)) add(x + 1, z + 1, x, z + 1);
    if (!has(x - 1, z)) add(x, z + 1, x, z);
  }
  const used = new Set(), loops = [];
  for (const [start, outs] of next) {
    for (let o = 0; o < outs.length; o++) {
      const id = start + '>' + o;
      if (used.has(id)) continue;
      const loop = [];
      let cur = start, idx = o, guard = 0;
      while (guard++ < 2e6) {
        const list = next.get(cur);
        const eid = cur + '>' + idx;
        if (!list || used.has(eid)) break;
        used.add(eid);
        loop.push(cur.split(',').map(Number));
        const [nx, nz] = list[idx];
        cur = nx + ',' + nz;
        const nl = next.get(cur) || [];
        idx = nl.findIndex((_, i) => !used.has(cur + '>' + i));
        if (idx < 0) break;
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  if (!loops.length) return null;
  loops.sort((a, b) => polygonArea(b) - polygonArea(a));
  return loops[0].map(([x, z]) => [x * cell, z * cell]);
}

// ---------------------------------------------------------------- store
class FieldStore {
  constructor({ dir = null, persist = false, coverage = null } = {}) {
    this.dir = dir;
    this.persist = !!(persist && dir);
    this.coverage = coverage;
    this.saves = new Map();
    this.game = new Map();                             // save -> latest fields.json from the mod
    this.version = 0;
    this.lastWorkMs = 10000;
  }
  file(save) { return path.join(this.dir, 'maps', slug(save), 'ops-fields.json'); }
  db(save) {
    if (!this.saves.has(save)) {
      let d = { settings: { importGame: true }, fields: {}, nextCustom: 1 };
      if (this.persist) { try { d = { ...d, ...JSON.parse(fs.readFileSync(this.file(save), 'utf8')) }; } catch (e) { /* new save */ } }
      this.saves.set(save, d);
    }
    return this.saves.get(save);
  }
  write(save) {
    this.version++;
    if (!this.persist) return;
    const f = this.file(save);
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(this.db(save))); fs.renameSync(f + '.tmp', f); }
    catch (e) { console.warn('Could not save fields:', e.message); }
  }

  // fields.json from the mod: {farmId, fields: [{id, name, areaHa, farmland, owner, x, z, polygon}]}
  importGame(save, game) {
    if (!game || !Array.isArray(game.fields)) return;
    this.game.set(save, game);
    const d = this.db(save);
    let changed = false;
    for (const gf of game.fields) {
      if (!Array.isArray(gf.polygon) || gf.polygon.length < 3) continue;
      const id = String(gf.id);
      let f = d.fields[id];
      if (!f) {
        if (!d.settings.importGame) continue;
        f = d.fields[id] = { id, name: gf.name || `Field ${gf.id}`, boundaries: [], game: true };
        changed = true;
      }
      if (f.farmland !== gf.farmland || f.owner !== gf.owner) { f.farmland = gf.farmland; f.owner = gf.owner; changed = true; }
      if (!d.settings.importGame) continue;
      const lastGame = [...f.boundaries].reverse().find(b => b.source === 'game');
      const poly = round1(gf.polygon);
      if (!lastGame || JSON.stringify(lastGame.polygon) !== JSON.stringify(poly)) {
        f.boundaries.push({ v: f.boundaries.length + 1, source: 'game', polygon: poly, areaHa: +(polygonArea(poly) / 10000).toFixed(3), at: Date.now() });
        changed = true;
      }
    }
    if (changed) this.write(save);
  }
  setSettings(save, s) {
    const d = this.db(save);
    if (typeof s.importGame === 'boolean') d.settings.importGame = s.importGame;
    if (typeof s.client === 'string' && s.client.trim()) d.settings.client = s.client.trim().slice(0, 60);
    this.write(save);
    if (d.settings.importGame && this.game.has(save)) this.importGame(save, this.game.get(save));
    return d.settings;
  }
  active(f) {
    if (!f || !f.boundaries.length) return null;
    if (f.activeV) { const b = f.boundaries.find(x => x.v === f.activeV); if (b) return b; }
    const own = [...f.boundaries].reverse().find(b => b.source !== 'game');
    return own || f.boundaries[f.boundaries.length - 1];
  }
  // Game field containing a point (for naming a driven or coverage boundary).
  gameFieldAt(save, x, z) {
    const g = this.game.get(save);
    if (!g) return null;
    return g.fields.find(f => Array.isArray(f.polygon) && f.polygon.length > 2 && inPolygon(f.polygon, x, z)) || null;
  }
  addBoundary(save, { fieldId = null, name = null, source, polygon, note = null, newField = false }) {
    if (!Array.isArray(polygon) || polygon.length < 3) throw new Error('a boundary needs at least 3 points');
    if (!['driven', 'coverage', 'drawn', 'game'].includes(source)) throw new Error('unknown boundary source');
    const d = this.db(save);
    const poly = round1(polygon);
    let f = fieldId ? d.fields[String(fieldId)] : null;
    if (!f) {
      const c = centroid(poly);
      const gf = fieldId || newField ? null : this.gameFieldAt(save, c.x, c.z);
      const id = fieldId ? String(fieldId) : gf ? String(gf.id) : 'u' + (d.nextCustom++);
      f = d.fields[id] || (d.fields[id] = { id, name: name || (gf && gf.name) || (gf ? `Field ${gf.id}` : `New Field ${id.slice(1)}`), boundaries: [] });
    }
    if (name) f.name = name;
    const b = { v: (f.boundaries.reduce((m, x) => Math.max(m, x.v), 0)) + 1, source, polygon: poly, areaHa: +(polygonArea(poly) / 10000).toFixed(3), at: Date.now(), note };
    f.boundaries.push(b);
    delete f.activeV;                                  // the new boundary becomes active
    this.write(save);
    return { field: f.id, v: b.v };
  }
  setActive(save, fieldId, v) {
    const f = this.db(save).fields[String(fieldId)];
    if (!f || !f.boundaries.some(b => b.v === v)) throw new Error('no such boundary');
    f.activeV = v; this.write(save);
  }
  rename(save, fieldId, name) {
    const f = this.db(save).fields[String(fieldId)];
    if (!f || !String(name || '').trim()) throw new Error('no such field or empty name');
    f.name = String(name).trim().slice(0, 60); this.write(save);
  }
  removeBoundary(save, fieldId, v) {
    const d = this.db(save), f = d.fields[String(fieldId)];
    if (!f) throw new Error('no such field');
    f.boundaries = f.boundaries.filter(b => b.v !== v);
    if (f.activeV === v) delete f.activeV;
    if (!f.boundaries.length) delete d.fields[f.id];
    this.write(save);
  }

  list(save) {
    const d = this.db(save);
    return Object.values(d.fields).map(f => {
      const b = this.active(f);
      return b ? { id: f.id, name: f.name, owner: f.owner, farmland: f.farmland, source: b.source, v: b.v, areaHa: b.areaHa,
        versions: f.boundaries.length, polygon: b.polygon, center: centroid(b.polygon) } : null;
    }).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }
  field(save, id) {
    const f = this.db(save).fields[String(id)];
    if (!f) return null;
    const b = this.active(f);
    return { ...f, active: b ? b.v : null, center: b ? centroid(b.polygon) : null };
  }
  // Field whose active boundary contains a point.
  fieldAt(save, x, z, list = this.list(save)) {
    for (const f of list) {
      if (!f.bb) f.bb = bbox(f.polygon);
      if (x < f.bb.x0 || x > f.bb.x1 || z < f.bb.z0 || z > f.bb.z1) continue;
      if (inPolygon(f.polygon, x, z)) return f;
    }
    return null;
  }

  // ---------------------------------------------------------------- work records
  // Unique covered and overlapped area of one operation inside a polygon, on the coverage grid.
  coveredIn(op, poly) {
    const cell = 1, bb = bbox(poly);
    let covered = 0, overlap = 0;
    for (let cz = Math.floor(bb.z0); cz <= Math.ceil(bb.z1); cz++) {
      for (const [xa, xb] of scanline(poly, (cz + 0.5) * cell)) {
        for (let cx = Math.ceil(xa - 0.5); cx + 0.5 <= xb; cx++) {
          const c = op.cell(cx, cz, false);
          if (!c) { cx = (Math.floor(cx / 64) + 1) * 64 - 1; continue; }      // skip an empty tile
          const n = c.t.cnt[c.i];
          if (n) { covered++; if (n > 1) overlap++; }
        }
      }
    }
    return { coveredHa: covered / 10000, overlapHa: overlap / 10000 };
  }
  records(save, fieldId) {
    const fields = this.list(save);
    const target = fieldId ? fields.find(f => f.id === String(fieldId)) : null;
    if (fieldId && !target) return [];
    const ops = this.coverage ? [...this.coverage.ops(save).values()] : [];
    const out = [];
    for (const op of ops) {
      const per = new Map();
      for (const fr of op.frames) {
        const q = fr.q[0];
        if (!q) continue;
        const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cz = (q[1] + q[3] + q[5] + q[7]) / 4;
        const f = target ? (inPolygon(target.polygon, cx, cz) ? target : null) : this.fieldAt(save, cx, cz, fields);
        if (target && !f) continue;                     // only this field's work
        const key = f ? f.id : '';
        let r = per.get(key);
        if (!r) { r = { field: f ? f.id : null, fieldName: f ? f.name : 'Outside fields', op: op.id, title: op.meta.title, kind: op.meta.kind,
          product: op.meta.product, rateUnit: op.meta.rateUnit, swathHa: 0, frames: 0, first: null, last: null, sums: {}, weights: {} }; per.set(key, r); }
        const a = fr.q.reduce((s, qq) => s + quadArea(qq), 0);
        r.swathHa += a / 10000; r.frames++;
        if (fr.d !== undefined) { if (r.first === null || fr.d < r.first) r.first = fr.d; if (r.last === null || fr.d > r.last) r.last = fr.d; }
        for (const [k, v] of Object.entries(fr.v || {})) {
          if (typeof v !== 'number') continue;
          r.sums[k] = (r.sums[k] || 0) + v * a; r.weights[k] = (r.weights[k] || 0) + a;
        }
      }
      for (const r of per.values()) {
        const avg = {};
        for (const k of Object.keys(r.sums)) avg[k] = +(r.sums[k] / r.weights[k]).toFixed(3);
        const f = r.field ? fields.find(x => x.id === r.field) : null;
        const area = f ? this.coveredIn(op, f.polygon) : { coveredHa: null, overlapHa: null };
        out.push({ field: r.field, fieldName: r.fieldName, op: r.op, title: r.title, kind: r.kind, product: r.product, rateUnit: r.rateUnit,
          firstDay: r.first, lastDay: r.last, frames: r.frames, swathHa: +r.swathHa.toFixed(3),
          coveredHa: area.coveredHa === null ? null : +area.coveredHa.toFixed(3), overlapHa: area.overlapHa === null ? null : +area.overlapHa.toFixed(3),
          fieldHa: f ? f.areaHa : null, avg });
      }
    }
    return out.sort((a, b) => (b.lastDay ?? -1) - (a.lastDay ?? -1));
  }

  // Latest work type per field (for coloring fields like "Last Work Type"), cheap and cached.
  lastWork(save) {
    const ops = this.coverage ? [...this.coverage.ops(save).values()] : [];
    const key = save + '|' + this.version + '|' + ops.map(o => o.id + ':' + o.seq).join(',');
    const now = Date.now();
    if (this.lwCache && this.lwCache.key === key) return this.lwCache.out;
    // new coverage refreshes at most every lastWorkMs; a boundary change (version) refreshes at once
    if (this.lwCache && this.lwCache.save === save && this.lwCache.version === this.version && now - this.lwCache.at < this.lastWorkMs) return this.lwCache.out;
    const fields = this.list(save), out = {};
    for (const op of ops) {
      // sample every 10th frame: enough to know which fields an operation touched and when
      for (let i = 0; i < op.frames.length; i += 10) {
        const fr = op.frames[i], q = fr.q[0];
        if (!q) continue;
        const f = this.fieldAt(save, (q[0] + q[4]) / 2, (q[1] + q[5]) / 2, fields);
        if (!f) continue;
        const day = fr.d ?? -1, cur = out[f.id];
        if (!cur || day > cur.day || (day === cur.day && fr.s > cur.s && op.id === cur.op)) out[f.id] = { kind: op.meta.kind, title: op.meta.title, op: op.id, day, s: fr.s };
      }
    }
    this.lwCache = { key, save, version: this.version, at: now, out };
    return out;
  }

  // ---------------------------------------------------------------- Harvest Profit
  // Profit settings per savegame: machinery cost per hectare by work type, land rent, crop price overrides.
  profitSettings(save) {
    const d = this.db(save);
    d.settings.profit = Object.assign({ currency: '$', rent: 0, machinery: { tillage: 30, seeding: 25, application: 10, harvest: 55 }, prices: {} }, d.settings.profit || {});
    return d.settings.profit;
  }
  setProfitSettings(save, p) {
    const cur = this.profitSettings(save);
    const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
    if (typeof p.currency === 'string' && p.currency.trim()) cur.currency = p.currency.trim().slice(0, 4);
    if (num(p.rent) !== undefined) cur.rent = p.rent;
    if (p.machinery && typeof p.machinery === 'object') for (const k of ['tillage', 'seeding', 'application', 'harvest']) if (num(p.machinery[k]) !== undefined) cur.machinery[k] = p.machinery[k];
    if (p.prices && typeof p.prices === 'object') {
      for (const [crop, v] of Object.entries(p.prices)) {
        if (v === null || v === '') delete cur.prices[crop];
        else if (num(v) !== undefined) cur.prices[String(crop).toUpperCase()] = v;
      }
    }
    this.write(save);
    return cur;
  }
  // Price of a crop per tonne: the operator's price if set, else the game's (price per litre / tonnes per litre).
  pricePerT(save, crop, econ) {
    const ps = this.profitSettings(save), key = String(crop || '').toUpperCase();
    if (typeof ps.prices[key] === 'number') return { price: ps.prices[key], source: 'set' };
    const ft = econ && econ.fillTypes && econ.fillTypes[key];
    if (ft && ft.price > 0 && ft.mass > 0) return { price: ft.price / ft.mass, source: 'game' };
    return { price: null, source: 'none' };
  }
  // P&L per field from the work records: revenue from harvested tonnes, costs from seed and product used
  // (game input costs), machinery per hectare worked and rent per field hectare.
  profit(save, econ) {
    const ps = this.profitSettings(save), recs = this.records(save), fields = this.list(save);
    const costOf = name => { const ft = econ && econ.fillTypes && econ.fillTypes[String(name || '').toUpperCase()]; return ft && ft.cost > 0 ? ft.cost : null; };
    const chemical = name => /HERBICIDE|PESTICIDE|INSECTICIDE|FUNGICIDE|CHEMICAL|DEFOLIANT|GROWTHREGULATOR/i.test(String(name || ''));
    const out = [];
    // Farm Finance leases: cash rent per farmland (split over its fields by area), crop-share splits
    const ff = econ && econ.farmFinance, contracts = (ff && ff.contracts) || {};
    const farmlandArea = {};
    for (const f of fields) if (f.farmland !== undefined && f.farmland !== null) farmlandArea[f.farmland] = (farmlandArea[f.farmland] || 0) + (f.areaHa || 0);
    for (const f of fields) {
      const fr = recs.filter(r => r.field === f.id);
      if (!fr.length) continue;
      const c = f.farmland !== undefined && f.farmland !== null ? contracts[String(f.farmland)] : null;
      const lease = c && c.kind === 'in' ? c : null;
      const share = lease && lease.leaseType === 'share' ? { crop: lease.landownerShare || 0, inputs: lease.inputShare || 0 } : null;
      const leaseRent = lease && lease.leaseType !== 'share' && typeof lease.annualRent === 'number'
        ? lease.annualRent * (f.areaHa || 0) / (farmlandArea[f.farmland] || f.areaHa || 1) : null;
      const e = { seed: 0, fertilizer: 0, chemical: 0, machinery: 0, rent: share ? 0 : leaseRent !== null ? leaseRent : f.areaHa * ps.rent };
      let tonnes = 0, revenue = 0, crop = null, harvestHa = 0, missing = [];
      for (const r of fr) {
        const ha = r.coveredHa || 0, a = r.avg || {};
        e.machinery += ha * (ps.machinery[r.kind] || 0);
        if (r.kind === 'harvest') {
          crop = r.product || crop;
          const t = (a.yield || 0) * ha;
          const p = this.pricePerT(save, r.product, econ);
          tonnes += t; harvestHa += ha;
          if (p.price !== null) revenue += t * p.price; else missing.push('price of ' + (r.product || 'crop'));
        } else if (r.kind === 'seeding') {
          crop = crop || r.product;
          const lph = typeof a.seedLph === 'number' ? a.seedLph : r.rateUnit === 'L/ha' ? a.rate : null;
          const c = costOf('SEEDS');
          if (lph !== null && lph !== undefined && c !== null) e.seed += lph * ha * c; else missing.push('seed use');
        } else if (r.kind === 'application') {
          const c = costOf(r.product);
          if (typeof a.rate === 'number' && c !== null) e[chemical(r.product) ? 'chemical' : 'fertilizer'] += a.rate * ha * c;
          else missing.push('cost of ' + (r.product || 'product'));
        }
      }
      if (share) {                                       // crop share: the landowner takes part of the crop and pays part of the inputs
        revenue *= 1 - share.crop;
        for (const k of ['seed', 'fertilizer', 'chemical']) e[k] *= 1 - share.inputs;
      }
      const total = e.seed + e.fertilizer + e.chemical + e.machinery + e.rent;
      const price = crop ? this.pricePerT(save, crop, econ) : { price: null, source: 'none' };
      const ha = f.areaHa || 1;
      out.push({ field: f.id, name: f.name, areaHa: f.areaHa, crop, tonnes: +tonnes.toFixed(3), harvestHa: +harvestHa.toFixed(3),
        revenue: +revenue.toFixed(2), expenses: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, +v.toFixed(2)])), expensesTotal: +total.toFixed(2),
        net: +(revenue - total).toFixed(2), netPerHa: +((revenue - total) / ha).toFixed(2), expensesPerHa: +(total / ha).toFixed(2),
        pricePerT: price.price === null ? null : +price.price.toFixed(2), priceSource: price.source,
        breakEvenYield: price.price ? +(total / ha / price.price).toFixed(3) : null,          // t/ha
        breakEvenPrice: tonnes > 0 ? +(total / tonnes).toFixed(2) : null,                     // per tonne
        operations: fr.map(r => r.title), missing: [...new Set(missing)],
        lease: lease ? { type: lease.leaseType || 'cash', annualRent: lease.annualRent ?? null, landownerShare: lease.landownerShare ?? null,
          inputShare: lease.inputShare ?? null, endCropYear: lease.endCropYear ?? null } : null });
    }
    const sum = k => out.reduce((s, x) => s + (k === 'expenses' ? x.expensesTotal : x[k]), 0);
    return { currency: ps.currency, settings: ps, fields: out.sort((a, b) => b.netPerHa - a.netPerHa),
      totals: { revenue: +sum('revenue').toFixed(2), expenses: +sum('expenses').toFixed(2), net: +sum('net').toFixed(2), areaHa: +out.reduce((s, x) => s + x.areaHa, 0).toFixed(3) },
      finances: econ ? { balance: econ.balance ?? null, loan: econ.loan ?? null, equity: econ.equity ?? null,
        farmFinance: ff ? { creditScore: ff.creditScore ?? null, creditGrade: ff.creditGrade ?? null, bankActive: ff.bankActive !== false,
          inputAccount: ff.inputAccount || null, leases: Object.keys(contracts).length } : null } : null };
  }

  // ---------------------------------------------------------------- boundary from coverage
  // Region of covered ground connected to a field (or to a point), outside every other field,
  // closed by `close` cells, traced and simplified. Returns a proposal; nothing is saved.
  fromCoverage(save, { fieldId = null, x = null, z = null, margin = 250, close = 2 } = {}) {
    const fields = this.list(save);
    const field = fieldId ? fields.find(f => f.id === String(fieldId)) : null;
    if (fieldId && !field) throw new Error('no such field');
    const others = fields.filter(f => !field || f.id !== field.id);
    const ops = this.coverage ? [...this.coverage.ops(save).values()] : [];
    const bb = field ? bbox(field.polygon) : { x0: x, x1: x, z0: z, z1: z };
    const X0 = Math.floor(bb.x0 - margin), X1 = Math.ceil(bb.x1 + margin), Z0 = Math.floor(bb.z0 - margin), Z1 = Math.ceil(bb.z1 + margin);
    const W = X1 - X0 + 1, H = Z1 - Z0 + 1;
    if (W * H > 9e6) throw new Error('area too large');
    const mask = new Uint8Array(W * H);
    const idx = (cx, cz) => (cz - Z0) * W + (cx - X0);
    const ownedByOther = (px, pz) => others.some(f => { if (!f.bb) f.bb = bbox(f.polygon); return px >= f.bb.x0 && px <= f.bb.x1 && pz >= f.bb.z0 && pz <= f.bb.z1 && inPolygon(f.polygon, px, pz); });
    if (field) {                                        // field interior by scanline
      for (let cz = Z0; cz <= Z1; cz++) {
        for (const [xa, xb] of scanline(field.polygon, cz + 0.5)) {
          for (let cx = Math.max(X0, Math.ceil(xa - 0.5)); cx + 0.5 <= xb && cx <= X1; cx++) mask[idx(cx, cz)] = 1;
        }
      }
    }
    for (const op of ops) {                             // covered cells, tile by tile
      for (const t of op.tiles.values()) {
        for (let i = 0; i < t.cnt.length; i++) {
          if (!t.cnt[i]) continue;
          const cx = t.tx * 64 + (i % 64), cz = t.tz * 64 + Math.floor(i / 64);
          if (cx < X0 || cx > X1 || cz < Z0 || cz > Z1) continue;
          const k = idx(cx, cz);
          if (!mask[k] && !ownedByOther(cx + 0.5, cz + 0.5)) mask[k] = 1;
        }
      }
    }
    // closing: dilate then erode, so the strips between passes and small skips don't split the field
    const morph = (src, grow) => {
      const dst = new Uint8Array(src.length);
      for (let zz = 0; zz < H; zz++) for (let xx = 0; xx < W; xx++) {
        let v = grow ? 0 : 1;
        for (let dz = -close; dz <= close && (grow ? !v : v); dz++) for (let dx = -close; dx <= close; dx++) {
          const ax = xx + dx, az = zz + dz;
          const s = ax >= 0 && az >= 0 && ax < W && az < H ? src[az * W + ax] : 0;
          if (grow && s) { v = 1; break; }
          if (!grow && !s) { v = 0; break; }
        }
        dst[zz * W + xx] = v;
      }
      return dst;
    };
    const closed = close > 0 ? morph(morph(mask, true), false) : mask;
    // flood fill from the seed (field interior or the given point)
    let seed = null;
    if (field) {
      const c = centroid(field.polygon);
      const cx = Math.floor(c.x), cz = Math.floor(c.z);
      if (closed[idx(cx, cz)]) seed = [cx, cz];
      else for (let i = 0; i < closed.length && !seed; i++) if (closed[i]) { const sx = (i % W) + X0, sz = Math.floor(i / W) + Z0; if (inPolygon(field.polygon, sx + 0.5, sz + 0.5)) seed = [sx, sz]; }
    } else {
      const cx = Math.floor(x), cz = Math.floor(z);
      if (closed[idx(cx, cz)]) seed = [cx, cz];
    }
    if (!seed) return null;
    const region = new Set(), stack = [seed], seen = new Uint8Array(W * H);
    seen[idx(...seed)] = 1;
    while (stack.length) {
      const [cx, cz] = stack.pop();
      region.add(cx + ',' + cz);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < X0 || nx > X1 || nz < Z0 || nz > Z1) continue;
        const k = idx(nx, nz);
        if (!seen[k] && closed[k]) { seen[k] = 1; stack.push([nx, nz]); }
      }
    }
    const ring = traceOutline(region, 1);
    if (!ring) return null;
    const polygon = round1(simplifyRing(ring, 1.2));
    const areaHa = +(polygonArea(polygon) / 10000).toFixed(3);
    return { polygon, areaHa, addedHa: field ? +(areaHa - field.areaHa).toFixed(3) : areaHa, field: field ? field.id : null };
  }
}

module.exports = { FieldStore, polygonArea, inPolygon, simplifyRing, traceOutline, centroid };

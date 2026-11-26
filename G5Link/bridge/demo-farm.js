'use strict';
// Demo farm for the Ops Center: 50 fields, 2500 acres, in different states of the season. Field 23 is the field
// the demo machine works (the planter / combine / cultivator route, or the 1500 ac field with --demo bigfield);
// the other 49 fill the farm up to 2500 ac, packed like a patchwork with roads between them.
// Each owned field gets a history (tillage, seeding, spraying, harvest) recorded as real coverage frames, so the
// Ops Center's work records, last work type, yield and moisture maps and prescriptions all work on it.
// Dependency-free (Node 18+), like the bridge.

const { polygonArea } = require('./fields.js');

const TARGET_HA = 2500 / 2.47105;      // 2500 ac
const FIELDS = 50;
const GAP = 24;                        // m of road / hedge between fields
const STEP = 8;                        // m between recorded frames along a pass

// seeded random, so the farm is the same every run
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const CROPS = [
  { id: 'MAIZE', name: 'Corn', yld: 11.2, moist: [17, 25], rate: 34000, unit: 'seeds/ac', varieties: ['P1197AM', 'DKC62-08', 'NK0760'] },
  { id: 'SOYBEAN', name: 'Soybeans', yld: 3.6, moist: [11, 15], rate: 140000, unit: 'seeds/ac', varieties: ['AG30XF2', 'P22T69E'] },
  { id: 'WHEAT', name: 'Wheat', yld: 6.4, moist: [12, 16], rate: 110, unit: 'lb/ac', varieties: ['AAC Brandon', 'Cardale'] },
  { id: 'CANOLA', name: 'Canola', yld: 3.1, moist: [7, 11], rate: 5, unit: 'lb/ac', varieties: ['InVigor L340PC', '75-65 RR'] },
  { id: 'BARLEY', name: 'Barley', yld: 5.6, moist: [12, 15], rate: 100, unit: 'lb/ac', varieties: ['CDC Austenson'] },
  { id: 'OATS', name: 'Oats', yld: 4.4, moist: [12, 15], rate: 90, unit: 'lb/ac', varieties: ['CS Camden'] },
];
const NAMES = { 3: 'Home Quarter', 7: 'River Bottom', 11: 'Church Section', 14: 'Smith 80', 18: 'Creek Field', 27: 'Hill 40',
  31: 'North Forty', 36: 'Old Pasture', 41: 'Gravel Pit', 46: 'Johnson Place' };
// season states (49 fields besides 23): how many of each
const STATE_MIX = [['harvested', 12], ['harvesting', 4], ['growing', 10], ['seeded', 7], ['tilled', 6], ['idle', 5], ['notOwned', 5]];

function bbox(poly) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
}
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

// a field shape inside a w x h box: jittered corners, sometimes a cut corner or a bulge, scaled to the exact area
function shape(r, cx, cz, w, h, ha) {
  const j = (s) => (r() - 0.5) * 0.12 * s;
  let pts = [[-w / 2 + j(w), -h / 2 + j(h)], [w / 2 + j(w), -h / 2 + j(h)], [w / 2 + j(w), h / 2 + j(h)], [-w / 2 + j(w), h / 2 + j(h)]];
  const k = r();
  if (k < 0.3) {                                    // cut corner (a creek, a yard, a road)
    const c = Math.floor(r() * 4), p = pts[c], n = pts[(c + 1) % 4], q = pts[(c + 3) % 4], f = 0.25 + r() * 0.2;
    pts.splice(c, 1, [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], [p[0] + (n[0] - p[0]) * f, p[1] + (n[1] - p[1]) * f]);
  } else if (k < 0.45) {                            // a bulge on one side
    const c = Math.floor(r() * 4), p = pts[c], n = pts[(c + 1) % 4];
    const mx = (p[0] + n[0]) / 2, mz = (p[1] + n[1]) / 2, len = Math.hypot(n[0] - p[0], n[1] - p[1]);
    const ox = -(n[1] - p[1]) / len, oz = (n[0] - p[0]) / len;
    pts.splice(c + 1, 0, [mx - ox * len * 0.12, mz - oz * len * 0.12]);
  }
  const a = polygonArea(pts) / 10000, s = Math.sqrt(ha / a);
  return pts.map(([x, z]) => [+(cx + x * s).toFixed(1), +(cz + z * s).toFixed(1)]);
}

// Straight passes over a polygon along heading h (display convention: 0 = north (-z), clockwise)
function passes(poly, hDeg, W) {
  const h = hDeg * Math.PI / 180, f = [Math.sin(h), -Math.cos(h)], rt = [Math.cos(h), Math.sin(h)];
  const across = p => p[0] * rt[0] + p[1] * rt[1], along = p => p[0] * f[0] + p[1] * f[1];
  const os = poly.map(across), o0 = Math.min(...os), o1 = Math.max(...os), out = [];
  for (let o = o0 + W / 2; o < o1; o += W) {
    const ts = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ua = across(a) - o, ub = across(b) - o;
      if ((ua <= 0) !== (ub <= 0)) { const u = ua / (ua - ub); ts.push(along(a) + (along(b) - along(a)) * u); }
    }
    ts.sort((p, q) => p - q);
    for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 4) out.push({ o, t0: ts[i], t1: ts[i + 1] });
  }
  const pt = (o, t) => [rt[0] * o + f[0] * t, rt[1] * o + f[1] * t];
  return { list: out, pt, f, rt };
}

// ---------------------------------------------------------------- the farm
// fixed: {id: 23, polygon} (the demo machine's field); exclude: boxes to keep clear (yard, the big field)
function build({ fixed, exclude = [], region }) {
  const r = rng(2500);
  const fixedHa = polygonArea(fixed.polygon) / 10000;
  // areas: varied, 8..70 ha before scaling to the remaining acres
  const raw = Array.from({ length: FIELDS - 1 }, () => 6 + Math.pow(r(), 1.6) * 64);
  const sum = raw.reduce((a, b) => a + b, 0), restHa = TARGET_HA - fixedHa;
  const areas = raw.map(a => Math.max(2.5, a * restHa / sum));
  const ids = []; for (let i = 1; i <= FIELDS; i++) if (i !== fixed.id) ids.push(i);
  // states, shuffled the same way every run
  const states = STATE_MIX.flatMap(([s, n]) => Array(n).fill(s));
  for (let i = states.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [states[i], states[k]] = [states[k], states[i]]; }
  // shelf packing inside the region, around the excluded boxes
  const keep = [bbox(fixed.polygon), ...exclude].map(b => ({ x0: b.x0 - GAP * 2, x1: b.x1 + GAP * 2, z0: b.z0 - GAP * 2, z1: b.z1 + GAP * 2 }));
  let x = region.x0, z = region.z0, rowH = 0;
  const fields = [{ id: fixed.id, name: NAMES[fixed.id] || `Field ${fixed.id}`, polygon: fixed.polygon, state: 'live', owner: 1 }];
  ids.forEach((id, n) => {
    const ha = areas[n], aspect = 0.6 + r() * 1.6;
    const w0 = Math.sqrt(ha * 10000 * aspect), h0 = ha * 10000 / w0;
    // the shape first (at the origin), then packed by its real bounding box so neighbours never overlap
    const local = shape(r, 0, 0, w0, h0, ha), lb = bbox(local), w = lb.x1 - lb.x0, h = lb.z1 - lb.z0;
    for (let guard = 0; guard < 400; guard++) {
      if (x + w > region.x1) { x = region.x0; z += rowH + GAP; rowH = 0; }
      const box = { x0: x, x1: x + w, z0: z, z1: z + h };
      const blocker = keep.find(b => hit(b, box));
      if (!blocker) break;
      x = blocker.x1 + GAP;
    }
    const poly = local.map(([px, pz]) => [+(px - lb.x0 + x).toFixed(1), +(pz - lb.z0 + z).toFixed(1)]);
    x += w + GAP; rowH = Math.max(rowH, h);
    const state = states[n] || 'idle';
    fields.push({ id, name: NAMES[id] || `Field ${id}`, polygon: poly, state, owner: state === 'notOwned' ? 0 : 1,
      crop: CROPS[Math.floor(r() * CROPS.length)], heading: Math.round((r() < 0.5 ? 0 : 90) + (r() - 0.5) * 16 + 360) % 360,
      quality: 0.78 + r() * 0.34, seed: Math.floor(r() * 1e9) });
  });
  fields.sort((a, b) => a.id - b.id);
  return { fields, ha: fields.reduce((a, f) => a + polygonArea(f.polygon) / 10000, 0) };
}

// fields.json for the bridge's game import (the shape G5Link.lua writes)
function gameFields(farm, farmName = 'Demo Farm') {
  return { farmId: 1, farmName, fields: farm.fields.map(f => ({ id: f.id, name: f.name, farmland: f.id, owner: f.owner,
    areaHa: +(polygonArea(f.polygon) / 10000).toFixed(3), polygon: f.polygon })) };
}

// ---------------------------------------------------------------- history as coverage
const g2 = (x, z, cx, cz, rad) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * rad * rad));
function plan(f, day) {
  const r = rng(f.seed);
  const d = (a, b) => Math.max(1, Math.min(day - 1, Math.round(a + r() * (b - a))));
  const c = f.crop, variety = c.varieties[Math.floor(r() * c.varieties.length)];
  const sow = { kind: 'seeding', crop: c, variety, day: d(day - 52, day - 40) };
  const spray = { kind: 'application', product: r() < 0.6 ? 'HERBICIDE' : 'LIQUIDFERTILIZER', day: d(day - 32, day - 20) };
  const till = { kind: 'tillage', tool: ['cultivator', 'disc', 'subsoiler', 'plow'][Math.floor(r() * 4)], day: d(day - 58, day - 54) };
  switch (f.state) {
    case 'harvested': return [sow, spray, { kind: 'harvest', crop: c, day: d(day - 14, day - 2) }];
    case 'harvesting': return [sow, spray, { kind: 'harvest', crop: c, day: day - 1, part: 0.3 + r() * 0.4 }];
    case 'growing': return [till, sow, { ...spray, day: d(day - 12, day - 4) }];
    case 'seeded': return [{ ...sow, day: d(day - 6, day - 1) }];
    case 'tilled': return [{ ...till, day: d(day - 5, day - 1) }];
    default: return [];
  }
}
const WIDTH = { harvest: 12.19, seeding: 12.19, application: 27.43, tillage: 9.14 };
const TITLE = { HERBICIDE: 'Herbicide', LIQUIDFERTILIZER: 'Liquid Fertilizer' };
function opOf(o) {
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (o.kind === 'harvest') return { id: 'harvest:' + slug(o.crop.id), meta: { kind: 'harvest', product: o.crop.id, title: 'Harvest · ' + o.crop.name } };
  if (o.kind === 'seeding') return { id: `seeding:${slug(o.crop.id)}:${slug(o.variety)}`,
    meta: { kind: 'seeding', product: o.crop.id, variety: o.variety, title: `Seeding · ${o.crop.name} · ${o.variety}`, rateUnit: o.crop.unit } };
  if (o.kind === 'application') return { id: 'application:' + slug(o.product), meta: { kind: 'application', product: o.product, title: 'Application · ' + TITLE[o.product], rateUnit: 'L/ha' } };
  const names = { cultivator: 'Field Cultivator', disc: 'Disc', subsoiler: 'Ripper', plow: 'Plow' };
  return { id: 'tillage:' + o.tool, meta: { kind: 'tillage', product: o.tool, title: 'Tillage · ' + names[o.tool] } };
}
function valuesAt(o, f, x, z, r) {
  const n = () => (r() - 0.5);
  if (o.kind === 'harvest') {
    const c = f.crop, b = bbox(f.polygon), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    let y = c.yld * f.quality * (1 + 0.14 * Math.sin(x / 83 + f.seed % 7) * Math.cos(z / 97) + 0.05 * n());
    y *= 1 - 0.55 * g2(x, z, cx + (b.x1 - b.x0) * 0.2, cz - (b.z1 - b.z0) * 0.15, 45);   // a wet spot
    const m = c.moist[0] + (c.moist[1] - c.moist[0]) * (0.5 + 0.35 * Math.sin(x / 140 - z / 170) + 0.1 * n());
    return { speed: +(6.5 + n()).toFixed(1), yield: +Math.max(0.3, y).toFixed(2), moisture: +m.toFixed(1), loss: +(0.4 + 0.5 * r()).toFixed(2) };
  }
  if (o.kind === 'seeding') {
    const sk = 0.8 + 1.2 * r(), db = 0.4 + 0.8 * r();
    return { speed: +(8 + n()).toFixed(1), rate: Math.round(o.crop.rate * (1 + 0.02 * n())), skips: +sk.toFixed(2), doubles: +db.toFixed(2), singulation: +(100 - sk - db).toFixed(2) };
  }
  if (o.kind === 'application') return { speed: +(18 + 2 * n()).toFixed(1), rate: +(100 * (1 + 0.04 * n())).toFixed(1) };
  return { speed: +(11 + n()).toFixed(1), tillDepth: +(o.tool === 'subsoiler' ? 35 : o.tool === 'plow' ? 25 : 12 + 4 * n()).toFixed(1) };
}

// Record each field's history into the coverage store (as if it had been driven)
function seedCoverage(store, save, farm, day) {
  const t0 = Date.now();
  store.save = save;
  let frames = 0;
  for (const f of farm.fields) {
    if (f.state === 'live') continue;
    for (const o of plan(f, day)) {
      const { id, meta } = opOf(o), op = store.getOp(id, meta), W = WIDTH[o.kind], r = rng(f.seed + o.day);
      const P = passes(f.polygon, f.heading, W);
      const list = o.part ? P.list.slice(0, Math.max(1, Math.round(P.list.length * o.part))) : P.list;
      list.forEach((ps, k) => {
        const pass = store.passSeq++, dir = k % 2 ? -1 : 1;
        const a = dir > 0 ? ps.t0 : ps.t1, b = dir > 0 ? ps.t1 : ps.t0, n = Math.max(1, Math.ceil(Math.abs(b - a) / STEP));
        const heading = Math.round((f.heading + (dir > 0 ? 0 : 180)) % 360);
        for (let i = 0; i < n; i++) {
          const ta = a + (b - a) * i / n, tb = a + (b - a) * (i + 1) / n;
          const l0 = P.pt(ps.o - W / 2, ta), r0 = P.pt(ps.o + W / 2, ta), r1 = P.pt(ps.o + W / 2, tb), l1 = P.pt(ps.o - W / 2, tb);
          const q = [l0, r0, r1, l1].flat().map(v => +v.toFixed(2));
          const mid = P.pt(ps.o, (ta + tb) / 2);
          op.addFrame({ p: pass, h: heading, d: o.day, q: [q], v: valuesAt(o, f, mid[0], mid[1], r) }, false);
          frames++;
        }
      });
    }
  }
  return { frames, ms: Date.now() - t0 };
}

// Tracks, a re-driven boundary and a prescription, once the fields are in the field store
function seedStore(fs, save, farm, day) {
  let tracks = 0;
  for (const f of farm.fields) {
    if (!['growing', 'seeded', 'harvested', 'harvesting'].includes(f.state)) continue;
    const b = bbox(f.polygon), h = f.heading;
    fs.addTrack(save, { name: `${f.name} ${h < 45 || h > 315 ? 'N-S' : 'E-W'}`, ax: (b.x0 + b.x1) / 2, az: (b.z0 + b.z1) / 2, h, how: 'A+B', fieldId: f.id });
    tracks++;
  }
  // two fields were re-driven: a second (driven) boundary version that is now active
  for (const f of farm.fields.filter(x => x.state === 'harvested').slice(0, 2)) {
    const c = f.polygon.reduce((a, p) => [a[0] + p[0] / f.polygon.length, a[1] + p[1] / f.polygon.length], [0, 0]);
    fs.addBoundary(save, { fieldId: f.id, source: 'driven', polygon: f.polygon.map(([x, z]) => [c[0] + (x - c[0]) * 0.985, c[1] + (z - c[1]) * 0.985]), note: 'Re-driven after the new fence line' });
  }
  // a seeding prescription from last harvest's yield on the first harvested corn (or any harvested) field
  const hv = farm.fields.find(x => x.state === 'harvested' && x.crop.id === 'MAIZE') || farm.fields.find(x => x.state === 'harvested');
  let rx = null;
  if (hv) {
    try { rx = fs.createRx(save, { fieldId: hv.id, opId: opOf({ kind: 'harvest', crop: hv.crop }).id, layer: 'yield', zones: 4, name: `${hv.name} VRS from ${hv.crop.name} yield` }); }
    catch (e) { /* not enough data */ }
  }
  void day;
  return { tracks, rx: rx ? rx.name : null };
}

module.exports = { build, gameFields, seedCoverage, seedStore, TARGET_HA };

if (require.main === module) {
  const fixed = { id: 23, polygon: [[-128, 334], [200, 345], [196, 454], [-132, 444]] };
  const farm = build({ fixed, exclude: [{ x0: -230, x1: -130, z0: 270, z1: 390 }], region: { x0: -1700, x1: 1900, z0: -1400 } });
  const counts = {};
  farm.fields.forEach(f => { counts[f.state] = (counts[f.state] || 0) + 1; });
  console.log(`${farm.fields.length} fields, ${(farm.ha * 2.47105).toFixed(0)} ac`, counts);
}

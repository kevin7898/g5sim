'use strict';
// Tests the bridge's coverage recorder (bridge/coverage.js) with synthetic telemetry frames.
//   node G5Link/tests/coverage_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CoverageStore, quadArea } = require('../bridge/coverage.js');

let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
function near(a, b, tol, label) { check(typeof a === 'number' && Math.abs(a - b) <= tol, `${label}: expected ~${b}, got ${a}`); }

// A planter 12.19 m wide with 4 sections, 7.5 m behind the tractor, driving along +X (heading 90).
function frame({ x, z, heading, active = [true, true, true, true], save = 'savegame1', seeder = null, speed = 10, combine = null, rh = null, fills }) {
  const h = heading * Math.PI / 180, f = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  const W = 12.19, n = 4, bx = x - f.x * 7.5, bz = z - f.z * 7.5;
  const geometry = [];
  for (let i = 0; i < n; i++) {
    const l0 = -W / 2 + W * i / n, l1 = -W / 2 + W * (i + 1) / n;
    // alternate the start/width node order like real implements can
    const A = { x: bx + r.x * l0, z: bz + r.z * l0 }, B = { x: bx + r.x * l1, z: bz + r.z * l1 };
    const [S, Wn] = i % 2 ? [B, A] : [A, B];
    geometry.push({ i, sx: S.x, sz: S.z, wx: Wn.x, wz: Wn.z, hx: S.x - f.x, hz: S.z - f.z });
  }
  return {
    state: 'vehicle', game: { save }, vehicle: { x, z, heading, speed }, combine, rh,
    implements: [{ name: 'Planter', width: W, areas: active, geometry, turnedOn: true, seeder,
      fills: fills || [{ title: 'Seeds', type: 'SEEDS', level: 1000, cap: 2800 }] }],
  };
}
function drive(store, { z, from, to, heading, step = 0.7, ...rest }) {
  const dir = Math.sign(to - from);
  for (let x = from; dir > 0 ? x <= to : x >= to; x += dir * step) store.onFrame(frame({ x, z, heading, ...rest }));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g5cov-'));
try {
  // --- two passes, the second 11 m over: 1.19 m of overlap; the bar sweeps 108 m (it trails 7.5 m)
  {
    const store = new CoverageStore({ dir: tmp, persist: true });
    drive(store, { z: 0, from: 0, to: 108, heading: 90 });
    store.onFrame({ state: 'onfoot' });                 // lift between passes
    drive(store, { z: 11, from: 108, to: 0, heading: 270 });
    store.flush(Date.now(), true);
    const list = store.list();
    check(list.ops.length === 1 && list.ops[0].kind === 'seeding', 'one seeding operation');
    const op = list.ops[0];
    near(op.areaHa, (12.19 + 11) * 108 / 10000, 0.006, 'covered area of two passes');
    near(op.overlapHa, 1.19 * 108 / 10000, 0.006, 'overlap area');
    const fr = store.frames(op.id, 0);
    check(fr.frames.length > 250, 'frames recorded');
    check(new Set(fr.frames.map(f => f.p)).size === 2, 'two passes');
    const quads = fr.frames.flatMap(f => f.q);
    near(quads.reduce((s, q) => s + quadArea(q), 0), 2 * 12.19 * 108, 30, 'swept quad area');
    check(fr.frames.every(f => f.q.length === 1), 'sections merged into one swath per frame');
    const ov = store.overlap(op.id);
    near(ov.runs.reduce((s, [x0, x1]) => s + (x1 - x0), 0) * ov.cell, op.overlapHa * 10000, 6, 'overlap runs add up to the overlap area');
    check(ov.runs.every(([x0, x1, zz]) => zz >= 4 && zz <= 6), 'overlap lies where the passes meet (z 4.9 to 6.1)');

    // persistence: a new store reads the same map back
    const again = new CoverageStore({ dir: tmp, persist: true });
    again.onFrame({ state: 'vehicle', game: { save: 'savegame1' }, vehicle: { x: 500, z: 500, heading: 0, speed: 0 }, implements: [] });
    const op2 = again.list().ops[0];
    check(op2 && op2.id === op.id, 'operation reloaded from disk');
    near(op2 && op2.overlapHa, op.overlapHa, 1e-9, 'overlap rebuilt from disk');
    check(op2 && op2.frames === op.frames, 'all frames reloaded');

    // other savegame starts empty
    again.onFrame({ state: 'vehicle', game: { save: 'savegame2' }, vehicle: { x: 0, z: 0, heading: 0, speed: 0 }, implements: [] });
    check(again.list().ops.length === 0, 'a different savegame has its own (empty) maps');

    // clear
    again.onFrame({ state: 'vehicle', game: { save: 'savegame1' }, vehicle: { x: 0, z: 0, heading: 0, speed: 0 }, implements: [] });
    check(again.clear(op.id) === true, 'clear returns true');
    check(again.list().ops.length === 0, 'cleared operation gone');
    check(!fs.existsSync(path.join(tmp, 'maps', 'savegame1', op.id.replace(/[^a-z0-9]+/g, '-') + '.ndjson')), 'cleared file deleted');
  }

  // --- a U-turn while working starts a new pass; same-pass painting never counts as overlap
  {
    const store = new CoverageStore({});
    drive(store, { z: 0, from: 0, to: 50, heading: 90 });
    for (let a = 0; a <= 180; a += 6) {                  // working through a tight turn
      const th = a * Math.PI / 180;
      store.onFrame(frame({ x: 50 + 6 * Math.sin(th), z: 6 - 6 * Math.cos(th), heading: 90 + a }));
    }
    const op = store.list().ops[0];
    const passes = new Set(store.frames(op.id).frames.map(f => f.p));
    check(passes.size === 2, `turn starts a second pass (got ${passes.size})`);
  }

  // --- sections off leave a hole and split the swath
  {
    const store = new CoverageStore({});
    drive(store, { z: 0, from: 0, to: 40, heading: 90, active: [true, false, true, true] });
    const op = store.list().ops[0];
    const fr = store.frames(op.id).frames;
    check(fr.every(f => f.q.length === 2), 'one section off splits the swath in two');
    near(op.areaHa, 12.19 * 0.75 * 40 / 10000, 0.006, 'area without the switched-off section');
  }

  // --- seeder values, harvest values, operations by implement
  {
    const store = new CoverageStore({});
    const seeder = { kind: 'planter', crop: 'MAIZE', unit: 'seedsPerAcre', rate: 34000, actual: 33600, skips: 1.5, doubles: 0.5, moisture: 0.25, compaction: 0.2, depthSet: 50, yieldPotential: 96 };
    drive(store, { z: 0, from: 0, to: 10, heading: 90, seeder });
    const op = store.list().ops[0];
    check(op.id === 'seeding:maize' && op.title === 'Seeding · Corn' && op.rateUnit === 'seeds/ac', 'seeding operation named from the seeder');
    const v = store.frames(op.id).frames[0].v;
    check(v.rate === 33600 && v.skips === 1.5 && v.doubles === 0.5 && v.singulation === 98, 'seeder rate, skips, doubles, singulation');
    check(v.soilMoisture === 25 && v.compaction === 20 && v.depth === 50, 'seeder soil moisture, compaction, depth');

    const h = new CoverageStore({});
    drive(h, { z: 0, from: 0, to: 10, heading: 90, fills: [], combine: { crop: 'WHEAT', cropTitle: 'Wheat' }, rh: { crop: 'WHEAT', yield: 6.5, moisture: 15.2, loss: 0.8 } });
    const hop = h.list().ops[0];
    check(hop.id === 'harvest:wheat' && hop.title === 'Harvest · Wheat', 'harvest operation');
    const hv = h.frames(hop.id).frames[0].v;
    check(hv.yield === 6.5 && hv.moisture === 15.2 && hv.loss === 0.8, 'harvest yield, moisture, loss');

    const t = new CoverageStore({});
    drive(t, { z: 0, from: 0, to: 10, heading: 90, fills: [] });
    check(t.list().ops[0].kind === 'tillage', 'no product -> tillage');
  }

  // --- as-applied rate from the tank without the seeder: 40 L over 0.1 ha = 400 L/ha
  {
    const store = new CoverageStore({});
    let level = 2000;
    for (let x = 0; x <= 90; x += 0.7) {
      level -= 40 * (0.7 * 12.19) / 1000;               // 40 L per 1000 m2
      store.onFrame(frame({ x, z: 0, heading: 90, fills: [{ title: 'Liquid Fertilizer', type: 'LIQUIDFERTILIZER', level, cap: 3000 }] }));
    }
    const op = store.list().ops[0];
    check(op.kind === 'application', 'application operation');
    const rates = store.frames(op.id).frames.map(f => f.v.rate).filter(r => r !== undefined);
    check(rates.length > 0, 'rate computed');
    near(rates[rates.length - 1], 400, 20, 'as-applied rate L/ha');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`coverage checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

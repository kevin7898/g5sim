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

    const vs = new CoverageStore({});
    const withVariety = o => ({ ...frame(o), workSetup: { variety: 'P1197AM', crop: 'MAIZE' } });
    for (let x = 0; x <= 10; x += 0.7) vs.onFrame(withVariety({ x, z: 0, heading: 90, seeder: { ...seeder } }));
    const vop = vs.list().ops[0];
    check(vop.id === 'seeding:maize:p1197am' && vop.title === 'Seeding · Corn · P1197AM', 'work setup variety splits seeding maps');

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

const eq = (a, b, label) => check(a === b, `${label}: expected ${b}, got ${a}`);

{
  const store = new CoverageStore();
  const op = { kind: 'seeding', product: 'CANOLA' };
  const measure = (level, vehicle = {}, game = {}) => {
    const impl = { fills: [{ type: 'SEEDS', level }] };
    return store.valuesOf({ vehicle, game }, impl, op, 'seed-tank', 400).rate;
  };
  eq(measure(1200, { ai: true }, { helperBuySeeds: true }), undefined, 'automatic seed purchase makes tank rate unknown');
  eq(measure(1190, { ai: true }), undefined, 'old AI telemetry without purchase settings cannot verify tank rate');
  eq(measure(1190), undefined, 'first manual tank sample sets a baseline');
  eq(measure(1190), undefined, 'unchanged tank while seeding is not a measured zero rate');
  eq(measure(1180, { ai: true }, { helperBuySeeds: false }), 250, 'helper with known disabled purchases uses measured tank depletion');
  eq(measure(1181), undefined, 'even a small refill clears the previous estimate');
  eq(measure(1177), 100, 'measured rate restarts from the refilled level');
  const empty = store.operationOf({}, { operation: 'application', sprayer: { product: 'UNKNOWN', level: 0 },
    fills: [{ type: 'DIESEL', level: 600 }] });
  eq(empty.product, '', 'an empty sprayer has no applied product from its engine tank');
}

// Native telemetry can miss one or two 200 ms processing windows between
// confirmed work samples. Retain each measured pose and each real stopped lane.
{
  const at = (seq, processing, { areas = [true, false, true, true], time = seq * 250, dir = 1, id = 'drill' } = {}) => {
    const t = frame({ x: seq * 0.555, z: 0, heading: 90, active: areas, speed: 8 });
    t.time = time;
    t.seq = seq;
    Object.assign(t.vehicle, { onField: true, motorOn: true, dir });
    Object.assign(t.implements[0], { id, canTurnOn: true, processing: areas.map(active => active && processing) });
    t.activeWork = { id: 'planting', op: 'seeding' };
    return t;
  };
  const store = new CoverageStore();
  const missed = at(2, false);
  store.onFrame(at(1, true));
  store.onFrame(missed);
  store.onFrame(missed);
  store.onFrame(at(3, false));
  eq(store.frames('seeding').seq, 0, 'missed samples require a subsequent work confirmation');
  store.onFrame(at(4, true));
  const strips = store.frames('seeding').frames;
  eq(strips.length, 3, 'two missed samples restore all three intervals');
  eq(new Set(strips.map(f => f.p)).size, 1, 'processing flicker keeps the same pass');
  check(strips.every(f => f.q.length === 2 && f.dist > 0 && f.dt === 250), 'lane gap and job time survive recovery');
  check(!missed.implements[0].processing.includes(true), 'coverage repair leaves observed telemetry intact');

  const fleet = new CoverageStore();
  for (let seq = 1; seq <= 3; seq++) fleet.onFrame(at(seq, seq !== 2, { time: seq * 500 }), 'm:worker');
  const fleetStrips = fleet.frames('seeding').frames;
  eq(fleetStrips.length, 2, 'one missed fleet sample at 2 Hz preserves the measured path');
  check(fleetStrips.every(f => f.m === 'worker'), 'recovered fleet strips retain the worker identity');

  for (const [label, middle, end] of [
    ['raised or disabled', [at(2, false, { areas: [false, false, false, false] })], at(3, true)],
    ['reversing', [at(2, false, { dir: -1 })], at(3, true)],
    ['different implement', [at(2, false, { id: 'other drill' })], at(3, true)],
    ['long sample interval', [at(2, false)], at(3, true, { time: 1100 })],
    ['more than two missed samples', [at(2, false), at(3, false), at(4, false, { time: 925 })], at(5, true, { time: 1000 })],
    ['tool still inactive', [at(2, false)], null],
  ]) {
    const separate = new CoverageStore();
    separate.onFrame(at(1, true));
    for (const f of middle) separate.onFrame(f);
    if (end) separate.onFrame(end);
    separate.interrupt();
    eq(separate.frames('seeding').seq, 0, label + ' preserves the coverage break');
  }
}

{
  const store = new CoverageStore();
  const impl = { areas: [true], geometry: [{ sx: -2, sz: 0, wx: 2, wz: 0 }] };
  const before = store.spansOf(impl, { x: 0, z: 0, heading: 85 });
  const after = store.spansOf({ ...impl, geometry: [{ sx: -2, sz: 0.5, wx: 2, wz: 0.5 }] }, { x: 0, z: 0.5, heading: 95 });
  const quads = store.sweepsBetween(before, after);
  eq(quads.length, 1, 'turning tractor keeps physical implement endpoints paired');
  near(quadArea(quads[0]), 2, 0.001, 'area of the articulated sweep');
  const pivot = store.spansOf({ ...impl, geometry: [{ sx: -2, sz: -0.5, wx: 2, wz: 0.5 }] }, { x: 0, z: 0, heading: 0 });
  const lobes = store.sweepsBetween(before, pivot);
  eq(lobes.length, 2, 'pivoting around a contact point retains both swept lobes');
  near(lobes.reduce((area, q) => area + quadArea(q), 0), 1, 0.001, 'area of both pivot lobes');
}

// Observe a true gap, two fore-aft planes and a second operation during the same pass.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5cov-planes-'));
  try {
    const store = new CoverageStore({ dir, persist: true });
    const frameAt = (x, seq, { time = seq * 250, active = true, session = 'load-a' } = {}) => {
      const t = frame({ x, z: 0, heading: 90, fills: [] });
      const plane = (i, fore, lo, hi) => ({ i, sx: x + fore, wx: x + fore, sz: lo, wz: hi });
      return { ...t, session, time, seq, vehicle: { ...t.vehicle, id: 'tractor' }, implements: [
        { id: 'cult', operation: 'tillage', tillage: { type: 'cultivator' }, areas: [true, true, true, true], processing: [active, false, active, active],
          geometry: [plane(0, 1, -4, -2), plane(1, 1, -2, 0), plane(2, 1, 0, 4), plane(3, -2, 0, 4)] },
        { id: 'spray', operation: 'application', sprayer: { product: 'WATER', applying: active }, areas: [true], geometry: [plane(0, 0, -4, 4)] },
      ] };
    };
    store.onFrame(frameAt(0, 1));
    check(store.list().ops.length === 0, 'first or stationary pose does not paint');
    store.onFrame(frameAt(1, 2));
    store.onFrame(frameAt(2, 3));
    store.onFrame(frameAt(3, 3), 'm:tractor');
    const t = store.frames('tillage:cultivator').frames;
    eq(t.length, 2, 'fleet cannot duplicate the driven machine');
    check(t.every(f => f.q.length === 3), 'two planes and inactive lane remain distinct');
    check(t.every(f => f.q.every(q => !(Math.min(q[1], q[3]) < 0 && Math.max(q[1], q[3]) > -2))), 'inactive lane stays clear');
    eq(new Set(t.map(f => f.p)).size, 1, 'tillage keeps its pass while another operation is active');
    eq(new Set(store.frames('application:water').frames.map(f => f.p)).size, 1, 'application keeps its own pass');
    store.onFrame(frameAt(3, 4, { active: false }));
    store.onFrame(frameAt(4, 5));
    store.onFrame(frameAt(5, 6, { time: 10000 }));
    store.onFrame(frameAt(6, 1, { session: 'load-b' }));
    store.onFrame(frameAt(7, 2, { session: 'load-b' }));
    const live = store.frames('tillage:cultivator').frames;
    eq(live.length, 3, 'stopped tool, long gap and restarted session do not paint connecting strips');
    store.flush(Date.now(), true);
    const reopened = new CoverageStore({ dir, persist: true });
    reopened.onFrame({ state: 'onfoot', session: 'load-b', game: { save: 'savegame1' } });
    eq(JSON.stringify(reopened.frames('tillage:cultivator').frames), JSON.stringify(live), 'replay reopens the exact accepted geometry and pass IDs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// The same group edges keep their identity during native changes of working width.
{
  const store = new CoverageStore({ persist: false });
  const edges = [-18, -13.5, -9, -4.5, -1.5, 1.5, 4.5, 9, 13.5, 18];
  const sample = (x, left) => ({ state: 'vehicle', game: { save: 'savegame1' }, time: x * 250,
    vehicle: { x, z: 0, heading: 90, speed: 14.4 }, implements: [{ id: 'boom', operation: 'application',
      sprayer: { product: 'WATER', applying: true, boom: { left, right: 4, leftMax: 4, rightMax: 4 } },
      input: { tank: 1, product: 'WATER', liters: 40 - x },
      areas: edges.slice(1).map((_, i) => i >= 4 - left),
      geometry: edges.slice(1).map((edge, i) => ({ i, sx: x, sz: edges[i], wx: x, wz: edge })),
    }] });
  for (const [x, left] of [[0, 4], [1, 4], [2, 2], [3, 2], [4, 4], [5, 4]]) store.onFrame(sample(x, left));
  const strips = store.frames('application:water').frames;
  check(strips.length === 5 && strips.every(f => f.q.length === 1), 'active neighboring groups merge into the same continuous width');
  check(strips.slice(1, 4).every(f => quadArea(f.q[0]) === 27 && Math.min(f.q[0][1], f.q[0][3], f.q[0][5], f.q[0][7]) === -9),
    'both disabled groups stay clear, including while switching widths');
  check(quadArea(strips[0].q[0]) === 36 && quadArea(strips[4].q[0]) === 36, 'full width resumes once both endpoints confirm those groups');
  check(!strips[1].inputUsed && strips[2].inputUsed?.liters === 1 && !strips[3].inputUsed,
    'metering never attributes a full tank change to the common width across changes');
}

// Tillage: operation named by tool type, depth recorded per frame
{
  const store = new CoverageStore({ persist: false });
  const t = frame({ x: 0, z: 0, heading: 90 });
  const impl = t.implements[0];
  impl.fills = []; impl.turnedOn = false; impl.seeder = null;
  impl.tillage = { type: 'plow', depth: 24.5 };
  const op = store.operationOf(t, impl);
  eq(op.kind, 'tillage', 'tillage kind');
  eq(op.title, 'Tillage · Plow', 'tillage title names the tool');
  eq(store.valuesOf(t, impl, op, 'k', 10).tillDepth, 24.5, 'tillage depth value');
  impl.tillage = { type: 'disc' };
  eq(store.operationOf(t, impl).product, 'disc', 'disc is its own tillage map');
  eq(store.valuesOf(t, impl, op, 'k', 10).tillDepth, undefined, 'no depth without Realistic Tillage');
}

// Two machines at once (the driven one and an AI worker): separate passes, frames tagged with the machine
{
  const store = new CoverageStore({ persist: false });
  let ai = 0;
  for (let x = 0; x <= 60; x += 2) {
    store.onFrame(frame({ x, z: 0, heading: 90 }));
    store.onFrame(frame({ x, z: 100, heading: 90 }), 'm:vehAI');
    ai++;
  }
  const op = store.ops().get(store.current);
  check(op && op.frames.length >= 50, 'both machines recorded');
  const passes = new Set(op.frames.map(f => f.p));
  eq(passes.size, 2, 'one pass per machine, not one pass zig-zagging between them');
  const tagged = op.frames.filter(f => f.m === 'vehAI').length;
  check(tagged > 20 && tagged < op.frames.length, 'AI frames tagged with the machine id: ' + tagged);
  store.onFrame(null, 'm:vehAI');
  eq(store.current !== null, true, 'the AI stopping does not clear the driven operation');
}

console.log(`coverage checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

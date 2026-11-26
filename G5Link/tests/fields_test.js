'use strict';
// Tests the Ops Center field store (bridge/fields.js) with the coverage recorder.
//   node G5Link/tests/fields_test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CoverageStore } = require('../bridge/coverage.js');
const { FieldStore, polygonArea, inPolygon } = require('../bridge/fields.js');

let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
function near(a, b, tol, label) { check(typeof a === 'number' && Math.abs(a - b) <= tol, `${label}: expected ~${b}, got ${a}`); }

const SAVE = 'savegame3';
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const GAME = { farmId: 1, fields: [
  { id: 1, name: 'Field 1', areaHa: 1.08, farmland: 11, owner: 1, polygon: rect(0, -6, 100, 102) },
  { id: 2, name: 'Field 2', areaHa: 1.0, farmland: 12, owner: 0, polygon: rect(200, 0, 300, 100) },
] };

// A planter 12.19 m wide, one work area, 7.5 m behind the tractor, passes along +X spaced 12 m.
function frame(x, z, day, rate) {
  const bx = x - 7.5;
  return {
    state: 'vehicle', game: { save: SAVE, day }, vehicle: { x, z, heading: 90, speed: 10 },
    implements: [{ name: 'Planter', width: 12.19, areas: [true], turnedOn: true,
      geometry: [{ i: 0, sx: bx, sz: z - 6.095, wx: bx, wz: z + 6.095, hx: bx - 1, hz: z - 6.095 }],
      seeder: { kind: 'planter', crop: 'SOYBEAN', unit: 'seedsPerAcre', rate, actual: rate, skips: 1, doubles: 0.5, lph: 80 },
      fills: [{ title: 'Seeds', type: 'SEEDS', level: 900, cap: 1000 }] }],
  };
}
function plant(cov, { toX, day, rate, z0 = 0, passes = 9, fromX = 7.5 }) {
  for (let k = 0; k < passes; k++) {
    const z = z0 + k * 12;
    for (let x = fromX; x <= toX; x += 0.7) cov.onFrame(frame(x, z, day, rate));
    cov.onFrame({ state: 'onfoot' });
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g5fields-'));
try {
  const cov = new CoverageStore({ dir: tmp, persist: true });
  const store = new FieldStore({ dir: tmp, persist: true, coverage: cov });
  store.lastWorkMs = 0;                             // no throttling in the test

  // --- game import
  store.importGame(SAVE, GAME);
  let list = store.list(SAVE);
  check(list.length === 2 && list[0].source === 'game', 'two game fields imported');
  near(list[0].areaHa, 1.08, 1e-9, 'game field area from polygon');
  store.importGame(SAVE, GAME);
  check(store.field(SAVE, 1).boundaries.length === 1, 'unchanged game polygon adds no version');

  // --- import switched off on another save: nothing appears until a boundary is driven
  store.setSettings('hardcore', { importGame: false });
  store.importGame('hardcore', GAME);
  check(store.list('hardcore').length === 0, 'no game fields when import is off');
  const hc = store.addBoundary('hardcore', { source: 'driven', polygon: rect(1, -5, 99, 101) });
  check(hc.field === '1', 'a driven boundary inside a game field takes that field id');
  check(store.list('hardcore')[0].name === 'Field 1', 'and its name');

  // --- driven boundary replaces the game one; an outside boundary is a new field
  const r1 = store.addBoundary(SAVE, { source: 'driven', polygon: rect(0, -6, 100, 102) });
  check(r1.field === '1' && r1.v === 2, 'driven boundary is version 2 of field 1');
  check(store.list(SAVE).find(f => f.id === '1').source === 'driven', 'driven boundary is active');
  const r2 = store.addBoundary(SAVE, { source: 'driven', polygon: rect(500, 500, 560, 560), name: 'Back 40' });
  check(r2.field === 'u1' && store.field(SAVE, 'u1').name === 'Back 40', 'boundary outside any field makes a new named field');
  const r2b = store.addBoundary(SAVE, { source: 'driven', polygon: rect(10, 10, 60, 60), newField: true });
  check(r2b.field === 'u2', 'an explicit new field is not merged into the game field it lies in');
  store.removeBoundary(SAVE, 'u2', 1);
  const lw0 = store.lastWork(SAVE);
  check(Object.keys(lw0).length === 0, 'no last work before any coverage');
  store.setActive(SAVE, '1', 1);
  check(store.list(SAVE).find(f => f.id === '1').source === 'game', 'operator can switch back to the game version');
  store.setActive(SAVE, '1', 2);

  // --- coverage: plant field 1, and 30 m of new ground past its east edge
  plant(cov, { toX: 137.5, day: 41, rate: 140000 });
  const recs = store.records(SAVE, '1');
  check(recs.length === 1 && recs[0].kind === 'seeding' && recs[0].title === 'Seeding · Soybeans', 'one seeding record for field 1');
  near(recs[0].coveredHa, 1.08, 0.02, 'covered area inside field 1');
  near(recs[0].avg.rate, 140000, 1, 'area-weighted rate');
  check(recs[0].firstDay === 41 && recs[0].lastDay === 41, 'record days');
  const all = store.records(SAVE);
  const outside = all.find(r => r.field === null);
  check(outside && outside.swathHa > 0.25, 'work outside every field is listed as Outside fields');

  const lw = store.lastWork(SAVE);
  check(lw['1'] && lw['1'].kind === 'seeding' && lw['1'].day === 41, 'last work type of field 1 is seeding on day 41');
  check(!lw['2'], 'field 2 has no work');

  // --- expand field 1 from coverage
  const prop = store.fromCoverage(SAVE, { fieldId: '1' });
  check(prop !== null, 'coverage proposal made');
  near(prop.areaHa, 1.08 + 0.324, 0.05, 'expanded area includes the new ground');
  near(prop.addedHa, 0.324, 0.05, 'added area');
  check(inPolygon(prop.polygon, 120, 50) && inPolygon(prop.polygon, 50, 50), 'new polygon covers old and new ground');
  check(!inPolygon(prop.polygon, 250, 50), 'and not field 2');
  check(prop.polygon.length <= 12, `outline simplified (${prop.polygon.length} points)`);
  const r3 = store.addBoundary(SAVE, { fieldId: '1', source: 'coverage', polygon: prop.polygon });
  check(r3.v === 3 && store.list(SAVE).find(f => f.id === '1').source === 'coverage', 'coverage boundary saved as version 3');
  near(store.records(SAVE, '1')[0].coveredHa, 1.08 + 0.324, 0.05, 'records follow the new boundary');

  // --- a brand-new field traced from a point on isolated coverage
  plant(cov, { fromX: 1007.5, toX: 1067.5, day: 42, rate: 140000, z0: 1000, passes: 4 });
  const newProp = store.fromCoverage(SAVE, { x: 1030, z: 1010 });
  check(newProp && newProp.field === null, 'proposal is for a new field');
  near(newProp && polygonArea(newProp.polygon) / 10000, 60 * 48.19 / 10000, 0.03, 'new field area');

  const dr = store.addBoundary(SAVE, { fieldId: '2', source: 'drawn', polygon: rect(205, 5, 295, 95) });
  check(dr.v === 2 && store.list(SAVE).find(f => f.id === '2').source === 'drawn', 'a drawn boundary becomes active');
  store.setSettings(SAVE, { client: '  Test Client  ' });
  check(store.db(SAVE).settings.client === 'Test Client', 'client name setting is trimmed and saved');

  // --- Harvest Profit: harvest field 1, then check the P&L against hand-computed values
  const harvestFrame = (x, z) => ({ state: 'vehicle', game: { save: SAVE, day: 90 }, vehicle: { x, z, heading: 90, speed: 6 },
    combine: { crop: 'SOYBEAN', cropTitle: 'Soybeans' }, rh: { crop: 'SOYBEAN', yield: 3.0, moisture: 13, loss: 0.5 },
    implements: [{ name: 'Header', width: 12.19, areas: [true], turnedOn: true, fills: [],
      geometry: [{ i: 0, sx: x + 4, sz: z - 6.095, wx: x + 4, wz: z + 6.095, hx: x + 3, hz: z - 6.095 }] }] });
  for (let k = 0; k < 9; k++) { for (let x = -4; x <= 96; x += 0.7) cov.onFrame(harvestFrame(x, k * 12)); cov.onFrame({ state: 'onfoot' }); }
  const econ = { balance: 5000, loan: 100, equity: 9000, fillTypes: { SOYBEAN: { price: 0.35, mass: 0.00072 }, SEEDS: { cost: 0.9 } } };
  let P = store.profit(SAVE, econ);
  const f1 = P.fields.find(x => x.field === '1');
  check(f1 && f1.crop === 'SOYBEAN', 'profit: field 1 crop from the harvest');
  const hRec = store.records(SAVE, '1').find(r => r.kind === 'harvest'), sRec = store.records(SAVE, '1').find(r => r.kind === 'seeding');
  const price = 0.35 / 0.00072;
  near(f1.pricePerT, price, 0.01, 'game price per tonne = price per litre / tonnes per litre');
  near(f1.tonnes, 3.0 * hRec.coveredHa, 0.01, 'harvested tonnes = yield x covered area');
  near(f1.revenue, 3.0 * hRec.coveredHa * price, 1, 'revenue');
  near(f1.expenses.seed, 80 * sRec.coveredHa * 0.9, 0.5, 'seed cost = L/ha x area x cost per litre');
  near(f1.expenses.machinery, sRec.coveredHa * 25 + hRec.coveredHa * 55, 0.5, 'machinery = area x default rate per work type');
  near(f1.net, f1.revenue - f1.expensesTotal, 0.01, 'net = revenue - expenses');
  check(P.finances.balance === 5000, 'profit: farm finances passed through');
  store.setProfitSettings(SAVE, { rent: 100, prices: { soybean: 600 }, machinery: { harvest: 0 } });
  P = store.profit(SAVE, econ);
  const f1b = P.fields.find(x => x.field === '1');
  check(f1b.priceSource === 'set' && f1b.pricePerT === 600, 'price override used');
  near(f1b.expenses.rent, f1b.areaHa * 100, 0.01, 'rent on the whole field area');
  near(f1b.expenses.machinery, sRec.coveredHa * 25, 0.5, 'changed machinery rate applied');
  store.setProfitSettings(SAVE, { prices: { SOYBEAN: null } });
  check(store.profit(SAVE, econ).fields.find(x => x.field === '1').priceSource === 'game', 'clearing the override returns to the game price');
  // Farm Finance leases: crop share on farmland 11 (field 1), then a cash lease
  const shareEcon = { ...econ, farmFinance: { creditScore: 700, creditGrade: 'B', contracts: { 11: { kind: 'in', leaseType: 'share', landownerShare: 0.3, inputShare: 0.25 } } } };
  const base = store.profit(SAVE, econ).fields.find(x => x.field === '1');
  const sh = store.profit(SAVE, shareEcon).fields.find(x => x.field === '1');
  near(sh.revenue, base.revenue * 0.7, 0.05, 'crop share: farm keeps 70 % of revenue');
  near(sh.expenses.seed, base.expenses.seed * 0.75, 0.05, 'crop share: landowner pays 25 % of inputs');
  check(sh.expenses.rent === 0 && sh.lease.type === 'share', 'crop share: no cash rent');
  check(store.profit(SAVE, shareEcon).finances.farmFinance.creditGrade === 'B', 'Farm Finance credit passed through');
  const cashEcon = { ...econ, farmFinance: { contracts: { 11: { kind: 'in', leaseType: 'cash', annualRent: 450 } } } };
  near(store.profit(SAVE, cashEcon).fields.find(x => x.field === '1').expenses.rent, 450, 0.01, 'cash lease rent replaces the rent setting');
  const outEcon = { ...econ, farmFinance: { contracts: { 11: { kind: 'out', leaseType: 'cash', annualRent: 450 } } } };
  near(store.profit(SAVE, outEcon).fields.find(x => x.field === '1').expenses.rent, base.expenses.rent, 0.01, 'land leased out is not charged as rent');
  const noEcon = store.profit(SAVE, null).fields.find(x => x.field === '1');
  check(noEcon.revenue === 0 && noEcon.missing.some(m => /price/.test(m)), 'without prices the P&L says what is missing');

  // --- guidance tracks and Work Setup (Data Sync)
  const t1 = store.addTrack(SAVE, { ax: 10, az: 20, h: 450, how: 'A+B', fieldId: 1 });
  check(t1.id === 'T1' && t1.h === 90 && t1.fieldId === '1' && t1.name === 'Track 1 (A+B)', 'track added with a normalized heading and field');
  const t2 = store.addTrack(SAVE, { ax: 0, az: 0, h: 0, fieldId: 1 });
  check(t2.name === 'Track 2 (A+Heading)', 'second track in the field numbered 2');
  store.addTrack(SAVE, { ax: 0, az: 0, h: 180 });
  check(store.tracks(SAVE, '1').length === 2 && store.tracks(SAVE, null).length === 1, 'tracks filtered by field');
  store.updateTrack(SAVE, 'T2', { name: 'Headland' });
  check(store.tracks(SAVE).find(t => t.id === 'T2').name === 'Headland', 'track renamed');
  store.deleteTrack(SAVE, 'T1');
  check(!store.tracks(SAVE).some(t => t.id === 'T1'), 'track deleted');
  let threw = false; try { store.addTrack(SAVE, { ax: 'x', az: 0, h: 0 }); } catch (e) { threw = true; }
  check(threw, 'a track without coordinates is refused');
  const ws = store.setWorkSetup(SAVE, { client: ' Kev ', farm: 'North', crop: 'maize', variety: 'P1197', fieldMode: 'fixed', fieldId: 1 });
  check(ws.client === 'Kev' && ws.crop === 'MAIZE' && ws.fieldMode === 'fixed' && ws.fieldId === '1', 'work setup saved and normalized');
  check(store.db(SAVE).settings.client === 'Kev', 'work setup client becomes the Ops client name');
  store.setWorkSetup(SAVE, { variety: '' });
  check(store.workSetup(SAVE).variety === null && store.workSetup(SAVE).farm === 'North', 'clearing one field keeps the others');

  // --- persistence
  cov.flush(Date.now(), true);
  const cov2 = new CoverageStore({ dir: tmp, persist: true });
  const store2 = new FieldStore({ dir: tmp, persist: true, coverage: cov2 });
  check(store2.list(SAVE).length === 3, 'fields reloaded');
  check(store2.db(SAVE).settings.client === 'Kev', 'settings reloaded');
  check(store2.tracks(SAVE).length === 2 && store2.workSetup(SAVE).farm === 'North', 'tracks and work setup reloaded');
  check(store2.field(SAVE, '1').boundaries.length === 3, 'boundary versions reloaded');
  near(store2.records(SAVE, '1').find(r => r.kind === 'seeding').coveredHa, 1.08 + 0.324, 0.05, 'records rebuilt after reload');
  store2.removeBoundary(SAVE, 'u1', 1);
  check(!store2.field(SAVE, 'u1'), 'removing the last boundary removes the custom field');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`field checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

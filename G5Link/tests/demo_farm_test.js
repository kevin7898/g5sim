'use strict';
// Demo farm: 50 fields, 2500 ac, no overlapping fields, histories recorded as work records, tracks and a prescription.
const farmLib = require('../bridge/demo-farm.js');
const { FieldStore, polygonArea } = require('../bridge/fields.js');
const { CoverageStore } = require('../bridge/coverage.js');

let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
const eq = (a, b, label) => check(a === b, `${label}: expected ${b}, got ${a}`);

const fixed = { id: 23, polygon: [[-128, 334], [200, 345], [196, 454], [-132, 444]] };
const farm = farmLib.build({ fixed, exclude: [{ x0: -230, x1: -130, z0: 270, z1: 390 }], region: { x0: -1700, x1: 1900, z0: -1400 } });
eq(farm.fields.length, 50, 'fields');
check(Math.abs(farm.ha * 2.47105 - 2500) < 5, `about 2500 ac: ${(farm.ha * 2.47105).toFixed(1)}`);
eq(new Set(farm.fields.map(f => f.id)).size, 50, 'unique field ids');
check(farm.fields.find(f => f.id === 23).polygon === fixed.polygon, 'Field 23 is the demo machine\'s field');
// no two fields overlap (bounding boxes, as packed)
const bb = p => p.reduce((b, [x, z]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), z0: Math.min(b.z0, z), z1: Math.max(b.z1, z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
let overlaps = 0;
for (let i = 0; i < farm.fields.length; i++) for (let j = i + 1; j < farm.fields.length; j++) {
  const a = bb(farm.fields[i].polygon), b = bb(farm.fields[j].polygon);
  if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) overlaps++;
}
eq(overlaps, 0, 'overlapping fields');
const states = {};
farm.fields.forEach(f => { states[f.state] = (states[f.state] || 0) + 1; });
check(states.harvested > 5 && states.growing > 5 && states.idle > 0 && states.notOwned > 0, 'a mix of states: ' + JSON.stringify(states));
check(farm.fields.every(f => polygonArea(f.polygon) > 10000), 'every field at least 1 ha');

// recorded into the stores: records per field, last work, tracks, a prescription
const maps = new CoverageStore({ persist: false });
const store = new FieldStore({ persist: false, coverage: maps });
const save = 'unsaved';
const t = farmLib.seedCoverage(maps, save, farm, 60);
check(t.frames > 50000, `recorded frames: ${t.frames}`);
store.importGame(save, farmLib.gameFields(farm));
eq(store.list(save).length, 50, 'fields in the field store');
const s = farmLib.seedStore(store, save, farm, 60);
check(s.tracks > 20, `tracks: ${s.tracks}`);
check(!!s.rx, 'a prescription from yield');
const hv = farm.fields.find(f => f.state === 'harvested');
const recs = store.records(save, String(hv.id));
const kinds = recs.map(r => r.kind).sort().join(',');
eq(kinds, 'application,harvest,seeding', `harvested field ${hv.name} history`);
const h = recs.find(r => r.kind === 'harvest');
check(h.coveredHa / h.fieldHa > 0.85, `harvest covers the field: ${h.coveredHa} of ${h.fieldHa} ha`);
check(h.avg.yield > 0.5 && h.avg.moisture > 5, 'harvest yield and moisture recorded');
const idle = farm.fields.find(f => f.state === 'idle');
eq(store.records(save, String(idle.id)).length, 0, 'idle field has no records');
const lw = store.lastWork(save);
const part = farm.fields.find(f => f.state === 'harvesting');
eq(lw[String(part.id)] && lw[String(part.id)].kind, 'harvest', 'harvest in progress shows as last work');
const notOwned = store.list(save).find(f => String(f.id) === String(farm.fields.find(x => x.state === 'notOwned').id));
eq(notOwned.owner, 0, 'not owned field');

console.log(`demo farm checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

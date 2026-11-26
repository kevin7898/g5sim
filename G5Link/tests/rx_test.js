'use strict';
// Prescriptions: zones from a recorded layer, rates, activation, and the rows rx.xml carries.
const { FieldStore } = require('../bridge/fields.js');
const { CoverageStore } = require('../bridge/coverage.js');

let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
const eq = (a, b, label) => check(a === b, `${label}: expected ${b}, got ${a}`);

const maps = new CoverageStore({ persist: false });
const store = new FieldStore({ persist: false, coverage: maps });
const save = 'savegame1';
store.addBoundary(save, { fieldId: '23', name: 'Field 23', source: 'drawn', polygon: [[0, 0], [100, 0], [100, 60], [0, 60]] });
// a recorded operation: soil N low in the west, high in the east
maps.save = save;
const op = maps.getOp('application:liquidfertilizer', { kind: 'application', product: 'LIQUIDFERTILIZER', title: 'Application' });
let p = 0;
for (let z = 1; z < 60; z += 2) {
  for (let x = 1; x < 100; x += 2) {
    op.addFrame({ p: p++, h: 90, q: [[x - 1, z - 1, x + 1, z - 1, x + 1, z + 1, x - 1, z + 1]], v: { soilN: 20 + x * 0.6 } }, false);
  }
}
const rx = store.createRx(save, { fieldId: '23', opId: op.id, layer: 'soilN', zones: 3, cell: 10, name: 'N zones' });
eq(rx.zones, 3, 'three zones');
eq(rx.cols, 10, 'grid columns over the field');
eq(rx.rows, 6, 'grid rows');
eq(rx.rates.length, 3, 'one rate per zone');
check(rx.rates[0] > rx.rates[2], 'soil nutrients: more where the soil is low');
const west = rx.grid[0], east = rx.grid[9];
eq(west, 0, 'west (low N) is zone 0');
eq(east, 2, 'east (high N) is zone 2');
let refused = false;
try { store.createRx(save, { fieldId: '23', opId: op.id, layer: 'yield', zones: 3 }); } catch (e) { refused = /not enough recorded data/.test(e.message); }
check(refused, 'a layer with no data is refused');
eq(store.prescriptions(save, '23').length, 1, 'nothing saved for the refused one');
store.updateRx(save, rx.id, { rates: [1.3, 1, 0.6], name: 'Spring N' });
eq(store.prescriptions(save)[0].name, 'Spring N', 'renamed');
eq(store.setActiveRx(save, rx.id), rx.id, 'activated');
const rows = store.rxRows(store.activeRx(save));
eq(rows.length, 6, 'rows for rx.xml');
eq(rows[0][0], 1.3, 'west cell rate');
eq(rows[0][9], 0.6, 'east cell rate');
store.deleteRx(save, rx.id);
eq(store.activeRx(save), null, 'deleting the active one clears it');

console.log(`rx checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

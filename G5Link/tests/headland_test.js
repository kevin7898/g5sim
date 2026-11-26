'use strict';
// Headland link: headland.xml from the active boundary and settings, headcov.xml from coverage near the machine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HeadlandLink, widthFor } = require('../bridge/headland.js');
const { FieldStore } = require('../bridge/fields.js');
const { CoverageStore } = require('../bridge/coverage.js');

let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
const eq = (a, b, label) => check(a === b, `${label}: expected ${b}, got ${a}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5hl-'));
const maps = new CoverageStore({ persist: false });
const store = new FieldStore({ persist: false, coverage: maps });
const save = 'savegame1';
store.addBoundary(save, { fieldId: '23', name: 'Field 23', source: 'drawn', polygon: [[0, 100], [200, 100], [200, 300], [0, 300]] });
const link = new HeadlandLink({ dir });
const frame = (x, z) => ({ state: 'vehicle', game: { save }, vehicle: { x, z, heading: 90, speed: 10 },
  implements: [{ name: 'P', width: 12, areas: [true], geometry: [{ i: 0, sx: x - 7, sz: z - 6, wx: x - 7, wz: z + 6, hx: x - 8, hz: z - 6 }] }] });

// not armed: settings still written, no coverage file
let st = link.update(frame(100, 200), store, save, maps);
eq(st.field, '23', 'field under the machine');
eq(st.width, 20, 'default width 20 m');
const xml1 = fs.readFileSync(path.join(dir, 'headland.xml'), 'utf8');
check(/armed="false"/.test(xml1) && (xml1.match(/<pt /g) || []).length === 4, 'headland.xml has settings and the boundary');
check(!fs.existsSync(path.join(dir, 'headcov.xml')), 'no coverage file while disarmed');

// arm, passes mode: 2 x 12 m
store.setHeadland(save, { armed: true, widthMode: 'passes', passes: 2, lowerMode: 'both', headSpeed: 8 });
st = link.update(frame(100, 200), store, save, maps);
eq(st.width, 24, 'passes x implement width');
const xml2 = fs.readFileSync(path.join(dir, 'headland.xml'), 'utf8');
check(/v="2"/.test(xml2) && /armed="true"/.test(xml2) && /lowerMode="both"/.test(xml2) && /headSpeed="8"/.test(xml2), 'rewritten with a new version');
link.update(frame(101, 200), store, save, maps);
check(/v="2"/.test(fs.readFileSync(path.join(dir, 'headland.xml'), 'utf8')), 'not rewritten when nothing changed');
eq(widthFor({ perField: { 23: 30 }, widthMode: 'distance', width: 20 }, '23', 12), 30, 'per-field width wins');
store.setHeadland(save, { field: '23', fieldWidth: 15 });
eq(link.update(frame(100, 200), store, save, maps).width, 15, 'per-field override from settings');
store.setHeadland(save, { field: '23', fieldWidth: null });
eq(link.update(frame(100, 200), store, save, maps).width, 24, 'per-field override removed');

// coverage: drive a pass, then the covered cells near the machine go to headcov.xml
for (let x = 20; x <= 80; x += 2) maps.onFrame(frame(x, 200));
check(maps.current, 'coverage operation recorded');
link.covAt = 0;
st = link.update(frame(80, 200), store, save, maps);
const cov = fs.readFileSync(path.join(dir, 'headcov.xml'), 'utf8');
const rows = cov.match(/<r z="(-?\d+)" x="([^"]+)"/g) || [];
check(rows.length >= 10, 'covered rows written: ' + rows.length);
const mid = cov.match(/<r z="200" x="(-?\d+),(-?\d+)"/);
check(mid && +mid[1] <= 14 && +mid[2] >= 70, 'row at z 200 spans the pass: ' + (mid && mid.slice(1).join('-')));
check(st.coverage > 0, 'status counts coverage runs');
const far = new HeadlandLink({ dir: null, write: false });
far.update(frame(800, 800), store, save, maps);
eq(far.lastCoverage && far.lastCoverage.rows.size, 0, 'nothing sent far from the worked ground');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`headland checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

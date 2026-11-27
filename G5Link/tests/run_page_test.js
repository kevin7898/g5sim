'use strict';

const assert = require('node:assert/strict');
const model = require('../app/run-page-model');

const empty = model.normalize();
assert.equal(empty.version, 1);
assert.deepEqual(model.order(empty, 'combine', ['Guidance', 'Harvesting', 'Work Monitor', 'Harvest Automation']),
  ['Harvesting', 'Work Monitor', 'Harvest Automation', 'Guidance']);
assert.deepEqual(model.order(empty, 'sprayer', ['Guidance']), ['Guidance']);

const page = { id: 'custom:test', name: 'Field Review', modules: model.template('Guidance') };
const location = page.modules.find(item => item.module === 'location');
assert.equal(model.fits(page, { ...location, x: location.x - 1 }), false);
assert.equal(model.fits(page, { ...location, x: 10 }), false);
assert.equal(model.firstFit(page, 'map', 'medium', 'second-map'), null);
const map = page.modules[0];
Object.assign(map, { variant: 'medium', w: 8, h: 4 });
assert.equal(model.fits(page, { ...location, x: 8, w: 4 }), true);
const counters = model.firstFit(page, 'workState', 'wide', 'activity');
assert.deepEqual([counters.x, counters.y, counters.w, counters.h], [0, 4, 4, 2]);
page.modules.push(counters, { id: 'future', module: 'sensor-v2', variant: 'compact', x: 4, y: 4, w: 3, h: 2 });

const custom = model.normalize({ pages: [page], sets: [{ id: 'set:test', name: 'Tillage', pages: [page.id, 'Future Page', page.id], bar: 'bcustom' }],
  byType: { tillage: 'set:test', tractor: 'set:missing' }, lastPage: { tillage: page.id } });
assert.deepEqual(custom.pages[0].modules.at(-1), page.modules.at(-1));
assert.deepEqual(model.order(custom, 'tillage', ['Guidance', 'Tractor']), [page.id, 'Guidance']);
assert.deepEqual(model.activeSet(custom, 'tillage').pages, [page.id, 'Future Page']);
assert.equal(model.activeSet(custom, 'tillage').bar, 'bcustom');
assert.equal(model.activeSet(custom, 'tractor'), model.factory.tractor);
assert.equal(custom.lastPage.tillage, page.id);
assert.deepEqual(model.normalize(JSON.parse(JSON.stringify(custom))), custom);

console.log('run page layout checks passed');

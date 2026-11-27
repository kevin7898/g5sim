'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FieldStore } = require('../bridge/fields');
const { CoverageStore } = require('../bridge/coverage');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5jobs-'));
const save = 'savegame1';
try {
  const coverage = new CoverageStore({ dir, persist: true });
  const fields = new FieldStore({ dir, persist: true, coverage });
  const { field } = fields.addBoundary(save, { newField: true, name: 'Narrow Field', source: 'drawn', polygon: [[0, -1], [3, -1], [3, 1], [0, 1]] });
  const context = { op: 'application:water', kind: 'application', product: 'WATER', title: 'Application · Water', fieldId: field };
  const job = fields.startJob(save, context);
  assert.throws(() => fields.startJob(save, context), /Finish the active work/);
  assert.throws(() => fields.finishJob(save, 'outdated'), /active work has changed/);

  const sample = (x, on = true, epoch = 1, level = 100) => ({ state: 'vehicle', game: { save }, session: 'load-a', seq: x + 1,
    time: x * 250, vehicle: { id: 'sprayer', x, z: 0, heading: 90, speed: 14.4 }, activeWork: job, work: { counterEpoch: epoch }, implements: [{
      id: 'boom', operation: 'application', sprayer: { product: 'WATER', applying: on, level }, areas: [true],
      geometry: [{ i: 0, sx: x, sz: -2, wx: x, wz: 2 }], fills: [{ type: 'WATER', level }],
    }] });
  for (let x = 0; x <= 4; x++) coverage.onFrame(sample(x));
  coverage.onFrame(sample(5, false, 2, 0));
  const pass = coverage.passReport();
  assert.deepEqual(pass, { areaM2: 0, distanceM: 0, timeS: 0 });
  const activeTotals = fields.jobTotals(save, job);
  assert.deepEqual(activeTotals, { sweptM2: 16, distanceM: 4, timeS: 1, workedHa: 0.0006, overlapHa: 0, fieldHa: 0.0006,
    outsideHa: 0.001, remainingHa: 0, appliedHa: 0.0006, appliedPercent: 100, productUsed: null });
  coverage.onFrame(sample(6, false, 2, 100));
  assert.equal(fields.jobTotals(save, job), activeTotals, 'an empty stop or refill does not affect coverage or product totals');

  const complete = fields.finishJob(save, job.id);
  assert.equal(fields.activeJob(save), null);
  assert.equal(complete.totals, activeTotals);
  fields.addBoundary(save, { fieldId: field, source: 'drawn', polygon: [[-10, -2], [20, -2], [20, 2], [-10, 2]] });
  const readCoverage = new CoverageStore({ dir, persist: true });
  readCoverage.onFrame({ state: 'onfoot', game: { save }, session: 'load-b' });
  const reopened = new FieldStore({ dir, persist: true, coverage: readCoverage });
  const reopenedJob = reopened.jobs(save)[0];
  assert.equal(reopenedJob.boundaryVersion, 1);
  assert.deepEqual(reopenedJob.totals, complete.totals);
  assert.deepEqual(readCoverage.frames(job.op).frames, coverage.frames(job.op).frames);
  assert.equal(readCoverage.frames(job.op).frames.every(frame => frame.job === job.id && frame.application === true), true);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('work jobs and retained totals checks passed');

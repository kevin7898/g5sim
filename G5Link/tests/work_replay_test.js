'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CoverageStore } = require('../bridge/coverage');
const captures = require('./fixtures/work-samples.json');

function contains(quad, x, z) {
  let hit = false;
  for (let i = 0, j = quad.length - 2; i < quad.length; j = i, i += 2) {
    const [ax, az, bx, bz] = [quad[i], quad[i + 1], quad[j], quad[j + 1]];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
}

for (const { name, kind, source, expected, samples, expectedRates, expectedLiters, groundProbes } of captures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-work-replay-'));
  try {
    const coverage = new CoverageStore({ dir, persist: true });
    const job = { id: name, op: expected };
    coverage.onFrame({ ...samples[0], activeWork: job });
    assert.equal(coverage.frames(expected).frames.length, 0, name + ' starts with a pose');
    for (const t of samples.slice(1)) coverage.onFrame({ ...t, activeWork: job });
    coverage.interrupt();
    assert.equal(coverage.list().current, null, name + ' stops when the feed goes stale');

    const frames = coverage.frames(expected).frames;
    assert.ok(frames.length > 1, name + ' produced swaths');
    assert.ok(frames.every(frame => frame.job === job.id));
    const before = coverage.list().ops.find(op => op.id === expected);
    const reopened = new CoverageStore({ dir, persist: true });
    reopened.onFrame({ state: 'onfoot', game: { save: 'replay' }, session: 'reloaded' });
    assert.deepEqual(reopened.frames(expected).frames, frames, name + ' reloads the same geometry and values');
    assert.deepEqual(reopened.list().ops.find(op => op.id === expected), before, name + ' reloads the same coverage grid');

    if (kind === 'application') {
      assert.ok(frames.every(frame => frame.application === true && frame.inputUsed?.product === 'LIQUIDFERTILIZER'));
      const liters = reopened.jobCoverage('replay', job).inputLiters;
      assert.ok(liters > 0);
      if (expectedRates) {
        assert.deepEqual(frames.flatMap(frame => frame.v.rate ?? []), expectedRates,
          'accelerating and empty frames do not publish an areal rate');
      }
      if (expectedLiters != null) assert.equal(+liters.toFixed(3), expectedLiters, 'the mapped quantity matches the native capture');
      if (groundProbes) {
        const quads = frames.flatMap(frame => frame.q);
        for (const { x, z, treated } of groundProbes) {
          assert.equal(quads.some(quad => contains(quad, x, z)), treated, `replayed swath agrees with FS25 ground at ${x},${z}`);
        }
      }
    } else if (kind === 'harvest') {
      assert.ok(frames.every(frame => frame.v.yield === undefined && frame.v.moisture === undefined),
        'stock harvest capture leaves optional yield and moisture unavailable');
    }
    console.log(`${name} · ${source} · ${frames.length} retained swaths`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

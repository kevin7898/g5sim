'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BoundaryRecorder } = require('../bridge/boundary-recorder.js');
const { FieldStore } = require('../bridge/fields.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-boundary-'));
const SAVE = 'savegame1';
const fieldId = '7';
const square = [[0, 0], [40, 0], [40, 40], [0, 40]];
const frame = (x, z, heading = 0, width = 12) => ({
  link: 'live', state: 'vehicle', vehicle: { id: 'tractor', name: 'Tractor', x, z, heading },
  implements: [{ id: 'roller', name: 'Roller', width: 4 }, { id: 'cultivator', name: 'Cultivator', width }],
});

try {
  const store = new FieldStore({ dir, persist: true });
  const recorder = new BoundaryRecorder();
  let pose = frame(0, 0);
  const act = (action, extra = {}, save = SAVE) => recorder.command({
    action, draftId: recorder.status(save, pose).draftId, ...extra,
  }, save, pose, store);
  const drive = (x, z, heading, width) => {
    pose = frame(x, z, heading, width);
    recorder.onFrame(SAVE, pose);
  };
  const driveTo = (x, z) => {
    const { x: startX, z: startZ } = pose.vehicle;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - startX, z - startZ) / 20));
    for (let i = 1; i <= steps; i++) drive(startX + (x - startX) * i / steps, startZ + (z - startZ) * i / steps);
  };

  assert.throws(() => recorder.command({ action: 'start' }, SAVE, { link: 'stale' }, store), /live display/);
  assert.throws(() => act('start', { side: 'center', reference: 'implement' }), /left or right edge/);
  const edge = act('start', { side: 'left', reference: 'implement', offset: 1 });
  assert.equal(edge.offset, 6);
  assert.equal(edge.tool.name, 'Cultivator');
  assert.deepEqual(edge.path, [[-6, 0]]);
  assert.throws(() => act('start'), /already open/);
  assert.throws(() => act('pause', { draftId: 'old draft' }), /no longer current/);
  drive(10, 10, 90, 20);
  assert.deepEqual(recorder.snapshot(SAVE, pose).path, [[-6, 0], [10, 4]]);
  const paused = act('pause');
  drive(15, 15);
  drive(30, 20);
  assert.equal(recorder.status(SAVE, pose).points, 2);
  assert.deepEqual(recorder.status(SAVE, pose).cursor, [24, 20]);
  const resumed = act('resume');
  assert.deepEqual(resumed.path, [[-6, 0], [10, 4], [24, 20]]);
  assert.equal(act('undo').paused, true);
  assert.ok(Math.abs(recorder.status(SAVE, pose).length - paused.length) < 1e-9);
  assert.equal(act('redo').points, 3);
  assert.ok(Math.abs(recorder.status(SAVE, pose).length - resumed.length) < 1e-9);
  act('undo');
  act('resume');
  assert.equal(recorder.status(SAVE, pose).canRedo, false);
  recorder.onFrame('savegame2', frame(800, 800));
  assert.equal(recorder.status('savegame2', pose).paused, true);
  assert.equal(recorder.status('savegame2', pose).points, 3);
  assert.equal(recorder.status('savegame2', pose).pauseReason, 'save');
  assert.deepEqual(recorder.snapshot('savegame2', pose).path, []);
  assert.throws(() => act('review', {}, 'savegame2'), /Return to the savegame/);
  act('cancel', {}, 'savegame2');
  assert.equal(store.list(SAVE).length, 0);

  pose = frame(10, 10, 90);
  assert.deepEqual(act('start', { side: 'right', offset: 3 }).path, [[10, 13]]);
  act('cancel');
  assert.equal(act('start', { side: 'right', reference: 'implement', tool: 'id:roller' }).offset, 2);
  assert.deepEqual(recorder.snapshot(SAVE, pose).path, [[10, 12]]);
  act('cancel');
  assert.throws(() => act('start', { side: 'left', reference: 'implement', tool: 'id:removed' }), /Attach a working implement/);
  pose.vehicle.heading = undefined;
  assert.throws(() => act('start', { side: 'right', offset: 3 }), /valid vehicle heading/);

  pose = frame(0, 0);
  act('start');
  drive(4, 0);
  drive(80, 0);
  assert.equal(recorder.status(SAVE, pose).pauseReason, 'jump');
  assert.deepEqual(recorder.snapshot(SAVE, pose).path, [[0, 0], [4, 0]]);
  assert.throws(() => act('resume'), /Confirm the long connector/);
  assert.throws(() => act('resume', { resumeTo: [75, 0] }), /current position/);
  assert.equal(act('resume', { resumeTo: [80, 0] }).points, 3);
  recorder.onFrame(SAVE, { ...pose, link: 'stale' });
  assert.equal(recorder.status(SAVE, pose).pauseReason, 'link');
  assert.equal(act('resume').mode, 'recording');
  const otherVehicle = { ...pose, vehicle: { ...pose.vehicle, id: 'other-tractor' } };
  recorder.onFrame(SAVE, otherVehicle);
  assert.equal(recorder.status(SAVE, otherVehicle).pauseReason, 'vehicle');
  assert.equal(recorder.status(SAVE, otherVehicle).cursor, null);
  act('cancel');

  store.addBoundary(SAVE, { fieldId, source: 'drawn', polygon: square });
  pose = frame(0, 0);
  act('start', { fieldId });
  driveTo(40, 0);
  driveTo(40, 40);
  const open = act('review');
  assert.match(open.preview.issues.join(' '), /closer to the start/);
  assert.throws(() => act('finish', { reviewId: open.preview.id }), /closer to the start/);
  drive(0, 40);
  assert.equal(recorder.status(SAVE, pose).points, 5, 'preview is frozen as vehicle moves');
  act('edit');
  act('resume', { resumeTo: [0, 40] });
  driveTo(0, 2);
  assert.throws(() => act('finish', { reviewId: open.preview.id }), /Review the current boundary/);
  const closed = act('review');
  assert.deepEqual(closed.preview.issues, []);
  assert.equal(closed.preview.gap, 2);
  assert.equal(closed.preview.area, 1600);
  assert.equal(closed.preview.perimeter, 160);
  assert.throws(() => act('finish', { reviewId: open.preview.id }), /Review the current boundary/);
  assert.equal(store.field(SAVE, fieldId).active, 1);
  assert.deepEqual(act('finish', { reviewId: closed.preview.id }).saved, { field: fieldId, v: 2 });
  const retry = { action: 'finish', draftId: closed.draftId, reviewId: closed.preview.id };
  assert.deepEqual(act('finish', retry).saved, { field: fieldId, v: 2 });
  assert.throws(() => act('finish', { ...retry, reviewId: 'old review' }), /no longer current/);
  const reloadedStore = new FieldStore({ dir, persist: true });
  const reloaded = reloadedStore.field(SAVE, fieldId);
  assert.equal(reloaded.active, 2);
  assert.equal(reloaded.boundaries.length, 2);
  assert.deepEqual(reloaded.boundaries[1].polygon, closed.preview.outline);
  assert.deepEqual(new BoundaryRecorder().command(retry, SAVE, pose, reloadedStore).saved, { field: fieldId, v: 2 });

  const badOutlines = [
    { points: [[40, 40], [0, 40], [40, 0], [0, 0]], message: /crosses/ },
    { points: [[40, 0], [25, 0], [40, 40], [0, 40], [0, 0]], message: /doubles back/ },
    { points: [[20, 0], [20, 1.1], [0, 1.1], [0, 0]], message: /at least 25 m²/ },
  ];
  for (const { points, message } of badOutlines) {
    pose = frame(0, 0);
    act('start');
    for (const point of points) driveTo(...point);
    const draft = act('review');
    assert.match(draft.preview.issues.join(' '), message);
    if (/crosses|doubles back/.test(message.source)) assert.equal(draft.preview.problemSegments.length, 2);
    act('cancel');
  }

  pose = frame(0, 0);
  act('start', { fieldId });
  for (const point of square.slice(1).concat([square[0]])) driveTo(...point);
  const review = act('review').preview;
  // Block this write while preserving the previously retained field store.
  const originalFile = store.file(SAVE);
  const blockedDir = originalFile + '.blocked';
  fs.writeFileSync(blockedDir, '');
  const fileForSave = store.file.bind(store);
  store.file = () => path.join(blockedDir, 'ops-fields.json');
  assert.throws(() => act('finish', { reviewId: review.id }), /Could not save boundary/);
  assert.equal(store.field(SAVE, fieldId).active, 2);
  assert.equal(recorder.status(SAVE, pose).mode, 'review');
  store.file = fileForSave;
  assert.equal(act('finish', { reviewId: review.id }).saved.v, 3);
  console.log('boundary recorder checks passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

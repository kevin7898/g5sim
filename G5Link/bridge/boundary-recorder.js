'use strict';

const { randomUUID } = require('crypto');
const { polygonArea, round1, simplify } = require('./fields.js');

const SAMPLE_DISTANCE = 1;
const MAX_POINTS = 20000;
const UNDO_DISTANCE = 5;
const MAX_LIVE_STEP = 25;
const LONG_CONNECTOR = 25;
const CONNECTOR_TOLERANCE = 2;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const vehicleKey = v => v?.id ?? v?.name ?? null;

function toolsFor(frame) {
  if (frame?.link !== 'live' || frame.state !== 'vehicle') return [];
  return (frame.implements || []).flatMap((implement, index) =>
    Number.isFinite(implement.width) && implement.width > 0 ? [{
      key: implement.id != null ? `id:${implement.id}` : `index:${index}`,
      name: implement.name || `Implement ${index + 1}`, width: implement.width,
    }] : []).sort((a, b) => b.width - a.width);
}

function pointAt(vehicle, side, offset) {
  if (!vehicle || !Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.z)) return null;
  if (offset && !Number.isFinite(vehicle.heading)) return null;
  const heading = Number.isFinite(vehicle.heading) ? vehicle.heading * Math.PI / 180 : 0;
  const lateral = side === 'left' ? -offset : side === 'right' ? offset : 0;
  return [vehicle.x + Math.cos(heading) * lateral, vehicle.z + Math.sin(heading) * lateral]
    .map(value => Math.round(value * 100) / 100);
}

const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const collinear = n => Math.abs(n) < 1e-8;
const between = (n, a, b) => n >= Math.min(a, b) && n <= Math.max(a, b);
const onSegment = (p, a, b) => between(p[0], a[0], b[0]) && between(p[1], a[1], b[1]);

function segmentsMeet(a, b, c, d) {
  const abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b);
  if (collinear(abC) && onSegment(c, a, b) || collinear(abD) && onSegment(d, a, b)
    || collinear(cdA) && onSegment(a, c, d) || collinear(cdB) && onSegment(b, c, d)) return true;
  return ![abC, abD, cdA, cdB].some(collinear) && (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function crossingSegments(points) {
  const count = points.length;
  // Adjacent edges may meet at their shared vertex, but must not double back over each other.
  for (let i = 0; i < count; i++) {
    const a = points[(i + count - 1) % count], b = points[i], c = points[(i + 1) % count];
    if (collinear(turn(a, b, c)) && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0) return [[a, b], [b, c]];
  }
  // Sweep along the path's longer axis to avoid comparing distant segments.
  const bounds = points.reduce((box, [x, z]) =>
    [Math.min(box[0], x), Math.max(box[1], x), Math.min(box[2], z), Math.max(box[3], z)],
    [Infinity, -Infinity, Infinity, -Infinity]);
  const axis = bounds[1] - bounds[0] >= bounds[3] - bounds[2] ? 0 : 1;
  const other = 1 - axis;
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % count];
    return { a, b, i, min: Math.min(a[axis], b[axis]), max: Math.max(a[axis], b[axis]),
      lo: Math.min(a[other], b[other]), hi: Math.max(a[other], b[other]) };
  }).sort((a, b) => a.min - b.min);
  for (let i = 0; i < count; i++) {
    const edge = edges[i];
    for (let j = i + 1; j < count && edges[j].min <= edge.max; j++) {
      const next = edges[j], apart = Math.abs(edge.i - next.i);
      if (apart === 1 || apart === count - 1 || edge.hi < next.lo || next.hi < edge.lo) continue;
      if (segmentsMeet(edge.a, edge.b, next.a, next.b)) return [[edge.a, edge.b], [next.a, next.b]];
    }
  }
  return [];
}

function reviewBoundary(points, length) {
  const gap = points.length > 1 ? distance(points[0], points[points.length - 1]) : null;
  const gapLimit = Math.min(15, Math.max(2, length * 0.05));
  const issues = [];
  const ring = round1(points).filter((point, index, rounded) => !index || distance(point, rounded[index - 1]) > 0);
  // An endpoint within one sample step counts as returning to the start.
  if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) <= SAMPLE_DISTANCE) ring.pop();
  if (points.length >= MAX_POINTS) issues.push('Recording reached the point limit. Shorten the draft before saving.');
  if (ring.length < 3 || length < 30) issues.push('Drive at least 30 m around a field with three or more distinct points.');
  if (gap !== null && gap > gapLimit) issues.push('Return closer to the start before saving.');
  const problemSegments = ring.length >= 3 ? crossingSegments(ring) : [];
  if (problemSegments.length) issues.push('The outline crosses or doubles back on itself. Undo the affected stretch and re-drive it.');
  let outline = ring;
  if (issues.length === 0) {
    const simplified = simplify(ring, 0.5);
    if (simplified.length >= 3 && polygonArea(simplified) >= 25 && !crossingSegments(simplified).length) outline = simplified;
  }
  const area = polygonArea(outline);
  if (outline.length >= 3 && area < 25) issues.push('The outline must enclose at least 25 m².');
  const perimeter = outline.length >= 3 ? outline.reduce((sum, point, index) =>
    sum + distance(point, outline[(index + 1) % outline.length]), 0) : null;
  return { outline, area, perimeter, gap, gapLimit, issues, problemSegments };
}

class BoundaryRecorder {
  constructor() {
    this.id = randomUUID();
    this.draft = null;
    this.revision = 0;
  }

  blocked(draft, save, frame) {
    if (save !== draft.save) return 'save';
    if (frame?.link !== 'live') return 'link';
    if (frame.state !== 'vehicle' || vehicleKey(frame.vehicle) !== draft.vehicle) return 'vehicle';
    if (!pointAt(frame.vehicle, draft.side, draft.offset)) return 'position';
    return null;
  }

  rememberPose(frame) {
    this.draft.lastCenter = pointAt(frame.vehicle, 'center', 0);
    this.draft.lastTime = Number.isFinite(frame.time) ? frame.time : null;
  }

  sample(point) {
    const { points } = this.draft;
    const last = points[points.length - 1];
    const step = last ? distance(last, point) : 0;
    if (points.length >= MAX_POINTS || last && step < SAMPLE_DISTANCE) return;
    points.push(point);
    this.draft.length += step;
    this.draft.redo = [];
    this.revision++;
  }

  onFrame(save, frame) {
    const draft = this.draft;
    if (!draft || draft.mode !== 'recording') return;
    const blocked = this.blocked(draft, save, frame);
    const center = blocked ? null : pointAt(frame.vehicle, 'center', 0);
    const jumped = center && draft.lastCenter && distance(center, draft.lastCenter) > MAX_LIVE_STEP;
    const restarted = Number.isFinite(frame?.time) && draft.lastTime !== null && frame.time < draft.lastTime;
    if (blocked || jumped || restarted) {
      draft.mode = 'paused';
      draft.pauseReason = blocked || (restarted ? 'restart' : 'jump');
      this.revision++;
      return;
    }
    this.rememberPose(frame);
    this.sample(pointAt(frame.vehicle, draft.side, draft.offset));
  }

  status(save, frame) {
    const draft = this.draft;
    if (!draft) return { active: false, recorderId: this.id, revision: this.revision, tools: toolsFor(frame) };
    const { points, mode } = draft;
    const last = points[points.length - 1];
    const blocked = this.blocked(draft, save, frame);
    const cursor = blocked ? null : pointAt(frame.vehicle, draft.side, draft.offset);
    const connectorLength = last && cursor ? distance(last, cursor) : null;
    return { active: true, recorderId: this.id, draftId: draft.id, revision: this.revision, mode, paused: mode === 'paused',
      points: points.length, length: draft.length, gap: points.length > 1 ? distance(points[0], last) : null,
      side: draft.side, offset: draft.offset, reference: draft.reference, tool: draft.tool, fieldId: draft.fieldId, name: draft.name,
      canUndo: points.length > 1 && mode !== 'review', canRedo: draft.redo.length > 0 && mode !== 'review',
      cursor, connectorLength, needsConnectorConfirmation: connectorLength > LONG_CONNECTOR,
      pauseReason: blocked || draft.pauseReason, sameSave: save === draft.save };
  }

  snapshot(save, frame) {
    const status = this.status(save, frame);
    return { ...status, path: status.sameSave ? this.draft.points : [], preview: status.sameSave ? this.draft.preview : null };
  }

  command(input, save, frame, store) {
    const { action } = input;
    const draft = this.draft;
    if (action === 'start') {
      if (draft) throw new Error('A boundary draft is already open.');
      if (frame?.link !== 'live' || frame.state !== 'vehicle' || vehicleKey(frame.vehicle) == null || !pointAt(frame.vehicle, 'center', 0)) {
        throw new Error('Enter a vehicle with a live display connection before recording.');
      }
      const side = ['left', 'right'].includes(input.side) ? input.side : 'center';
      const reference = input.reference === 'implement' ? 'implement' : 'vehicle';
      const tools = reference === 'implement' ? toolsFor(frame) : [];
      const tool = tools.find(choice => choice.key === input.tool) || (input.tool == null ? tools[0] : null);
      if (reference === 'implement' && (!tool || side === 'center')) {
        throw new Error('Attach a working implement and select its left or right edge.');
      }
      const offset = tool ? tool.width / 2
        : side === 'center' ? 0 : Math.max(0, Math.min(30, Number(input.offset) || 0));
      const point = pointAt(frame.vehicle, side, offset);
      if (!point) throw new Error('Wait for a valid vehicle heading to record an offset.');
      const fieldId = input.fieldId == null ? null : String(input.fieldId);
      if (fieldId !== null && !store.field(save, fieldId)) throw new Error('The target field is no longer available.');
      this.draft = { id: randomUUID(), save, vehicle: vehicleKey(frame.vehicle), mode: 'recording', points: [], length: 0,
        redo: [], preview: null, side, offset, reference, tool, fieldId, name: String(input.name || '').trim().slice(0, 60) || null };
      this.rememberPose(frame);
      this.sample(point);
      return this.snapshot(save, frame);
    }
    if (action === 'finish' && input.draftId !== draft?.id) {
      const saved = store.recordedBoundary(save, input.draftId, input.reviewId);
      if (saved) return { ...this.snapshot(save, frame), saved };
    }
    if (!draft || input.draftId !== draft.id) throw new Error('This boundary draft is no longer current.');
    if (action === 'cancel') {
      this.draft = null;
    } else {
      if (save !== draft.save) throw new Error('Return to the savegame where this boundary was started.');
      if (action === 'finish') {
        const preview = draft.preview;
        if (draft.mode !== 'review' || !preview || input.reviewId !== preview.id) {
          throw new Error('Review the current boundary before saving.');
        }
        if (preview.issues.length) throw new Error(preview.issues[0]);
        if (draft.fieldId !== null && !store.field(save, draft.fieldId)) throw new Error('The target field is no longer available.');
        const saved = store.addBoundary(draft.save, { fieldId: draft.fieldId, name: draft.name, source: 'driven',
          polygon: preview.outline, newField: draft.fieldId === null, recording: { draft: draft.id, review: preview.id } });
        this.draft = null;
        this.revision++;
        return { ...this.snapshot(save, frame), saved };
      }
      if (action === 'review') {
        if (draft.mode !== 'review') {
          draft.preview = { id: randomUUID(), ...reviewBoundary(draft.points, draft.length) };
          draft.mode = 'review';
        }
      } else if (action === 'edit') {
        if (draft.mode !== 'review') throw new Error('No boundary preview is open.');
        draft.preview = null;
        draft.mode = 'paused';
        draft.pauseReason = 'operator';
      } else {
        if (draft.mode === 'review') throw new Error('Return to the draft before editing it.');
        this.editDraft(input, save, frame);
      }
    }
    this.revision++;
    return this.snapshot(save, frame);
  }

  editDraft({ action, resumeTo }, save, frame) {
    const draft = this.draft;
    if (action === 'pause') {
      draft.mode = 'paused';
      draft.pauseReason = 'operator';
    }
    else if (action === 'resume') {
      if (draft.mode === 'recording') return;
      if (this.blocked(draft, save, frame)) throw new Error('Return to the recording vehicle with a live position and heading.');
      const point = pointAt(frame.vehicle, draft.side, draft.offset);
      if (distance(draft.points.at(-1), point) > LONG_CONNECTOR &&
        (!Array.isArray(resumeTo) || resumeTo.length !== 2 || !resumeTo.every(Number.isFinite) || distance(resumeTo, point) > CONNECTOR_TOLERANCE)) {
        throw new Error('Confirm the long connector from the current position or drive closer to the recorded line.');
      }
      draft.mode = 'recording';
      draft.pauseReason = null;
      this.rememberPose(frame);
      this.sample(point);
    } else if (action === 'undo') {
      const removed = [];
      let length = 0;
      while (draft.points.length > 1 && length < UNDO_DISTANCE) {
        const point = draft.points.pop();
        length += distance(point, draft.points[draft.points.length - 1]);
        removed.push(point);
      }
      if (removed.length) {
        draft.redo.push({ points: removed.reverse(), length });
        draft.length = Math.max(0, draft.length - length);
        draft.mode = 'paused';
        draft.pauseReason = 'undo';
      }
    } else if (action === 'redo') {
      const step = draft.redo.pop();
      if (step) {
        draft.points.push(...step.points);
        draft.length += step.length;
      }
    } else throw new Error('Unknown boundary action.');
  }
}

module.exports = { BoundaryRecorder };

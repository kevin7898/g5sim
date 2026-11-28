'use strict';

const MAX_POINTS = 20000;
const MIN_AREA_M2 = 25;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const collinear = n => Math.abs(n) < 1e-8;
const between = (n, a, b) => n >= Math.min(a, b) && n <= Math.max(a, b);
const onSegment = (p, a, b) => between(p[0], a[0], b[0]) && between(p[1], a[1], b[1]);

function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}

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

const perimeter = points => points.reduce((sum, point, index) => sum + distance(point, points[(index + 1) % points.length]), 0);

module.exports = { distance, crossingSegments, polygonArea, perimeter, MAX_POINTS, MIN_AREA_M2 };

'use strict';
// Stress-test demo field for `--demo bigfield`: a ~1500 acre (607 ha) field with an odd shape (three lobes, a deep
// bite and a peninsula), harvested the way a combine does it: four headland laps from the outside in, then the
// inside in straight passes. Concave parts split the passes into separate blocks (boustrophedon cells), each worked
// back and forth with headland turns, with transits between blocks. Yield and moisture vary over the field.
// Dependency-free (Node 18+), like the bridge.

const TARGET_HA = 607;          // 1500 ac
const HEADLANDS = 4;
const STEP = 4;                 // m between path points

// ---------------------------------------------------------------- shape
function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function bump(th, at, half, edge) {             // 1 inside [at-half, at+half], smooth edges, wraps around 2π
  let d = Math.abs(((th - at + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return 1 - smooth(half, half + edge, d);
}
function radiusAt(th) {
  return 1 + 0.16 * Math.sin(3 * th + 0.4) + 0.07 * Math.cos(5 * th) + 0.04 * Math.sin(9 * th + 1)
    - 0.30 * bump(th, 2.2, 0.10, 0.07)          // the bite (a farmyard and a wood cutting in)
    + 0.16 * bump(th, 5.0, 0.07, 0.06);         // a peninsula
}
function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function boundary(cx, cz) {
  const N = 900, unit = [];
  for (let i = 0; i < N; i++) { const th = i / N * Math.PI * 2, r = radiusAt(th); unit.push([Math.cos(th) * r, Math.sin(th) * r]); }
  const R = Math.sqrt(TARGET_HA * 10000 / Math.abs(ringArea(unit)));
  return unit.map(([x, z]) => [cx + x * R, cz + z * R]);
}

// Inset a closed ring by d (m) toward the inside, dropping the small loops that concave corners make.
function inset(ring, d) {
  const n = ring.length, s = Math.sign(ringArea(ring)) || 1, out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], p = ring[i], b = ring[(i + 1) % n];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    // inward normal: left of travel for a counter-clockwise (positive area) ring
    out.push([p[0] - tz * d * s, p[1] + tx * d * s]);
  }
  // remove points where the inset runs backwards against the original edge (swallowtails)
  const keep = [];
  for (let i = 0; i < n; i++) {
    const o0 = ring[i], o1 = ring[(i + 1) % n], q0 = out[i], q1 = out[(i + 1) % n];
    const dot = (o1[0] - o0[0]) * (q1[0] - q0[0]) + (o1[1] - o0[1]) * (q1[1] - q0[1]);
    if (dot > 0) keep.push(q0);
  }
  return keep;
}

// ---------------------------------------------------------------- path helpers
function resample(pts, work, closed) {
  const out = [];
  const list = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < list.length - 1; i++) {
    const [x0, z0] = list[i], [x1, z1] = list[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / STEP));
    for (let k = 0; k < n; k++) out.push({ x: x0 + (x1 - x0) * k / n, z: z0 + (z1 - z0) * k / n, work });
  }
  if (!closed) { const [x, z] = list[list.length - 1]; out.push({ x, z, work }); }
  return out;
}
const line = (a, b, work) => resample([a, b], work, false);
// Transit along a harvested headland lap (shorter way round) instead of across standing crop
function viaRing(ring, a, b) {
  const near = q => { let best = Infinity, bi = 0; ring.forEach((p, i) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < best) { best = d; bi = i; } }); return bi; };
  const i0 = near(a), i1 = near(b), n = ring.length;
  const fwd = (i1 - i0 + n) % n, back = (i0 - i1 + n) % n;
  const pts = [a];
  if (Math.min(fwd, back) > 2) for (let k = 0; k <= Math.min(fwd, back); k++) pts.push(ring[(i0 + (fwd <= back ? k : -k) + n * 2) % n]);
  pts.push(b);
  return resample(pts, false, false);
}

// passes along heading h: line positions across (o) and the polygon's intervals along each
function sweep(ring, h, W) {
  const f = [Math.sin(h), -Math.cos(h)], r = [Math.cos(h), Math.sin(h)];
  const across = p => p[0] * r[0] + p[1] * r[1], along = p => p[0] * f[0] + p[1] * f[1];
  const os = ring.map(across);
  const o0 = Math.min(...os), o1 = Math.max(...os);
  const lines = [];
  for (let o = o0 + W / 2; o < o1; o += W) {
    const ts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ua = across(a) - o, ub = across(b) - o;
      if ((ua <= 0) !== (ub <= 0)) { const u = ua / (ua - ub); ts.push(along(a) + (along(b) - along(a)) * u); }
    }
    ts.sort((p, q) => p - q);
    const segs = [];
    for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 2 * W) segs.push([ts[i], ts[i + 1]]);
    lines.push({ o, segs });
  }
  const pt = (o, t) => [r[0] * o + f[0] * t, r[1] * o + f[1] * t];
  return { lines, pt };
}
// boustrophedon cells: a segment continues a block when it overlaps that block's last segment and nothing else
function cells(lines) {
  const done = [];
  let open = [];
  for (const { o, segs } of lines) {
    const next = [];
    const used = new Set();
    for (const s of segs) {
      const hits = open.filter(c => c.last[0] < s[1] && s[0] < c.last[1]);
      const c = hits.length === 1 && !used.has(hits[0]) && segs.filter(q => hits[0].last[0] < q[1] && q[0] < hits[0].last[1]).length === 1 ? hits[0] : null;
      if (c) { used.add(c); c.passes.push({ o, s }); c.last = s; next.push(c); }
      else { const nc = { passes: [{ o, s }], last: s }; next.push(nc); }
    }
    for (const c of open) if (!next.includes(c)) done.push(c);
    open = next;
  }
  return done.concat(open);
}

// ---------------------------------------------------------------- the whole route
function build({ cx = 0, cz = -1600, width = 12.19, heading = 75 } = {}) {
  const field = boundary(cx, cz);
  const W = width, h = heading * Math.PI / 180;
  const path = [];
  const push = pts => { for (const p of pts) path.push(p); };
  // headland laps, outside in; each lap starts near where the last one ended
  let at = null;
  const rings = [];
  for (let k = 0; k < HEADLANDS; k++) rings.push(inset(field, W * (k + 0.5)));
  for (const ring of rings) {
    let i0 = 0;
    if (at) { let best = Infinity; ring.forEach((p, i) => { const d = (p[0] - at.x) ** 2 + (p[1] - at.z) ** 2; if (d < best) { best = d; i0 = i; } }); }
    const lap = [...ring.slice(i0), ...ring.slice(0, i0)];
    if (at) push(line([at.x, at.z], lap[0], false));
    push(resample(lap, true, true));
    at = path[path.length - 1];
  }
  // the inside: straight passes in blocks
  const inner = inset(field, W * HEADLANDS);
  const { lines, pt } = sweep(inner, h, W);
  const blocks = cells(lines);
  const left = new Set(blocks);
  let passes = 0, turns = 0;
  while (left.size) {
    // nearest block by either end of its first or last pass
    let best = null, bd = Infinity;
    for (const b of left) for (const rev of [false, true]) {
      const p0 = rev ? b.passes[b.passes.length - 1] : b.passes[0];
      for (const flip of [false, true]) {
        const q = pt(p0.o, flip ? p0.s[1] : p0.s[0]), d = (q[0] - at.x) ** 2 + (q[1] - at.z) ** 2;
        if (d < bd) { bd = d; best = { b, rev, flip }; }
      }
    }
    left.delete(best.b);
    const list = best.rev ? [...best.b.passes].reverse() : best.b.passes;
    let dir = best.flip ? -1 : 1, prev = null;
    for (const p of list) {
      const a = pt(p.o, dir > 0 ? p.s[0] : p.s[1]), b = pt(p.o, dir > 0 ? p.s[1] : p.s[0]);
      if (prev) {
        // headland turn: run out to the farther end, half circle, back in
        const apex = -dir > 0 ? Math.max(prev.t, dir > 0 ? p.s[0] : p.s[1]) + 6 : Math.min(prev.t, dir > 0 ? p.s[0] : p.s[1]) - 6;
        const e = pt(prev.o, apex), s2 = pt(p.o, apex);
        push(line([at.x, at.z], e, false));
        const mo = (prev.o + p.o) / 2, rad = (p.o - prev.o) / 2;
        for (let i = 1; i < 12; i++) {
          const th = Math.PI * i / 12;
          const q = pt(mo - Math.cos(th) * rad, apex + -dir * Math.sin(th) * Math.abs(rad));
          path.push({ x: q[0], z: q[1], work: false });
        }
        push(line(s2, a, false));
        turns++;
      } else push(viaRing(rings[HEADLANDS - 1], [at.x, at.z], a));   // transit to the block along the headland
      push(line(a, b, true));
      at = path[path.length - 1];
      prev = { o: p.o, t: dir > 0 ? p.s[1] : p.s[0] };
      dir = -dir;
      passes++;
    }
  }
  let s = 0;
  path.forEach((p, i) => { if (i) s += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z); p.s = s; });
  // remaining turns at each point, for the Courseplay provider
  let tl = 0;
  for (let i = path.length - 1; i >= 0; i--) { if (i && path[i - 1].work && !path[i].work) tl++; path[i].turnsLeft = tl; }
  return { field, path, passes, turns, blocks: blocks.length, ha: Math.abs(ringArea(field)) / 10000, headlands: HEADLANDS };
}

// ---------------------------------------------------------------- yield and moisture
// Several scales: field-wide trends, rolling ground, small wet holes and a sandy ridge; moisture follows low
// ground and the time of day (dries through the afternoon).
const g = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * r * r));
function yieldAt(x, z) {
  let y = 7.0 + 1.2 * Math.sin(x / 410 + 0.7) * Math.cos(z / 530) + 0.6 * Math.sin(x / 97 + z / 131) + 0.35 * Math.sin(x / 23) * Math.cos(z / 29);
  y -= 4.2 * g(x, z, -520, -1250, 70) + 3.5 * g(x, z, 610, -2280, 55) + 2.8 * g(x, z, 260, -900, 40);  // drowned-out holes
  y -= 2.4 * Math.max(0, Math.sin((x * 0.8 + z * 0.6) / 260)) ** 6;                                     // sandy ridges
  y += 1.4 * g(x, z, -900, -2100, 220);                                                                  // an old feedlot
  return Math.max(0.6, y);
}
function moistureAt(x, z, tMs) {
  const low = 0.5 + 0.5 * Math.sin(x / 380 - 0.4) * Math.cos(z / 460 + 1.1);
  const hour = (tMs / 2500 / 60 + 6) % 24;
  const dry = Math.max(0, Math.min(1, (hour - 9) / 7));          // dries from 9:00 to 16:00
  let m = 13.0 + 4.5 * low + 0.6 * Math.sin(x / 61 + z / 47) - 2.2 * dry;
  m += 5 * (g(x, z, -520, -1250, 140) + g(x, z, 610, -2280, 120));
  return Math.max(10.5, Math.min(24, m));
}

module.exports = { build, yieldAt, moistureAt };

if (require.main === module) {
  const t0 = Date.now(), r = build();
  const work = r.path.filter((p, i) => i && p.work && r.path[i - 1].work).length;
  console.log(`field ${r.ha.toFixed(0)} ha (${(r.ha * 2.47105).toFixed(0)} ac), ${r.blocks} blocks, ${r.passes} passes, ${r.turns} turns, ` +
    `${r.path.length} points, ${(r.path[r.path.length - 1].s / 1000).toFixed(0)} km (${(work * STEP / 1000).toFixed(0)} km working), ${Date.now() - t0} ms`);
}

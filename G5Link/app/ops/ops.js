'use strict';
// G5Link Operations Center: Map (fields by last work type, equipment), Land (Client > Farm > Field),
// field pages with versioned boundaries (game map, driven, drawn, from coverage), Work Analyzer and
// Equipment. Data from the bridge (/api/ops/*, /api/map/*). Layout follows the real Operations Center.

const $ = id => document.getElementById(id);
function setHtml(el, html) { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } }
const S = { summary: null, version: -1, page: 'map', mapSub: 'fields', search: '', workKind: null, field: null, detail: null,
  proposal: null, pick: false, draw: null, layerOp: null, layerKey: 'coverage', frames: [], framesOp: null, framesSeq: 0,
  overlap: null, work: [], mapsKey: '' };

function toast(text, ms = 3200) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (j && j.ok === false) throw new Error(j.error || 'request failed');
  return j;
}
const area = ha => typeof ha === 'number' ? `${fmt(U.areaFromHa(ha), 2)} ${U.areaUnit()}` : '---';
const dayTxt = d => typeof d === 'number' && d >= 0 ? `Day ${d}` : '';
const dateTxt = ms => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const SOURCE = { game: 'Game Map', driven: 'Driven', coverage: 'From Operation', drawn: 'Drawn' };
const KIND = { tillage: 'Tillage', seeding: 'Seeding', application: 'Application', harvest: 'Harvest' };
const KIND_COLOR = { tillage: '#8a5a2b', seeding: '#5fa83a', application: '#3f7fd0', harvest: '#e07a2e' };
const clientName = () => (S.summary && S.summary.settings && S.summary.settings.client) || 'My Operation';
const farmName = () => (S.summary && S.summary.farmName) || 'My Farm';
const owned = f => f.owner === undefined || f.owner === null || f.owner === (S.summary.farmId ?? 1);
const shapeSvg = (poly, color = '#d63cc7', cls = 'shape') => {
  if (!poly || poly.length < 3) return `<span class="${cls}"></span>`;
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), sc = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) || 1;
  const pts = poly.map(([x, z]) => `${(2 + (x - x0) / sc * 22).toFixed(1)},${(2 + (z - z0) / sc * 12).toFixed(1)}`).join(' ');
  return `<svg class="${cls}" viewBox="0 0 26 16"><polygon points="${pts}" fill="${color}33" stroke="${color}" stroke-width="1.4"/></svg>`;
};

// ---------------------------------------------------------------- map (north up: world x right, world z down)
const canvas = $('map'), ctx = canvas.getContext('2d');
const V = { cx: 0, cz: 0, ppm: 0.5, fitted: false };
function size() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, dpr };
}
const toScreen = (x, z, s) => [(x - V.cx) * V.ppm * s.dpr + s.w / 2, (z - V.cz) * V.ppm * s.dpr + s.h / 2];
const toWorld = (px, py) => { const s = size(); return [(px * s.dpr - s.w / 2) / (V.ppm * s.dpr) + V.cx, (py * s.dpr - s.h / 2) / (V.ppm * s.dpr) + V.cz]; };
function fitTo(polys) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of polys) for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (!isFinite(x0)) return;
  const r = canvas.getBoundingClientRect();
  V.cx = (x0 + x1) / 2; V.cz = (z0 + z1) / 2;
  V.ppm = Math.min(r.width / Math.max(40, (x1 - x0) * 1.2), r.height / Math.max(40, (z1 - z0) * 1.25));
}
function fitAll() {
  const sm = S.summary;
  if (!sm) return;
  const polys = sm.fields.map(f => f.polygon);
  for (const e of sm.equipment || []) polys.push([[e.x - 40, e.z - 40], [e.x + 40, e.z + 40]]);
  fitTo(polys);
}
function activeBoundary() {
  const f = S.detail && S.detail.field;
  return f ? f.boundaries.find(x => x.v === f.active) || null : null;
}
function fitField() {
  const b = activeBoundary();
  if (b) fitTo([b.polygon].concat(S.proposal && S.proposal.polygon ? [S.proposal.polygon] : []));
}
function pathPoly(poly, s) {
  ctx.beginPath();
  poly.forEach(([x, z], i) => { const [px, py] = toScreen(x, z, s); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
}

// layers (same rules as the G5 display: blue coverage, dark blue overlap, 10-step legend red -> green)
const RAMP = ['#c40b0b', '#dc3b1a', '#ec741c', '#f4a81e', '#f1d424', '#c7dc2c', '#8dc63a', '#55aa3b', '#2f8a31', '#1b6424'];
const LAYERS = {
  coverage: { label: 'Coverage' },
  yield: { label: 'Yield', good: 'high', conv: v => HU.yield(v, opMeta().product), unit: () => HU.yieldUnit() },
  moisture: { label: 'Moisture', good: 'low', unit: () => '%' },
  loss: { label: 'Grain Loss', good: 'low', unit: () => '%' },
  rate: { label: 'Rate', good: 'none', conv: v => rateConv(v), unit: () => rateUnit() },
  singulation: { label: 'Singulation', good: 'high', unit: () => '%' },
  skips: { label: 'Skips', good: 'low', unit: () => '%' },
  doubles: { label: 'Doubles', good: 'low', unit: () => '%' },
  cv: { label: 'Distribution CV', good: 'low', unit: () => '%' },
  depth: { label: 'Seed Depth', good: 'none', conv: v => metric('distance') ? v : v / 25.4, unit: () => metric('distance') ? 'mm' : 'in' },
  soilMoisture: { label: 'Soil Moisture', good: 'none', unit: () => '%' },
  compaction: { label: 'Compaction', good: 'low', unit: () => '%' },
  yieldPotential: { label: 'Yield Potential', good: 'high', unit: () => '%' },
  speed: { label: 'Speed', good: 'none', conv: v => U.speed(v), unit: () => U.speedUnit() },
  soilN: { label: 'Soil N', good: 'high', unit: () => '' }, soilP: { label: 'Soil P', good: 'high', unit: () => '' },
  soilK: { label: 'Soil K', good: 'high', unit: () => '' }, soilPH: { label: 'Soil pH', good: 'none', unit: () => '' },
};
const maps = () => (S.summary && S.summary.maps) || [];
const opMeta = (id = S.layerOp) => maps().find(o => o.id === id) || {};
function rateUnit(meta = opMeta()) {
  const u = meta.rateUnit;
  if (u === 'seeds/ac') return metric('rate') ? 'seeds/ha' : 'seeds/ac';
  if (u === 'lb/ac') return metric('rate') ? 'kg/ha' : 'lb/ac';
  return metric('volume') ? 'L/ha' : 'gal/ac';
}
function rateConv(v, meta = opMeta()) {
  const u = meta.rateUnit;
  if (u === 'seeds/ac') return metric('rate') ? v * 2.47105 : v;
  if (u === 'lb/ac') return metric('rate') ? v * 1.12085 : v;
  return metric('volume') ? v : v * 0.106907;
}
const rateLabel = (meta = opMeta()) => meta.kind === 'seeding' ? 'Seeding Rate' : 'Applied Rate';
function fieldBox(margin = 300) {
  const b = activeBoundary();
  if (!b) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0: x0 - margin, x1: x1 + margin, z0: z0 - margin, z1: z1 + margin };
}
const inBox = (f, b) => { const q = f.q[0]; return q && q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.z0 && q[1] <= b.z1; };
let rangeCache = null;
function layerRange() {
  const L = LAYERS[S.layerKey];
  const key = S.layerKey + '|' + S.frames.length + '|' + JSON.stringify(settings.units) + '|' + S.field;
  if (rangeCache && rangeCache.key === key) return rangeCache.r;
  let lo = Infinity, hi = -Infinity;
  const bb = fieldBox(0);
  for (const f of S.frames) {
    const v = f.v && f.v[S.layerKey];
    if (typeof v !== 'number' || (bb && !inBox(f, bb))) continue;
    const x = L.conv ? L.conv(v) : v;
    if (x < lo) lo = x; if (x > hi) hi = x;
  }
  let r = null;
  if (lo <= hi) {
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    const raw = (hi - lo) / 10, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p, start = Math.floor(lo / step) * step;
    r = { lo: start, step, n: Math.min(10, Math.max(1, Math.ceil((hi - start) / step))) };
  }
  rangeCache = { key, r };
  return r;
}
const colorIdx = (i, n, good) => { const t = n <= 1 ? 1 : i / (n - 1); return RAMP[Math.max(0, Math.min(9, Math.round((good === 'low' ? 1 - t : t) * 9)))]; };
function frameColor(f) {
  if (S.layerKey === 'coverage') return '#4a7fd6';
  const L = LAYERS[S.layerKey], v = f.v && f.v[S.layerKey], r = layerRange();
  if (typeof v !== 'number' || !r) return null;
  const x = L.conv ? L.conv(v) : v;
  return colorIdx(Math.max(0, Math.min(r.n - 1, Math.floor((x - r.lo) / r.step))), r.n, L.good);
}

function draw() {
  requestAnimationFrame(draw);
  const s = size();
  ctx.fillStyle = '#4b4a43'; ctx.fillRect(0, 0, s.w, s.h);
  const sm = S.summary;
  if (!sm) return;
  // light grid every 100 m (50 m when zoomed in)
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  const step = V.ppm > 0.6 ? 50 : 100;
  const [wx0, wz0] = toWorld(0, 0), [wx1, wz1] = toWorld(s.w / s.dpr, s.h / s.dpr);
  ctx.beginPath();
  for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = toScreen(x, 0, s); ctx.moveTo(px, 0); ctx.lineTo(px, s.h); }
  for (let z = Math.floor(wz0 / step) * step; z <= wz1; z += step) { const [, py] = toScreen(0, z, s); ctx.moveTo(0, py); ctx.lineTo(s.w, py); }
  ctx.stroke();

  const onField = S.page === 'field' && S.detail;
  // fields: colored by last work type (Map and Land), plain on a field page
  for (const f of sm.fields) {
    const sel = f.id === S.field;
    pathPoly(f.polygon, s);
    const lw = f.lastWork && KIND_COLOR[f.lastWork.kind];
    ctx.fillStyle = onField ? 'rgba(255,255,255,.06)' : lw ? lw + '66' : owned(f) ? 'rgba(235,235,225,.16)' : 'rgba(235,235,225,.07)';
    ctx.fill();
    ctx.strokeStyle = onField && sel ? '#d63cc7' : lw && !onField ? lw : 'rgba(240,240,232,.7)';
    ctx.lineWidth = (sel ? 3 : 1.4) * s.dpr;
    ctx.setLineDash(owned(f) ? [] : [6 * s.dpr, 4 * s.dpr]); ctx.stroke(); ctx.setLineDash([]);
  }

  // coverage layer around the open field
  if (onField && S.framesOp && S.frames.length) {
    const byColor = new Map(), bb = fieldBox();
    for (const f of S.frames) {
      if (bb && !inBox(f, bb)) continue;
      const c = frameColor(f) || '#4a7fd6';
      if (!byColor.has(c)) byColor.set(c, []);
      byColor.get(c).push(...f.q);
    }
    ctx.globalAlpha = 0.92;
    for (const [c, quads] of byColor) {
      ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const q of quads) {
        for (let i = 0; i < 4; i++) { const [px, py] = toScreen(q[i * 2], q[i * 2 + 1], s); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (S.layerKey === 'coverage' && S.overlap) {
      ctx.fillStyle = '#16307f'; ctx.beginPath();
      for (const [x0, x1, z] of S.overlap.runs) {
        const [ax, ay] = toScreen(x0, z, s), [bx, by] = toScreen(x1, z + (S.overlap.cell || 1), s);
        ctx.rect(ax, ay, bx - ax, by - ay);
      }
      ctx.fill();
    }
  }
  if (onField) {
    const b = activeBoundary();
    if (b) { pathPoly(b.polygon, s); ctx.strokeStyle = '#d63cc7'; ctx.lineWidth = 3 * s.dpr; ctx.stroke(); }
  }

  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${13 * s.dpr}px Noto Sans, sans-serif`;
  for (const f of sm.fields) {
    if (!f.center || (onField && f.id === S.field)) continue;
    const [px, py] = toScreen(f.center.x, f.center.z, s);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(f.name, px + s.dpr, py + s.dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(f.name, px, py);
  }

  // proposal (from a previous operation) and drawing in progress
  if (S.proposal && S.proposal.polygon) {
    pathPoly(S.proposal.polygon, s);
    ctx.fillStyle = 'rgba(214, 60, 199, .15)'; ctx.fill();
    ctx.setLineDash([8 * s.dpr, 6 * s.dpr]); ctx.strokeStyle = '#ff5ee8'; ctx.lineWidth = 3 * s.dpr; ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.draw && S.draw.points.length) {
    ctx.beginPath();
    S.draw.points.forEach(([x, z], i) => { const [px, py] = toScreen(x, z, s); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    if (S.draw.points.length > 2) { ctx.closePath(); ctx.fillStyle = 'rgba(255, 222, 0, .15)'; ctx.fill(); }
    ctx.strokeStyle = '#ffde00'; ctx.lineWidth = 2.5 * s.dpr; ctx.stroke();
    for (const [x, z] of S.draw.points) {
      const [px, py] = toScreen(x, z, s);
      ctx.beginPath(); ctx.arc(px, py, 5 * s.dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#1f1f1d'; ctx.lineWidth = 2 * s.dpr; ctx.stroke();
    }
  }

  // equipment
  for (const e of sm.equipment || []) {
    const [px, py] = toScreen(e.x, e.z, s), r = 8 * s.dpr;
    ctx.save(); ctx.translate(px, py); ctx.rotate((e.heading || 0) * Math.PI / 180);
    ctx.fillStyle = e.inUse ? '#ffde00' : e.motorOn ? '#9be38a' : '#f1efe4'; ctx.strokeStyle = '#1f1f1d'; ctx.lineWidth = 2 * s.dpr;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.5); ctx.lineTo(r, r); ctx.lineTo(0, r * 0.4); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (V.ppm > 0.35 || e.inUse) {
      ctx.font = `600 ${11 * s.dpr}px Noto Sans, sans-serif`; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(e.name, px + r * 1.6 + s.dpr, py + s.dpr);
      ctx.fillStyle = '#fff'; ctx.fillText(e.name, px + r * 1.6, py);
    }
  }
}

// pan, pinch, wheel, tap
let drag = null;
const pointers = new Map();
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  drag = { x: e.offsetX, y: e.offsetY, cx: V.cx, cz: V.cz, moved: false, dist: null, ppm: V.ppm };
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag.dist = Math.hypot(a[0] - b[0], a[1] - b[1]); }
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pointers.size === 2 && drag.dist) {
    const [a, b] = [...pointers.values()];
    V.ppm = Math.max(0.05, Math.min(20, drag.ppm * Math.hypot(a[0] - b[0], a[1] - b[1]) / drag.dist));
    drag.moved = true; return;
  }
  const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { V.cx = drag.cx - dx / V.ppm; V.cz = drag.cz - dy / V.ppm; }
});
canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (drag && !drag.moved) tapMap(e.offsetX, e.offsetY);
  if (!pointers.size) drag = null;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [wx, wz] = toWorld(e.offsetX, e.offsetY);
  V.ppm = Math.max(0.05, Math.min(20, V.ppm * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const [nx, nz] = toWorld(e.offsetX, e.offsetY);
  V.cx += wx - nx; V.cz += wz - nz;
}, { passive: false });
$('zoomIn').onclick = () => { V.ppm = Math.min(20, V.ppm * 1.4); };
$('zoomOut').onclick = () => { V.ppm = Math.max(0.05, V.ppm / 1.4); };
$('zoomFit').onclick = () => { if (S.page === 'field' && S.detail) fitField(); else fitAll(); };
$('locate').onclick = () => {
  const m = (S.summary && S.summary.equipment || []).find(e => e.inUse) || (S.summary && S.summary.here);
  if (m) { V.cx = m.x; V.cz = m.z; V.ppm = Math.max(V.ppm, 1.2); } else toast('No machine in use.');
};

function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
async function tapMap(px, py) {
  const [x, z] = toWorld(px, py);
  if (S.draw) { S.draw.points.push([+x.toFixed(1), +z.toFixed(1)]); renderDraw(); return; }
  if (S.pick) {                                          // new field from the coverage under this point
    S.pick = false; $('mapHint').hidden = true;
    try {
      const r = await api('/api/ops/from-coverage', { x, z });
      if (!r.proposal) return toast('No recorded coverage there.');
      S.proposal = { ...r.proposal, newField: true };
      showPage('analyze');
      toast(`New field from a previous operation: ${area(r.proposal.areaHa)}.`, 4000);
    } catch (e) { toast(e.message); }
    return;
  }
  const f = (S.summary && S.summary.fields || []).find(ff => inPoly(ff.polygon, x, z));
  if (f) openField(f.id);
}

// drawing a boundary on the map
function startDraw(fieldId) {
  S.draw = { points: [], fieldId };
  $('mapDraw').hidden = false; document.querySelector('.mapwrap').classList.add('drawing');
  $('drawTitle').textContent = fieldId ? 'Draw boundary' : 'Draw new field';
  renderDraw();
}
function renderDraw() {
  if (!S.draw) return;
  const p = S.draw.points, n = p.length;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  $('drawInfo').textContent = n < 3 ? `Tap the corners of the field (${n} so far)` : `${n} points · ${area(Math.abs(a) / 2 / 10000)}`;
  $('drawDone').disabled = n < 3; $('drawUndo').disabled = !n;
}
function endDraw() { S.draw = null; $('mapDraw').hidden = true; document.querySelector('.mapwrap').classList.remove('drawing'); }
$('drawUndo').onclick = () => { if (S.draw) { S.draw.points.pop(); renderDraw(); } };
$('drawCancel').onclick = endDraw;
$('drawDone').onclick = async () => {
  const d = S.draw;
  if (!d || d.points.length < 3) return;
  let name = null;
  if (!d.fieldId) { name = prompt('Name for the new field', 'New Field'); if (!name) return; }
  try {
    const r = await api('/api/ops/boundary', { fieldId: d.fieldId, name, newField: !d.fieldId, source: 'drawn', polygon: d.points, note: 'Drawn on the map' });
    endDraw(); toast('Boundary saved.'); await refresh(); openField(r.field);
  } catch (e) { toast(e.message); }
};

// ---------------------------------------------------------------- data
async function refresh() {
  try {
    const sm = await api('/api/ops/summary');
    const first = !S.summary;
    S.summary = sm;
    $('saveName').textContent = sm.save === 'unsaved' ? 'Unsaved game' : `Savegame: ${sm.save}`;
    $('orgName').textContent = `${clientName()} · ${farmName()}`;
    $('linkState').textContent = sm.link === 'live' ? 'Live' : sm.link === 'stale' ? 'Game paused' : 'Waiting for game';
    $('linkState').className = 'link ' + (sm.link === 'live' ? 'live' : 'down');
    if (first || (!V.fitted && sm.fields.length)) { fitAll(); V.fitted = sm.fields.length > 0; }
    if (sm.version !== S.version) { S.version = sm.version; if (S.field) loadField(S.field, false); }
    const key = maps().map(m => m.id + ':' + m.seq).join('|');
    renderAll(key !== S.mapsKey);
    S.mapsKey = key;
    syncFrames();
  } catch (e) {
    $('linkState').textContent = 'Bridge offline'; $('linkState').className = 'link down';
  }
}
async function syncFrames() {
  const op = S.page === 'field' ? S.layerOp : null;
  if (!op) return;
  if (op !== S.framesOp) { S.frames = []; S.framesSeq = 0; S.framesOp = op; S.overlap = null; rangeCache = null; }
  const meta = opMeta(op);
  if (syncFrames.busy || (meta.seq !== undefined && meta.seq <= S.framesSeq && S.overlap && S.overlap.version === meta.overlapVersion)) return;
  syncFrames.busy = true;
  try {
    for (let guard = 0; guard < 50; guard++) {
      const r = await api(`/api/map/frames?op=${encodeURIComponent(op)}&since=${S.framesSeq}`);
      if (S.framesOp !== op) return;
      for (const f of r.frames) S.frames.push(f);
      S.framesSeq = r.frames.length ? r.frames[r.frames.length - 1].s : r.seq;
      if (!r.more) break;
    }
    S.overlap = await api(`/api/map/overlap?op=${encodeURIComponent(op)}`);
    renderLegend();
  } catch (e) { /* retried */ } finally { syncFrames.busy = false; }
}

// ---------------------------------------------------------------- pages
function showPage(page) {
  S.page = page;
  document.querySelectorAll('#nav [data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === (page === 'field' ? 'land' : page)));
  ['map', 'land', 'field', 'analyze', 'equipment', 'settings'].forEach(v => { $('view-' + v).hidden = v !== page; });
  if (page !== 'field') { S.field = null; S.detail = null; S.framesOp = null; if (!(S.proposal && S.proposal.newField)) S.proposal = null; }
  if (page === 'analyze') loadWork();
  renderAll(true);
}
$('nav').onclick = e => { const b = e.target.closest('[data-page]'); if (b) showPage(b.dataset.page); };
$('mapTabs').onclick = e => {
  const b = e.target.closest('[data-sub]'); if (!b) return;
  S.mapSub = b.dataset.sub;
  document.querySelectorAll('#mapTabs button').forEach(x => x.classList.toggle('on', x === b));
  renderMapList();
};
$('mapSearch').oninput = e => { S.search = e.target.value.toLowerCase(); renderMapList(); };
function renderAll(withLayers) {
  renderMapList(); renderLand(); renderEquipment(); renderSettings();
  if (S.page === 'field') renderField();
  if (S.page === 'analyze') renderWork();
  if (withLayers) renderLayerControls(); else renderLegend();
}

// Map page: Fields (grouped worked / no work, filter by work type) or Equipment
function renderMapList() {
  const sm = S.summary;
  if (!sm) return;
  if (S.mapSub === 'equipment') {
    setHtml($('mapChips'), '');
    setHtml($('mapList'), equipmentRows(sm.equipment || []));
    return;
  }
  setHtml($('mapChips'), Object.entries(KIND).map(([k, l]) =>
    `<button class="chip ${S.workKind === k ? 'on' : ''}" data-kind="${k}"><i style="background:${KIND_COLOR[k]}"></i>${l}</button>`).join(''));
  const match = f => (!S.search || String(f.name).toLowerCase().includes(S.search)) && (!S.workKind || (f.lastWork && f.lastWork.kind === S.workKind));
  const worked = sm.fields.filter(f => f.lastWork && match(f)), idle = sm.fields.filter(f => !f.lastWork && match(f));
  const row = f => `<div class="row ${f.id === S.field ? 'on' : ''}" data-field="${esc(f.id)}">${shapeSvg(f.polygon, f.lastWork ? KIND_COLOR[f.lastWork.kind] : '#9a988d', 'ico')}
    <div class="nm"><b>${esc(f.name)}</b><span>${f.lastWork ? `<i class="wk ${f.lastWork.kind}"></i>${esc(f.lastWork.title)}${dayTxt(f.lastWork.day) ? ' · ' + dayTxt(f.lastWork.day) : ''}` : esc(clientName() + ' | ' + (owned(f) ? farmName() : 'Not owned'))}</span></div>
    <span class="num">${area(f.areaHa)}</span><span class="chev">›</span></div>`;
  setHtml($('mapList'), (worked.length ? `<div class="group"><span>Worked (${worked.length})</span><span>Field Area</span></div>${worked.map(row).join('')}` : '')
    + (idle.length ? `<div class="group"><span>No Work Recorded (${idle.length})</span><span>Field Area</span></div>${idle.map(row).join('')}` : '')
    + (!worked.length && !idle.length ? `<p class="empty">${emptyFieldsText()}</p>` : ''));
}
const emptyFieldsText = () => S.summary && S.summary.settings && S.summary.settings.importGame === false
  ? 'No fields yet. Drive a field edge with the Boundary app on the G5 display, draw one on the map (Land > + Add), or create one from recorded coverage.'
  : 'Waiting for the game to send its fields.';
$('mapChips').onclick = e => { const b = e.target.closest('[data-kind]'); if (b) { S.workKind = S.workKind === b.dataset.kind ? null : b.dataset.kind; renderMapList(); } };
$('mapList').onclick = e => {
  const r = e.target.closest('[data-field]'); if (r) return openField(r.dataset.field);
  const q = e.target.closest('[data-eq]'); if (q) focusMachine(q.dataset.eq);
};

// Land page: Client > Farm > Field with totals
function renderLand() {
  const sm = S.summary;
  if (!sm) return;
  const mine = sm.fields.filter(owned), other = sm.fields.filter(f => !owned(f));
  const sum = list => list.reduce((a, f) => a + (f.areaHa || 0), 0);
  const fieldRow = (f, lvl) => `<div class="row lvl${lvl}" data-field="${esc(f.id)}">${shapeSvg(f.polygon, '#d63cc7', 'ico')}
    <div class="nm"><b>${esc(f.name)}<span class="badge ${f.source}">${SOURCE[f.source] || f.source}</span></b><span>${f.versions > 1 ? f.versions + ' boundary versions' : '1 boundary'}${f.farmland ? ' · Farmland ' + f.farmland : ''}</span></div>
    <span class="num">${area(f.areaHa)}</span><span class="chev">›</span></div>`;
  const farm = (name, list, note) => list.length ? `<div class="row lvl1"><span>🏠</span><div class="nm"><b>${esc(name)}</b><span>${note}</span></div><span class="num">${area(sum(list))}</span><span></span></div>${list.map(f => fieldRow(f, 2)).join('')}` : '';
  setHtml($('landList'), sm.fields.length ? `<div class="tree">
    <div class="row"><span>👤</span><div class="nm"><b>${esc(clientName())}</b><span>Client</span></div><span class="num">${area(sum(sm.fields))}</span><span></span></div>
    ${farm(farmName(), mine, 'Farm')}${farm('Not owned', other, 'Map fields the farm does not own')}</div>
    <div class="totals"><span>Totals: 1 Client, ${(mine.length ? 1 : 0) + (other.length ? 1 : 0)} Farms, ${sm.fields.length} Fields</span><span>${area(sum(sm.fields))}</span></div>`
    : `<p class="empty">${emptyFieldsText()}</p>`);
}
$('landList').onclick = e => { const r = e.target.closest('[data-field]'); if (r) openField(r.dataset.field); };
$('landAdd').onclick = () => { $('landAddMenu').hidden = !$('landAddMenu').hidden; };
$('landAddMenu').onclick = e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  $('landAddMenu').hidden = true;
  if (b.dataset.add === 'draw') startDraw(null);
  else if (b.dataset.add === 'coverage') { S.pick = true; $('mapHint').hidden = false; $('mapHint').textContent = 'Tap the recorded coverage of the new field'; }
  else toast('On the G5 display: Menu > Applications > Boundary, choose New Field, then drive the edge.', 5000);
};

// Field page
async function openField(id) {
  S.proposal = null;
  showPage('field');
  S.field = String(id);
  await loadField(id, true);
}
async function loadField(id, fit) {
  try {
    const d = await api(`/api/ops/field?id=${encodeURIComponent(id)}`);
    if (S.field !== String(id)) return;
    S.detail = d;
    const ops = [...new Set(d.records.map(r => r.op))];
    if (!ops.includes(S.layerOp)) S.layerOp = ops[0] || null;
    renderField(); renderLayerControls(); syncFrames();
    if (fit) fitField();
  } catch (e) { toast(e.message); showPage('land'); }
}
function recordValues(r) {
  const a = r.avg || {}, out = [], meta = opMeta(r.op);
  const add = (k, d) => {
    const def = LAYERS[k];
    if (typeof a[k] !== 'number') return;
    const v = k === 'rate' ? rateConv(a[k], meta) : k === 'yield' ? HU.yield(a[k], meta.product) : def.conv ? def.conv(a[k]) : a[k];
    const u = k === 'rate' ? rateUnit(meta) : def.unit();
    out.push(`${k === 'rate' ? rateLabel(meta) : def.label} ${fmt(v, d)} ${u}`.trim());
  };
  if (r.kind === 'harvest') { add('yield', metric('grain') ? 2 : 1); add('moisture', 1); add('loss', 2); }
  if (r.kind === 'seeding') { add('rate', 0); add('singulation', 1); add('skips', 2); add('doubles', 2); add('soilMoisture', 0); }
  if (r.kind === 'application') add('rate', 1);
  add('speed', 1);
  return out.join(' · ');
}
function renderField() {
  const d = S.detail;
  if (!d) return;
  const f = d.field, b = f.boundaries.find(x => x.v === f.active), recs = d.records;
  $('fieldCrumb').textContent = f.name;
  const versions = [...f.boundaries].sort((x, y) => (y.v === f.active) - (x.v === f.active) || y.v - x.v);
  setHtml($('fieldDetail'), `
    <div class="card"><h2>${esc(f.name)}<button class="edit" id="fieldRename" title="Rename">✎</button></h2>
      <div class="who">${esc(clientName())} | ${esc(owned(f) ? farmName() : 'Not owned')}${f.farmland ? ' · Farmland ' + f.farmland : ''}</div>
      <div class="checks"><span class="${b ? '' : 'no'}">Active Boundary</span><span class="${recs.length ? '' : 'no'}">Work Records</span><span class="no" title="Guidance tracks are kept on the G5 display">Guidance</span></div></div>
    <h3>Boundaries</h3>
    ${versions.map(x => `<div class="bnd ${x.v === f.active ? 'active' : ''}">${shapeSvg(x.polygon, x.v === f.active ? '#d63cc7' : '#9a988d')}
        <b>${esc(f.name)}-Boundary${f.boundaries.length > 1 ? ' ' + x.v : ''}</b>
        ${x.v === f.active ? '<span class="state">Active</span>' : `<button class="mini" data-use="${x.v}">Make Active</button>`}
        <span class="sub">Basic | ${SOURCE[x.source] || x.source} | ${area(x.areaHa)}${dateTxt(x.at) ? ' | ' + dateTxt(x.at) : ''}${x.source !== 'game' ? ` · <button class="mini" data-remove="${x.v}">Delete</button>` : ''}</span></div>`).join('')}
    <div class="bnd-actions"><span></span>
      <div class="add-wrap"><button class="linkbtn" id="addBnd">+ Add Boundary ▾</button>
        <div class="menu" id="addBndMenu" hidden>
          <button data-ab="draw"><b>From Map</b><span>Draw the boundary on the map</span></button>
          <button data-ab="coverage"><b>From a previous operation</b><span>Trace it from recorded coverage, e.g. after working new ground</span></button>
          <button data-ab="drive"><b>Drive the edge</b><span>Boundary app on the G5 display, in this field</span></button>
        </div></div></div>
    ${S.proposal && !S.proposal.newField ? `<div class="proposal">From a previous operation: ${area(S.proposal.areaHa)} (${S.proposal.addedHa >= 0 ? '+' : ''}${area(S.proposal.addedHa)})
      <div class="acts"><button class="btn primary" id="propSave">Save as New Boundary</button><button class="btn" id="propDrop">Discard</button></div></div>` : ''}
    <p class="note">The newest driven, drawn or traced boundary is active unless you make another one active. Work records follow the active boundary.</p>
    <h3>Work Records</h3>
    ${recs.length ? `<table class="rec"><tr><th>Operation</th><th>Days</th><th class="n">Covered</th><th class="n">Overlap</th></tr>
      ${recs.map(r => `<tr><td><b><i class="wk ${r.kind}"></i>${esc(r.title)}</b><br><span class="note">${esc(recordValues(r))}</span></td><td>${dayTxt(r.firstDay)}${r.lastDay !== r.firstDay && dayTxt(r.lastDay) ? ' – ' + dayTxt(r.lastDay) : ''}</td>
        <td class="n">${area(r.coveredHa)}</td><td class="n">${area(r.overlapHa)}</td></tr>`).join('')}</table>`
      : '<p class="empty">No work recorded in this field yet.</p>'}`);
  $('fieldRename').onclick = async () => {
    const name = prompt('Field name', f.name);
    if (!name) return;
    try { await api('/api/ops/rename', { fieldId: f.id, name }); refresh(); } catch (e) { toast(e.message); }
  };
  $('addBnd').onclick = () => { $('addBndMenu').hidden = !$('addBndMenu').hidden; };
  $('addBndMenu').onclick = async e => {
    const btn = e.target.closest('[data-ab]'); if (!btn) return;
    $('addBndMenu').hidden = true;
    if (btn.dataset.ab === 'draw') return startDraw(f.id);
    if (btn.dataset.ab === 'drive') return toast('On the G5 display: Menu > Applications > Boundary, choose this field, then drive the edge.', 5000);
    try {
      const r = await api('/api/ops/from-coverage', { fieldId: f.id });
      if (!r.proposal) return toast('No recorded coverage around this field.');
      S.proposal = r.proposal; renderField(); fitField();
    } catch (err) { toast(err.message); }
  };
  if ($('propSave')) $('propSave').onclick = async () => {
    try { await api('/api/ops/boundary', { fieldId: f.id, source: 'coverage', polygon: S.proposal.polygon, note: 'From a previous operation' }); S.proposal = null; toast('Boundary saved.'); refresh(); }
    catch (e) { toast(e.message); }
  };
  if ($('propDrop')) $('propDrop').onclick = () => { S.proposal = null; renderField(); };
  $('fieldDetail').querySelectorAll('[data-use]').forEach(x => { x.onclick = async () => {
    try { await api('/api/ops/active', { fieldId: f.id, v: +x.dataset.use }); refresh(); } catch (e) { toast(e.message); } }; });
  $('fieldDetail').querySelectorAll('[data-remove]').forEach(x => { x.onclick = async () => {
    if (!confirm(`Delete boundary ${x.dataset.remove} of ${f.name}?`)) return;
    try { await api('/api/ops/remove-boundary', { fieldId: f.id, v: +x.dataset.remove }); refresh(); } catch (e) { toast(e.message); } }; });
}
$('fieldBack').onclick = () => showPage('land');

// layer controls (field page) and legends
function renderLayerControls() {
  const onField = S.page === 'field' && S.detail;
  const ops = onField ? [...new Set(S.detail.records.map(r => r.op))] : [];
  $('mapLayer').hidden = !ops.length;
  if (ops.length) {
    if (!ops.includes(S.layerOp)) S.layerOp = ops[0];
    setHtml($('layerOp'), ops.map(id => `<option value="${esc(id)}" ${id === S.layerOp ? 'selected' : ''}>${esc(opMeta(id).title || id)}</option>`).join(''));
    const keys = ['coverage'].concat((opMeta().values || []).filter(k => LAYERS[k]));
    if (!keys.includes(S.layerKey)) S.layerKey = 'coverage';
    setHtml($('layerKey'), keys.map(k => `<option value="${k}" ${k === S.layerKey ? 'selected' : ''}>${k === 'rate' ? rateLabel() : LAYERS[k].label}</option>`).join(''));
  }
  renderLegend();
}
$('layerOp').onchange = e => { S.layerOp = e.target.value; rangeCache = null; renderLayerControls(); syncFrames(); };
$('layerKey').onchange = e => { S.layerKey = e.target.value; rangeCache = null; renderLegend(); };
function renderLegend() {
  const onField = S.page === 'field' && S.detail;
  if (!onField) {
    $('mapLegend').hidden = !(S.summary && S.summary.fields.length);
    setHtml($('mapLegend'), `<b>Fields</b><em>Last Work Type</em>${Object.entries(KIND).map(([k, l]) => `<span class="lg"><i style="background:${KIND_COLOR[k]}"></i>${l}</span>`).join('')}<span class="lg"><i style="background:transparent"></i>None</span>`);
    return;
  }
  $('mapLegend').hidden = false;
  if (!S.framesOp) { setHtml($('mapLegend'), '<b>Field</b><span class="lg"><i class="sq" style="background:#d63cc7"></i>Active Boundary</span>'); return; }
  if (S.layerKey === 'coverage') {
    setHtml($('mapLegend'), '<b>Coverage</b><span class="lg"><i class="sq" style="background:#4a7fd6"></i>Once</span><span class="lg"><i class="sq" style="background:#16307f"></i>Overlap</span><span class="lg"><i class="sq" style="background:#d63cc7"></i>Active Boundary</span>');
    return;
  }
  const L = LAYERS[S.layerKey], r = layerRange();
  const label = S.layerKey === 'rate' ? rateLabel() : L.label, unit = S.layerKey === 'rate' ? rateUnit() : L.unit();
  if (!r) { setHtml($('mapLegend'), `<b>${label}</b>No data`); return; }
  let rows = '';
  for (let i = r.n - 1; i >= 0; i--) {
    const a = r.lo + i * r.step, d = r.step < 1 ? (r.step < 0.1 ? 2 : 1) : 0;
    rows += `<span class="lg"><i class="sq" style="background:${colorIdx(i, r.n, L.good)}"></i>${fmt(a, d)}–${fmt(a + r.step, d)}</span>`;
  }
  setHtml($('mapLegend'), `<b>${label}</b><em>${esc(unit)}</em>${rows}`);
}

// Work Analyzer: records across fields
async function loadWork() {
  try { const r = await api('/api/ops/records'); S.work = r.records; renderWork(); } catch (e) { /* offline */ }
}
function renderWork() {
  setHtml($('workChips'), Object.entries(KIND).map(([k, l]) =>
    `<button class="chip ${S.workKind === k ? 'on' : ''}" data-kind="${k}"><i style="background:${KIND_COLOR[k]}"></i>${l}</button>`).join(''));
  const recs = (S.work || []).filter(r => !S.workKind || r.kind === S.workKind);
  const prop = S.proposal && S.proposal.newField ? `<div class="proposal" style="margin:8px 14px">New field from a previous operation: ${area(S.proposal.areaHa)}
      <div class="acts"><button class="btn primary" id="newSave">Save as New Field</button><button class="btn" id="newDrop">Discard</button></div></div>` : '';
  setHtml($('workList'), prop + (recs.length ? recs.map(r => `
    <div class="row" ${r.field ? `data-field="${esc(r.field)}"` : ''}><i class="wk ${r.kind}"></i>
      <div class="nm"><b>${esc(r.title)}</b><span>${esc(r.fieldName)}${dayTxt(r.firstDay) ? ' · ' + dayTxt(r.firstDay) : ''}${r.lastDay !== r.firstDay && dayTxt(r.lastDay) ? ' – ' + dayTxt(r.lastDay) : ''}</span>
        <span>${esc(recordValues(r))}</span>${r.field ? '' : '<span><button class="linkbtn" data-pick="1">Create a field from this coverage</button></span>'}</div>
      <span class="num">${r.field ? area(r.coveredHa) : area(r.swathHa)}</span><span class="chev">${r.field ? '›' : ''}</span></div>`).join('')
    : '<p class="empty">No work recorded in this savegame yet.</p>'));
  if ($('newSave')) $('newSave').onclick = async () => {
    const name = prompt('Name for the new field', 'New Field');
    if (!name) return;
    try { const r = await api('/api/ops/boundary', { name, newField: true, source: 'coverage', polygon: S.proposal.polygon, note: 'From a previous operation' }); S.proposal = null; toast('Field created.'); await refresh(); openField(r.field); }
    catch (e) { toast(e.message); }
  };
  if ($('newDrop')) $('newDrop').onclick = () => { S.proposal = null; renderWork(); };
}
$('workChips').onclick = e => { const b = e.target.closest('[data-kind]'); if (b) { S.workKind = S.workKind === b.dataset.kind ? null : b.dataset.kind; renderWork(); } };
$('workList').onclick = e => {
  if (e.target.closest('[data-pick]')) { S.pick = true; $('mapHint').hidden = false; $('mapHint').textContent = 'Tap the recorded coverage of the new field'; return; }
  const r = e.target.closest('[data-field]');
  if (r) openField(r.dataset.field);
};

// Equipment
function equipmentRows(list) {
  const sm = S.summary;
  const fieldName = id => { const f = sm.fields.find(x => String(x.id) === String(id)); return f ? f.name : id ? `Field ${id}` : null; };
  return list.length ? `<div class="group"><span>Machines (${list.length})</span><span>Fuel</span></div>` + list.map(e => `
    <div class="row" data-eq="${esc(e.id)}"><span>${e.kind === 'combine' ? '🌾' : e.kind === 'truck' ? '🚚' : e.kind === 'sprayer' ? '💧' : '🚜'}</span>
      <div class="nm"><b>${esc(e.name)}<span class="badge ${e.inUse ? 'inuse' : e.ai ? 'ai' : 'parked'}">${e.inUse ? 'In use' : e.ai ? 'AI worker' : e.motorOn ? 'Running' : 'Parked'}</span></b>
        <span>${fieldName(e.field) ? esc(fieldName(e.field)) + ' · ' : ''}${typeof e.hours === 'number' ? fmt(e.hours, 1) + ' h' : ''}${typeof e.damage === 'number' ? ` · condition ${fmt(100 - e.damage, 0)} %` : ''}${e.speed > 0.5 ? ` · ${fmt(U.speed(e.speed), 1)} ${U.speedUnit()}` : ''}${e.implements && e.implements.length ? ' · ' + esc(e.implements.join(', ')) : ''}</span></div>
      <span class="num">${typeof e.fuelPct === 'number' ? fmt(e.fuelPct, 0) + ' %' : ''}</span><span class="chev">›</span></div>`).join('')
    : '<p class="empty">No machines reported yet.</p>';
}
function renderEquipment() { if (S.summary) setHtml($('equipList'), equipmentRows(S.summary.equipment || [])); }
function focusMachine(id) {
  const m = (S.summary.equipment || []).find(x => x.id === id);
  if (m) { V.cx = m.x; V.cz = m.z; V.ppm = Math.max(V.ppm, 1.2); }
}
$('equipList').onclick = e => { const q = e.target.closest('[data-eq]'); if (q) focusMachine(q.dataset.eq); };

// Settings
function renderSettings() {
  const sm = S.summary;
  if (!sm || (document.activeElement && document.activeElement.id === 'clientName')) return;
  const imp = !(sm.settings && sm.settings.importGame === false);
  setHtml($('settingsBody'), `
    <div class="set-row"><div><b>Import field boundaries from the game map</b>
      <p>On: every map field is there right away. Off: a field exists only once its edge is driven, drawn, or traced from coverage.
      For this savegame (${esc(sm.save)}).</p></div>
      <div class="switch" data-set="importGame"><button data-v="1" class="${imp ? 'on' : ''}">On</button><button data-v="0" class="${imp ? '' : 'on'}">Off</button></div></div>
    <div class="set-row"><div><b>Client name</b><p>Top of the Client > Farm > Field tree. The farm name comes from the game.</p></div>
      <input id="clientName" value="${esc(clientName())}" maxlength="60"></div>
    <div class="set-row"><div><b>Units</b><p>Shared with the G5 display on this device. Per-unit settings are on the display (Menu > System > Unit Settings).</p></div>
      <div class="switch" data-units="1"><button data-v="metric" class="${unitPreset() === 'metric' ? 'on' : ''}">Metric</button><button data-v="imperial" class="${unitPreset() === 'imperial' ? 'on' : ''}">US</button></div></div>`);
}
$('settingsBody').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.closest('[data-set]')) {
    try { await api('/api/ops/settings', { importGame: b.dataset.v === '1' }); refresh(); } catch (err) { toast(err.message); }
  } else if (b.closest('[data-units]')) {
    UNIT_KINDS.forEach(([k]) => { settings.units[k] = b.dataset.v; }); saveSettings(); rangeCache = null; renderAll(false);
  }
};
$('settingsBody').addEventListener('change', async e => {
  if (e.target.id !== 'clientName') return;
  try { await api('/api/ops/settings', { client: e.target.value }); e.target.blur(); refresh(); } catch (err) { toast(err.message); }
});

// the display in the same browser may change units
window.addEventListener('storage', ev => {
  if (ev.key !== 'g5link') return;
  try { Object.assign(settings, JSON.parse(ev.newValue || '{}')); } catch (e) { return; }
  rangeCache = null; renderAll(false);
});
document.addEventListener('click', e => {
  if (!e.target.closest('.add-wrap')) document.querySelectorAll('.menu').forEach(m => { m.hidden = true; });
});

refresh();
setInterval(refresh, 3000);
requestAnimationFrame(draw);

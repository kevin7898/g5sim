'use strict';
// G5Link Operations Center: Map (fields by last work type, equipment), Land (Client > Farm > Field),
// field pages with versioned boundaries (game map, driven, drawn, from coverage), Work Analyzer and
// Equipment. Data from the bridge (/api/ops/*, /api/map/*). Layout follows the real Operations Center.

const $ = id => document.getElementById(id);
function setHtml(el, html) { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } }
const S = { summary: null, version: -1, page: 'map', mapSub: 'fields', search: '', workKind: null, field: null, detail: null,
  proposal: null, coverageEdit: null, pick: false, draw: null, layerOp: null, layerKey: 'coverage', frames: [], framesOp: null, framesSeq: 0,
  overlap: null, work: [], mapsKey: '', profit: null, profitField: null, profitSub: 'pl', serviceSub: 'summary' };

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
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
if (window.ResizeObserver) new ResizeObserver(requestDraw).observe(canvas);
else window.addEventListener('resize', requestDraw);
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
  requestDraw();
}
function fitAll() {
  const sm = S.summary;
  if (!sm) return;
  const polys = sm.fields.map(f => f.polygon);
  for (const e of sm.equipment || []) polys.push([[e.x - 40, e.z - 40], [e.x + 40, e.z + 40]]);
  fitTo(polys);
}
function activeBoundary() {
  if (S.page === 'profit') {
    const f = S.profitField && S.summary && S.summary.fields.find(x => x.id === S.profitField);
    return f ? { polygon: f.polygon } : null;
  }
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
  applied: { label: 'Applied Coverage' },
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
// Profit Map: harvested swaths colored by their own profit per area (yield x price - field costs per area).
const money = (v, d = 0) => typeof v === 'number' ? `${v < 0 ? '−' : ''}${(S.profit && S.profit.currency) || '$'}${fmt(Math.abs(v), d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : '---';
const perArea = v => typeof v === 'number' ? (metric('area') ? v : v / 2.47105) : null;          // per ha -> per ac
const areaU = () => metric('area') ? 'ha' : 'ac';
const profitRow = () => S.profit && S.profitField ? S.profit.fields.find(x => x.field === S.profitField) : null;
function profitOf(f) {
  const r = profitRow(), y = f.v && f.v.yield;
  if (!r || typeof y !== 'number' || r.pricePerT === null) return null;
  return perArea(y * r.pricePerT - r.expensesPerHa);
}
let profitRangeCache = null;
function profitRange() {
  const key = S.frames.length + '|' + S.profitField + '|' + JSON.stringify(settings.units) + '|' + JSON.stringify(profitRow());
  if (profitRangeCache && profitRangeCache.key === key) return profitRangeCache.r;
  let lo = Infinity, hi = -Infinity;
  const bb = fieldBox(0);
  for (const f of S.frames) { if (bb && !inBox(f, bb)) continue; const v = profitOf(f); if (v === null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  let r = null;
  if (lo <= hi) {
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / 10, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p, start = Math.floor(lo / step) * step;
    r = { lo: start, step, n: Math.min(10, Math.max(1, Math.ceil((hi - start) / step))) };
  }
  profitRangeCache = { key, r };
  return r;
}
function frameColor(f, range) {
  if (S.page === 'profit') {
    const v = profitOf(f);
    if (v === null || !range) return null;
    return colorIdx(Math.max(0, Math.min(range.n - 1, Math.floor((v - range.lo) / range.step))), range.n, 'high');
  }
  if (S.layerKey === 'coverage') return '#4a7fd6';
  if (S.layerKey === 'applied') return f.application ? '#44a17c' : null;
  const L = LAYERS[S.layerKey], v = f.v && f.v[S.layerKey];
  if (typeof v !== 'number' || !range) return null;
  const x = L.conv ? L.conv(v) : v;
  return colorIdx(Math.max(0, Math.min(range.n - 1, Math.floor((x - range.lo) / range.step))), range.n, L.good);
}

const coverageCanvas = document.createElement('canvas');
const coverageCtx = coverageCanvas.getContext('2d');
const SWATH_BATCH = 512;
const MAX_COVERAGE_SIDE = 3072;
const MAX_COVERAGE_PIXELS = 6000000;
let coverageLayer = null;

function buildCoverageLayer(bb, profit, style) {
  const colors = new Map();
  const range = profit ? profitRange() : ['coverage', 'applied'].includes(S.layerKey) ? null : layerRange();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const f of S.frames) {
    if ((!profit && S.layerKey === 'applied' && !f.application) || (bb && !inBox(f, bb))) continue;
    const color = frameColor(f, range) || '#4a7fd6';
    let quads = colors.get(color);
    if (!quads) { quads = []; colors.set(color, quads); }
    for (const q of f.q) {
      quads.push(q);
      for (let i = 0; i < 8; i += 2) {
        minX = Math.min(minX, q[i]); maxX = Math.max(maxX, q[i]);
        minZ = Math.min(minZ, q[i + 1]); maxZ = Math.max(maxZ, q[i + 1]);
      }
    }
  }
  return { frames: S.frames, style, colors, minX, minZ, maxX, maxZ, image: null };
}

function paintCoverageImage(layer, width, height, scale, x, y) {
  if (coverageCanvas.width !== width || coverageCanvas.height !== height) {
    coverageCanvas.width = width;
    coverageCanvas.height = height;
  } else coverageCtx.clearRect(0, 0, width, height);
  coverageCtx.lineWidth = 1;
  for (const [color, quads] of layer.colors) {
    coverageCtx.fillStyle = coverageCtx.strokeStyle = color;
    for (let base = 0; base < quads.length; base += SWATH_BATCH) {
      coverageCtx.beginPath();
      const end = Math.min(base + SWATH_BATCH, quads.length);
      for (let k = base; k < end; k++) {
        const q = quads[k];
        coverageCtx.moveTo(x + q[0] * scale, y + q[1] * scale);
        for (let i = 2; i < 8; i += 2) coverageCtx.lineTo(x + q[i] * scale, y + q[i + 1] * scale);
        coverageCtx.closePath();
      }
      coverageCtx.fill();
      coverageCtx.stroke();
    }
  }
}

function drawCoverage(s) {
  const bb = fieldBox(), profit = S.page === 'profit';
  const style = JSON.stringify([S.framesSeq, S.frames.length, S.page, S.layerKey, bb, settings.units, profit ? profitRow() : null]);
  if (coverageLayer?.frames !== S.frames || coverageLayer.style !== style) coverageLayer = buildCoverageLayer(bb, profit, style);
  const layer = coverageLayer;
  if (!layer.colors.size) return;
  const scale = V.ppm * s.dpr;
  const widthM = Math.max(1, layer.maxX - layer.minX), heightM = Math.max(1, layer.maxZ - layer.minZ);
  const padding = 2;
  const maxScale = Math.min((MAX_COVERAGE_SIDE - padding * 2) / Math.max(widthM, heightM),
    Math.sqrt(MAX_COVERAGE_PIXELS / (widthM * heightM)));
  const whole = scale <= maxScale;
  const camera = whole ? 'whole' : [s.w, s.h, scale, V.cx, V.cz].join('|');
  if (layer.image?.camera !== camera || whole && layer.image.scale < scale) {
    if (whole) {
      // Cache the complete field in world coordinates, with extra resolution
      // so the usual pan and zoom gestures can reuse the painted layer.
      const resolution = Math.min(maxScale, scale * 2.5);
      paintCoverageImage(layer, Math.ceil(widthM * resolution) + padding * 2, Math.ceil(heightM * resolution) + padding * 2,
        resolution, padding - layer.minX * resolution, padding - layer.minZ * resolution);
      layer.image = { camera, scale: resolution };
    } else {
      // At close zoom keep full precision without allocating a huge bitmap.
      paintCoverageImage(layer, s.w, s.h, scale, s.w / 2 - V.cx * scale, s.h / 2 - V.cz * scale);
      layer.image = { camera, scale };
    }
  }
  ctx.globalAlpha = 0.92;
  if (whole) {
    const [x, y] = toScreen(layer.minX, layer.minZ, s), zoom = scale / layer.image.scale;
    ctx.drawImage(coverageCanvas, x - padding * zoom, y - padding * zoom, coverageCanvas.width * zoom, coverageCanvas.height * zoom);
  } else ctx.drawImage(coverageCanvas, 0, 0);
  ctx.globalAlpha = 1;
}

function draw() {
  const s = size();
  if (!s.w || !s.h) return;
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

  const onField = (S.page === 'field' && S.detail) || (S.page === 'profit' && S.profitField);
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
    drawCoverage(s);
    if (S.page !== 'profit' && S.layerKey === 'coverage' && S.overlap) {
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
    // guidance tracks of the field (A point and heading; north = -z), drawn long and clipped by the view
    const trs = S.page === 'field' && S.detail && S.detail.tracks || [];
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * s.dpr; ctx.setLineDash([10 * s.dpr, 6 * s.dpr]);
    for (const t of trs) {
      const hr = t.h * Math.PI / 180, fx = Math.sin(hr), fz = -Math.cos(hr);
      const [ax, ay] = toScreen(t.ax - fx * 3000, t.az - fz * 3000, s), [bx, by] = toScreen(t.ax + fx * 3000, t.az + fz * 3000, s);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);
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
    for (const [a, b] of S.proposal.problemSegments || []) {
      ctx.beginPath(); ctx.moveTo(...toScreen(...a, s)); ctx.lineTo(...toScreen(...b, s)); ctx.strokeStyle = '#f04a30'; ctx.stroke();
    }
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

  drawRx(s);

  // RTK base stations with their radio range
  for (const b of (S.rtk && S.rtk.bases) || []) {
    const [px, py] = toScreen(b.x, b.z, s), rr = (S.rtk.baseRange || 3000) * V.ppm * s.dpr;
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fillStyle = b.state === 'ok' ? 'rgba(29, 111, 184, .07)' : 'rgba(242, 169, 0, .07)'; ctx.fill();
    ctx.setLineDash([10 * s.dpr, 8 * s.dpr]); ctx.strokeStyle = b.state === 'ok' ? '#1d6fb8' : '#f2a900'; ctx.lineWidth = 2 * s.dpr; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(px, py - 11 * s.dpr); ctx.lineTo(px + 8 * s.dpr, py + 7 * s.dpr); ctx.lineTo(px - 8 * s.dpr, py + 7 * s.dpr); ctx.closePath();
    ctx.fillStyle = b.state === 'ok' ? '#1d6fb8' : '#f2a900'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s.dpr; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${12 * s.dpr}px Noto Sans, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(b.name, px, py + 22 * s.dpr);
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
    requestDraw();
    drag.moved = true; return;
  }
  const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (drag.moved) { V.cx = drag.cx - dx / V.ppm; V.cz = drag.cz - dy / V.ppm; requestDraw(); }
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
  requestDraw();
}, { passive: false });
$('zoomIn').onclick = () => { V.ppm = Math.min(20, V.ppm * 1.4); requestDraw(); };
$('zoomOut').onclick = () => { V.ppm = Math.max(0.05, V.ppm / 1.4); requestDraw(); };
$('zoomFit').onclick = () => { if (S.page === 'field' && S.detail) fitField(); else fitAll(); };
$('locate').onclick = () => {
  const m = (S.summary && S.summary.equipment || []).find(e => e.inUse) || (S.summary && S.summary.here);
  if (m) { V.cx = m.x; V.cz = m.z; V.ppm = Math.max(V.ppm, 1.2); requestDraw(); } else toast('No machine in use.');
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
    const operation = S.pick.operation;
    S.pick = false; $('mapHint').hidden = true;
    showPage('analyze');
    beginCoverageReview({ x, z }, operation);
    await previewCoverage();
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
  requestDraw();
  if (!S.draw) return;
  const p = S.draw.points, n = p.length;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  $('drawInfo').textContent = n < 3 ? `Tap the corners of the field (${n} so far)` : `${n} points · ${area(Math.abs(a) / 2 / 10000)}`;
  $('drawDone').disabled = n < 3; $('drawUndo').disabled = !n;
}
function endDraw() { S.draw = null; $('mapDraw').hidden = true; document.querySelector('.mapwrap').classList.remove('drawing'); requestDraw(); }
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
    if (S.summary && S.summary.save !== sm.save) {
      S.framesOp = null; S.frames = []; S.framesSeq = 0; S.overlap = null;
      S.proposal = null; S.coverageEdit = null; S.work = []; S.workJobs = [];
      if (S.page === 'field') showPage('land');
    }
    S.summary = sm;
    if (typeof checkDisplayRevision === 'function') checkDisplayRevision(sm.displayRevision);
    $('saveName').textContent = sm.save === 'unsaved' ? 'Unsaved game' : `Savegame: ${sm.save}`;
    $('orgName').textContent = `${clientName()} · ${farmName()}`;
    $('linkState').textContent = sm.link === 'live' ? 'Live' : sm.link === 'stale' ? 'Game paused' : 'Waiting for game';
    $('linkState').className = 'link ' + (sm.link === 'live' ? 'live' : 'down');
    if (first || (!V.fitted && sm.fields.length)) { fitAll(); V.fitted = sm.fields.length > 0; }
    if (sm.version !== S.version) { S.version = sm.version; if (S.field) loadField(S.field, false); }
    const key = maps().map(m => m.id + ':' + m.seq).join('|');
    if (S.page === 'profit') await loadProfit(false);
    if (S.page === 'analyze' && key !== S.mapsKey) loadWork();
    renderAll(key !== S.mapsKey);
    S.mapsKey = key;
    syncFrames();
  } catch (e) {
    $('linkState').textContent = 'Bridge offline'; $('linkState').className = 'link down';
  }
}
async function syncFrames() {
  const op = S.page === 'field' ? S.layerOp : S.page === 'profit' ? S.profitOp : null;
  if (!op) return;
  const save = S.summary?.save;
  if (op !== S.framesOp) { S.frames = []; S.framesSeq = 0; S.framesOp = op; S.overlap = null; rangeCache = null; }
  const meta = opMeta(op);
  if (syncFrames.busy || (meta.seq !== undefined && meta.seq <= S.framesSeq && S.overlap && S.overlap.version === meta.overlapVersion)) return;
  syncFrames.busy = true;
  try {
    for (let guard = 0; guard < 50; guard++) {
      const r = await api(`/api/map/frames?op=${encodeURIComponent(op)}&since=${S.framesSeq}`);
      if (S.framesOp !== op || S.summary?.save !== save || r.save !== undefined && r.save !== save) return;
      for (const f of r.frames) S.frames.push(f);
      S.framesSeq = r.frames.length ? r.frames[r.frames.length - 1].s : r.seq;
      if (!r.more) break;
    }
    const overlap = await api(`/api/map/overlap?op=${encodeURIComponent(op)}`);
    if (S.framesOp !== op || S.summary?.save !== save) return;
    S.overlap = overlap;
    renderLegend();
  } catch (e) { /* retried */ } finally { syncFrames.busy = false; }
}

// ---------------------------------------------------------------- pages
function showPage(page) {
  S.page = page;
  document.querySelectorAll('#nav [data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === (page === 'field' ? 'land' : page)));
  ['map', 'land', 'field', 'analyze', 'profit', 'service', 'rtk', 'equipment', 'settings'].forEach(v => { $('view-' + v).hidden = v !== page; });
  if (page === 'rtk') loadRtk();
  if (page !== 'profit') S.profitField = null;
  if (page === 'profit') loadProfit();
  if (page !== 'field') { S.field = null; S.detail = null; S.framesOp = null; if (!(S.proposal && S.proposal.newField)) S.proposal = null; }
  if (!['field', 'analyze'].includes(page) || page === 'analyze' && S.coverageEdit?.context.fieldId) { S.coverageEdit = null; S.proposal = null; }
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
  if (S.page === 'profit') renderProfit();
  if (S.page === 'service') renderService();
  if (S.page === 'rtk') renderRtk();
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
  else if (b.dataset.add === 'coverage') { S.pick = {}; $('mapHint').hidden = false; $('mapHint').textContent = 'Tap the recorded coverage of the new field'; }
  else toast('On the G5 display: Menu > Applications > Boundary, choose New Field, then drive the edge.', 5000);
};

// Field page
async function openField(id) {
  S.proposal = null;
  S.coverageEdit = null;
  showPage('field');
  S.field = String(id);
  await loadField(id, true);
}
async function loadField(id, fit) {
  try {
    const d = await api(`/api/ops/field?id=${encodeURIComponent(id)}`);
    const tr = await api(`/api/ops/tracks?field=${encodeURIComponent(id)}`);
    const rxr = await api(`/api/ops/rx?field=${encodeURIComponent(id)}`).catch(() => ({ prescriptions: [], active: null }));
    if (S.field !== String(id)) return;
    d.tracks = tr.tracks || [];
    d.rx = rxr.prescriptions || []; d.rxActive = rxr.active;
    if (!d.rx.some(r => r.id === S.rxShow)) S.rxShow = d.rxActive || (d.rx[0] && d.rx[0].id) || null;
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
// ---------------------------------------------------------------- Prescriptions (variable rate) on the Field page
const RX_COLORS = ['#c9e6b5', '#8cc56a', '#4f9a35', '#2c6e1f', '#174a10'];
const layerName = k => ({ yield: 'Yield', moisture: 'Moisture', loss: 'Grain Loss', rate: 'Applied Rate', soilN: 'Soil Nitrogen', soilP: 'Soil Phosphorus',
  soilK: 'Soil Potassium', soilPH: 'Soil pH', compaction: 'Compaction', soilMoisture: 'Soil Moisture', yieldPotential: 'Yield Potential',
  singulation: 'Singulation', tillDepth: 'Tillage Depth' }[k] || k);
function rxLayers(opId) {
  const op = S.summary && (S.summary.maps || []).find(o => o.id === opId);
  return ((op && op.values) || []).filter(k => !['speed', 'seedLph'].includes(k));
}
function rxSection(d, recs) {
  const ops = [...new Set(recs.map(r => r.op))];
  const list = (d.rx || []).map(r => `<div class="rx ${r.id === d.rxActive ? 'active' : ''} ${r.id === S.rxShow ? 'shown' : ''}" data-rx="${esc(r.id)}">
      <div class="rx-head"><b>${esc(r.name)}</b><span class="sub">${esc(layerName(r.layer))} · ${r.zones} zones · ${r.cell} m cells</span>
        ${r.id === d.rxActive ? '<span class="state">In use</span>' : `<button class="mini" data-rx-use="${esc(r.id)}">Use on machines</button>`}</div>
      <div class="rx-zones">${r.rates.map((rate, z) => `<label><i style="background:${RX_COLORS[Math.round(z * 4 / Math.max(1, r.zones - 1))]}"></i>
        <span>${z === 0 ? 'Low' : z === r.zones - 1 ? 'High' : 'Zone ' + (z + 1)}<small>${fmt(z === 0 ? r.range[0] : r.breaks[z - 1], 1)}+</small></span>
        <input type="number" min="0" max="5" step="0.05" value="${rate}" data-rx-rate="${esc(r.id)}" data-z="${z}">×</label>`).join('')}</div>
      <div class="rx-acts"><button class="mini" data-rx-show="${esc(r.id)}">Show on map</button>${r.id === d.rxActive ? `<button class="mini" data-rx-stop="1">Stop using</button>` : ''}<button class="mini" data-rx-del="${esc(r.id)}">Delete</button></div></div>`).join('');
  const opOpts = ops.map(o => { const rec = recs.find(r => r.op === o); return `<option value="${esc(o)}">${esc(rec ? rec.title : o)}</option>`; }).join('');
  const first = ops[0], layers = first ? rxLayers(first) : [];
  return `${list || '<p class="note">No prescriptions for this field.</p>'}
    ${ops.length ? `<div class="rx-new" id="rxNew"><b>New prescription from a recorded layer</b>
      <div class="rx-form"><select id="rxOp">${opOpts}</select><select id="rxLayer">${layers.map(k => `<option value="${k}">${esc(layerName(k))}</option>`).join('')}</select>
      <select id="rxZones"><option value="3">3 zones</option><option value="4">4 zones</option><option value="5">5 zones</option></select>
      <select id="rxCell"><option value="10">10 m cells</option><option value="20">20 m cells</option></select>
      <button class="btn primary" id="rxCreate">Create</button></div>
      <p class="note">Rates are multipliers of the machine's set rate. The one in use is applied by sprayers and spreaders through Precision Farming or Realistic Soil &amp; Fertilizer, whichever you play with. Soil layers start with more where the soil is low; yield layers with more where yield is high.</p></div>` : ''}`;
}
function bindRx(d) {
  const body = $('fieldDetail');
  const rxApi = async (b) => { try { const r = await api('/api/ops/rx', b); await loadField(S.field); return r; } catch (e) { toast(e.message); } };
  const op = $('rxOp');
  if (op) op.onchange = () => { $('rxLayer').innerHTML = rxLayers(op.value).map(k => `<option value="${k}">${esc(layerName(k))}</option>`).join(''); };
  if ($('rxCreate')) $('rxCreate').onclick = async () => {
    if (!$('rxLayer').value) return toast('That operation has no layer to build zones from.');
    const r = await rxApi({ action: 'create', fieldId: d.field.id, opId: $('rxOp').value, layer: $('rxLayer').value, zones: +$('rxZones').value, cell: +$('rxCell').value,
      name: `${layerName($('rxLayer').value)} zones` });
    if (r && r.rx) { S.rxShow = r.rx.id; toast('Prescription created.'); }
  };
  body.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rxUse) { await rxApi({ action: 'activate', id: b.dataset.rxUse }); toast('In use: machines apply it while spraying or spreading.'); }
    else if (b.dataset.rxStop) await rxApi({ action: 'activate', id: null });
    else if (b.dataset.rxDel) { if (window.confirm('Delete this prescription?')) await rxApi({ action: 'delete', id: b.dataset.rxDel }); }
    else if (b.dataset.rxShow) { S.rxShow = b.dataset.rxShow; renderField(); }
  };
  body.onchange = async e => {
    const inp = e.target.closest('[data-rx-rate]'); if (!inp) return;
    const rx = d.rx.find(r => r.id === inp.dataset.rxRate); if (!rx) return;
    const rates = [...body.querySelectorAll(`[data-rx-rate="${CSS.escape(rx.id)}"]`)].map(i => Number(i.value));
    if (rates.some(v => !(v >= 0 && v <= 5))) return toast('Rates are multipliers from 0 to 5.');
    await rxApi({ action: 'update', id: rx.id, changes: { rates } });
  };
}
// zones of the shown prescription on the map
function drawRx(s) {
  const d = S.detail;
  if (S.page !== 'field' || !d || !d.rx) return;
  const rx = d.rx.find(r => r.id === S.rxShow);
  if (!rx) return;
  ctx.globalAlpha = 0.55;
  for (let r = 0; r < rx.rows; r++) for (let c = 0; c < rx.cols; c++) {
    const z = rx.grid[r * rx.cols + c];
    if (z < 0) continue;
    const [x0, y0] = toScreen(rx.ox + c * rx.cell, rx.oz + r * rx.cell, s), [x1, y1] = toScreen(rx.ox + (c + 1) * rx.cell, rx.oz + (r + 1) * rx.cell, s);
    ctx.fillStyle = RX_COLORS[Math.round(z * 4 / Math.max(1, rx.zones - 1))];
    ctx.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- Field report (print / PDF, CSV)
function openReport(d) {
  const f = d.field, b = f.boundaries.find(x => x.v === f.active), recs = d.records;
  const rows = recs.map(r => [r.title, dayTxt(r.firstDay) + (r.lastDay !== r.firstDay && dayTxt(r.lastDay) ? ' – ' + dayTxt(r.lastDay) : ''),
    area(r.coveredHa), area(r.overlapHa), recordValues(r)]);
  const csv = [['Operation', 'Days', 'Covered', 'Overlap', 'Values'], ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)} - Field Report</title>
    <style>body{font:14px 'Noto Sans',system-ui,sans-serif;color:#1f1f1d;margin:28px}h1{font-size:24px;margin:0}h2{font-size:17px;margin:22px 0 6px;color:#367c2b}
    .sub{color:#64635a}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dcdad2;padding:6px 8px;text-align:left;vertical-align:top}
    th{font-size:13px;color:#64635a}.bar{display:flex;gap:10px;margin:14px 0}.bar a,.bar button{font:inherit;font-weight:700;color:#367c2b;border:1px solid #367c2b;background:#fff;border-radius:4px;padding:6px 12px;text-decoration:none;cursor:pointer}
    @media print{.bar{display:none}body{margin:0}}</style></head><body>
    <h1>${esc(f.name)}</h1><div class="sub">${esc(clientName())} · ${esc(owned(f) ? farmName() : 'Not owned')} · ${b ? area(b.areaHa) : '---'}${f.farmland ? ' · Farmland ' + f.farmland : ''}</div>
    <div class="bar"><button onclick="print()">Print / Save as PDF</button><a download="${esc(f.name)}-records.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}">Download CSV</a></div>
    <h2>Work Records</h2>${rows.length ? `<table><tr><th>Operation</th><th>Days</th><th>Covered</th><th>Overlap</th><th>Values</th></tr>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="sub">No work recorded.</p>'}
    <h2>Prescriptions</h2>${(d.rx || []).length ? `<table><tr><th>Name</th><th>Layer</th><th>Zone rates</th><th>In use</th></tr>${d.rx.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(layerName(r.layer))}</td><td>${r.rates.map(x => x + '×').join(', ')}</td><td>${r.id === d.rxActive ? 'Yes' : ''}</td></tr>`).join('')}</table>` : '<p class="sub">None.</p>'}
    <h2>Guidance Tracks</h2>${(d.tracks || []).length ? `<table><tr><th>Name</th><th>Type</th><th>Heading</th></tr>${d.tracks.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.how)}</td><td>${fmt(t.h, 1)}°</td></tr>`).join('')}</table>` : '<p class="sub">None.</p>'}
    <p class="sub" style="margin-top:24px">G5Link Operations Center · ${new Date().toLocaleDateString()}</p></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to open the report.');
  w.document.write(html); w.document.close();
}

function beginCoverageReview(context, operation = null) {
  S.proposal = null;
  S.coverageEdit = { context, save: S.summary?.save, operation: operation || maps().find(m => m.frames > 0)?.id || '', coverageClass: 'worked', pending: false };
  repaintCoverage();
}

function repaintCoverage() {
  requestDraw();
  if (S.page === 'field') renderField();
  if (S.page === 'analyze') renderWork();
}

async function previewCoverage() {
  const edit = S.coverageEdit;
  if (!edit?.operation || edit.pending) return;
  S.proposal = null;
  edit.pending = true;
  repaintCoverage();
  try {
    const r = await api('/api/ops/from-coverage', { ...edit.context, operation: edit.operation, coverageClass: edit.coverageClass });
    if (edit !== S.coverageEdit || edit.save !== S.summary?.save) return;
    if (!r.proposal) { edit.message = 'This operation has no coverage at the selected location.'; return; }
    edit.message = '';
    S.proposal = { ...r.proposal, newField: !edit.context.fieldId };
    if (edit.context.fieldId) fitField();
    else fitTo([r.proposal.polygon]);
  } catch (e) { if (edit === S.coverageEdit) edit.message = e.message; }
  finally { if (edit === S.coverageEdit) { edit.pending = false; repaintCoverage(); } }
}

function coverageEditor() {
  const edit = S.coverageEdit;
  if (!edit) return '';
  const options = maps().filter(m => m.frames > 0);
  const applied = options.find(m => m.id === edit.operation)?.hasApplication;
  const p = S.proposal;
  return `<div class="proposal coverage-review"><b>Coverage Boundary</b>
    <div class="coverage-options"><label>Operation<select id="proposalOp" ${edit.pending || !options.length ? 'disabled' : ''}>${options.length ? options.map(m => `<option value="${esc(m.id)}" ${m.id === edit.operation ? 'selected' : ''}>${esc(m.title)}</option>`).join('') : '<option>No recorded operations</option>'}</select></label>
    <label>Coverage<select id="proposalClass" ${edit.pending ? 'disabled' : ''}><option value="worked">Worked</option><option value="applied" ${edit.coverageClass === 'applied' ? 'selected' : ''} ${applied ? '' : 'disabled'}>Applied</option></select></label></div>
    ${p ? `<p>Proposed ${area(p.areaHa)}${p.previousHa == null ? '' : ` · Active ${area(p.previousHa)} · ${p.addedHa >= 0 ? '+' : ''}${area(p.addedHa)}`}</p>
      ${p.problems.length ? `<ul>${p.problems.map(problem => `<li>${esc(problem)}</li>`).join('')}</ul>` : ''}` : ''}
    ${edit.message ? `<p role="status">${esc(edit.message)}</p>` : ''}
    <div class="acts"><button class="btn" id="proposalPreview" ${edit.operation && !edit.pending ? '' : 'disabled'}>${edit.pending ? 'Working…' : 'Preview Outline'}</button>
      ${p ? `<button class="btn primary" id="proposalSave" ${p.valid && !edit.pending ? '' : 'disabled'}>Save ${p.newField ? 'as New Field' : 'as New Boundary'}</button>` : ''}
      <button class="btn" id="proposalClose">Discard</button></div></div>`;
}

function bindCoverageEditor() {
  if (!$('proposalPreview')) return;
  $('proposalPreview').onclick = previewCoverage;
  $('proposalOp').onchange = e => { S.coverageEdit.operation = e.target.value; S.coverageEdit.coverageClass = 'worked'; S.proposal = null; repaintCoverage(); };
  $('proposalClass').onchange = e => { S.coverageEdit.coverageClass = e.target.value; S.proposal = null; repaintCoverage(); };
  $('proposalClose').onclick = () => { S.coverageEdit = null; S.proposal = null; repaintCoverage(); };
  if ($('proposalSave')) $('proposalSave').onclick = async () => {
    const p = S.proposal, edit = S.coverageEdit;
    if (!p?.valid || edit?.pending || edit?.save !== S.summary?.save) return;
    const name = p.newField ? prompt('Name for the new field', 'New Field') : null;
    if (p.newField && !name?.trim()) return;
    edit.pending = true;
    repaintCoverage();
    try {
      const result = await api('/api/ops/from-coverage', { action: 'commit', id: p.id, name });
      if (edit !== S.coverageEdit) return;
      S.proposal = null; S.coverageEdit = null;
      toast(p.newField ? 'Field created.' : 'Boundary saved.');
      await refresh();
      if (p.newField) openField(result.field);
    } catch (e) { if (edit === S.coverageEdit) edit.message = e.message; }
    finally { edit.pending = false; repaintCoverage(); }
  };
}

function renderField() {
  const d = S.detail;
  if (!d) return;
  requestDraw();
  const f = d.field, b = f.boundaries.find(x => x.v === f.active), recs = d.records;
  $('fieldCrumb').textContent = f.name;
  const versions = [...f.boundaries].sort((x, y) => (y.v === f.active) - (x.v === f.active) || y.v - x.v);
  setHtml($('fieldDetail'), `
    <div class="card"><h2>${esc(f.name)}<button class="edit" id="fieldRename" title="Rename">✎</button><button class="btn rep-btn" id="fieldReport">Field Report</button></h2>
      <div class="who">${esc(clientName())} | ${esc(owned(f) ? farmName() : 'Not owned')}${f.farmland ? ' · Farmland ' + f.farmland : ''}</div>
      <div class="checks"><span class="${b ? '' : 'no'}">Active Boundary</span><span class="${recs.length ? '' : 'no'}">Work Records</span><span class="${(d.tracks || []).length ? '' : 'no'}">Guidance</span></div></div>
    <h3>Boundaries</h3>
    ${versions.map(x => `<div class="bnd ${x.v === f.active ? 'active' : ''}">${shapeSvg(x.polygon, x.v === f.active ? '#d63cc7' : '#9a988d')}
        <b>${esc(f.name)}-Boundary${f.boundaries.length > 1 ? ' ' + x.v : ''}</b>
        ${x.v === f.active ? '<span class="state">Active</span>' : `<button class="mini" data-use="${x.v}">Make Active</button>`}
        <span class="sub">Basic | ${SOURCE[x.source] || x.source} | ${area(x.areaHa)}${dateTxt(x.at) ? ' | ' + dateTxt(x.at) : ''} · <button class="mini" data-edge-track="${x.v}">Create Edge Track</button>${x.source !== 'game' ? ` · <button class="mini" data-remove="${x.v}">Delete</button>` : ''}</span></div>`).join('')}
    <div class="bnd-actions"><span></span>
      <div class="add-wrap"><button class="linkbtn" id="addBnd">+ Add Boundary ▾</button>
        <div class="menu" id="addBndMenu" hidden>
          <button data-ab="draw"><b>From Map</b><span>Draw the boundary on the map</span></button>
          <button data-ab="coverage"><b>From a previous operation</b><span>Trace it from recorded coverage, e.g. after working new ground</span></button>
          <button data-ab="drive"><b>Drive the edge</b><span>Boundary app on the G5 display, in this field</span></button>
        </div></div></div>
    ${S.coverageEdit?.context.fieldId === f.id ? coverageEditor() : ''}
    <p class="note">The newest driven, drawn or traced boundary is active unless you make another one active. Work records follow the active boundary.</p>
    <h3>Guidance</h3>
    ${(d.tracks || []).length ? d.tracks.map(t => `<div class="bnd"><svg class="shape" viewBox="0 0 26 16"><path d="M3 14L23 2" stroke="#1f1f1d" stroke-width="2"/></svg>
        <b>${esc(t.name)}</b><button class="mini" data-trk-rename="${esc(t.id)}">Rename</button>
        <span class="sub">Straight | ${esc(t.how)} | ${fmt(t.h, 1)}°${dateTxt(t.at) ? ' | ' + dateTxt(t.at) : ''} · <button class="mini" data-trk-del="${esc(t.id)}">Delete</button></span></div>`).join('')
      : '<p class="note">No guidance tracks in this field. Create them on the G5 display (Guidance > Set Track) while in the field; they appear here and on every display.</p>'}
    <h3>Work Records</h3>
    ${recs.length ? `<table class="rec"><tr><th>Operation</th><th>Days</th><th class="n">Covered</th><th class="n">Overlap</th></tr>
      ${recs.map(r => `<tr><td><b><i class="wk ${r.kind}"></i>${esc(r.title)}</b><br><span class="note">${esc(recordValues(r))}</span></td><td>${dayTxt(r.firstDay)}${r.lastDay !== r.firstDay && dayTxt(r.lastDay) ? ' – ' + dayTxt(r.lastDay) : ''}</td>
        <td class="n">${area(r.coveredHa)}</td><td class="n">${area(r.overlapHa)}</td></tr>`).join('')}</table>`
      : '<p class="empty">No work recorded in this field yet.</p>'}
    <h3>Prescriptions</h3>
    ${rxSection(d, recs)}`);
  bindRx(d);
  bindCoverageEditor();
  $('fieldReport').onclick = () => openReport(d);
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
    beginCoverageReview({ fieldId: f.id }, S.layerOp);
  };
  $('fieldDetail').querySelectorAll('[data-edge-track]').forEach(button => { button.onclick = async () => {
    button.disabled = true;
    try {
      await api('/api/ops/tracks', { action: 'fromBoundary', fieldId: f.id, v: Number(button.dataset.edgeTrack) });
      toast('Guidance track created from the longest edge.');
      await loadField(f.id, false);
    } catch (e) { toast(e.message); }
    finally { button.disabled = false; }
  }; });
  $('fieldDetail').querySelectorAll('[data-trk-rename]').forEach(x => { x.onclick = async () => {
    const t = d.tracks.find(y => y.id === x.dataset.trkRename); const name = t && prompt('Track name', t.name);
    if (!name) return;
    try { await api('/api/ops/tracks', { action: 'update', id: t.id, changes: { name } }); loadField(f.id, false); } catch (e) { toast(e.message); } }; });
  $('fieldDetail').querySelectorAll('[data-trk-del]').forEach(x => { x.onclick = async () => {
    const t = d.tracks.find(y => y.id === x.dataset.trkDel);
    if (!t || !confirm(`Delete ${t.name}? It is removed from every display.`)) return;
    try { await api('/api/ops/tracks', { action: 'delete', id: t.id }); loadField(f.id, false); } catch (e) { toast(e.message); } }; });
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
  $('mapLayer').hidden = !ops.length || S.page === 'profit';
  if (ops.length) {
    if (!ops.includes(S.layerOp)) S.layerOp = ops[0];
    setHtml($('layerOp'), ops.map(id => `<option value="${esc(id)}" ${id === S.layerOp ? 'selected' : ''}>${esc(opMeta(id).title || id)}</option>`).join(''));
    const keys = ['coverage', ...(opMeta().hasApplication ? ['applied'] : [])].concat((opMeta().values || []).filter(k => LAYERS[k]));
    if (!keys.includes(S.layerKey)) S.layerKey = 'coverage';
    setHtml($('layerKey'), keys.map(k => `<option value="${k}" ${k === S.layerKey ? 'selected' : ''}>${k === 'rate' ? rateLabel() : LAYERS[k].label}</option>`).join(''));
  }
  renderLegend();
}
$('layerOp').onchange = e => { S.layerOp = e.target.value; rangeCache = null; renderLayerControls(); syncFrames(); };
$('layerKey').onchange = e => { S.layerKey = e.target.value; rangeCache = null; renderLegend(); };
function renderLegend() {
  requestDraw();
  if (S.page === 'profit') {
    const r = S.profitField && profitRange();
    $('mapLegend').hidden = !r;
    if (r) {
      let rows = '';
      for (let i = r.n - 1; i >= 0; i--) { const a = r.lo + i * r.step; rows += `<span class="lg"><i class="sq" style="background:${colorIdx(i, r.n, 'high')}"></i>${money(a)}–${money(a + r.step)}</span>`; }
      setHtml($('mapLegend'), `<b>Profit Map</b><em>per ${areaU()}</em>${rows}`);
    }
    return;
  }
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
  if (S.layerKey === 'applied') {
    setHtml($('mapLegend'), '<b>Applied Coverage</b><span class="lg"><i class="sq" style="background:#44a17c"></i>Confirmed application</span><span class="lg"><i class="sq" style="background:#d63cc7"></i>Active Boundary</span>');
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
let workRequest = 0;
async function loadWork() {
  const request = ++workRequest;
  const [history, jobs] = await Promise.allSettled([api('/api/ops/records'), api('/api/ops/jobs')]);
  if (request !== workRequest || S.page !== 'analyze') return;
  const current = r => r.status === 'fulfilled' && (!r.value.save || r.value.save === S.summary?.save);
  if (current(history)) S.work = history.value.records;
  S.workJobs = current(jobs) ? jobs.value.jobs : [];
  renderWork();
}
function renderWork() {
  setHtml($('workChips'), Object.entries(KIND).map(([k, l]) =>
    `<button class="chip ${S.workKind === k ? 'on' : ''}" data-kind="${k}"><i style="background:${KIND_COLOR[k]}"></i>${l}</button>`).join(''));
  const recs = (S.work || []).filter(r => !S.workKind || r.kind === S.workKind);
  const jobs = (S.workJobs || []).filter(j => !S.workKind || j.kind === S.workKind);
  const jobList = jobs.length ? `<h4 class="jobs-group">Work Jobs</h4>${jobs.slice().reverse().map(j => {
    const t = j.totals;
    const stats = t ? [t.fieldHa != null ? `Field ${area(t.fieldHa)}` : null, t.overlapHa > 0 ? `Overlap ${area(t.overlapHa)}` : null,
      t.remainingHa != null ? `Remaining ${area(t.remainingHa)}` : null, t.outsideHa > 0 ? `Outside ${area(t.outsideHa)}` : null,
      t.appliedHa != null ? `Applied ${area(t.appliedHa)}` : null,
      t.productUsed ? `Mapped product used ${fmt(U.vol(t.productUsed.quantity), 1)} ${U.volUnit()}` : null].filter(Boolean).join(' · ') : '';
    return `<div class="row"><i class="wk ${esc(j.kind)}"></i><div class="nm"><b>${esc(j.title)}</b>
      <span>${esc(j.fieldName || 'No field selected')}${j.boundaryVersion != null ? ` · Boundary ${j.boundaryVersion}` : ''} · ${j.finished ? 'Finished' : 'Open'}</span>
      ${stats ? `<span>${esc(stats)}</span>` : ''}</div><span class="num">${t ? area(t.workedHa) : '—'}</span></div>`;
  }).join('')}<h4 class="jobs-group">Operation History</h4>` : '';
  const prop = S.coverageEdit && !S.coverageEdit.context.fieldId ? coverageEditor() : '';
  setHtml($('workList'), prop + jobList + (recs.length ? recs.map(r => `
    <div class="row" ${r.field ? `data-field="${esc(r.field)}"` : ''}><i class="wk ${r.kind}"></i>
      <div class="nm"><b>${esc(r.title)}</b><span>${esc(r.fieldName)}${dayTxt(r.firstDay) ? ' · ' + dayTxt(r.firstDay) : ''}${r.lastDay !== r.firstDay && dayTxt(r.lastDay) ? ' – ' + dayTxt(r.lastDay) : ''}</span>
        <span>${esc(recordValues(r))}</span>${r.field ? '' : `<span><button class="linkbtn" data-pick="${esc(r.op)}">Create a field from this coverage</button></span>`}</div>
      <span class="num">${r.field ? area(r.coveredHa) : area(r.swathHa)}</span><span class="chev">${r.field ? '›' : ''}</span></div>`).join('')
    : '<p class="empty">No work recorded in this savegame yet.</p>'));
  bindCoverageEditor();
}
$('workChips').onclick = e => { const b = e.target.closest('[data-kind]'); if (b) { S.workKind = S.workKind === b.dataset.kind ? null : b.dataset.kind; renderWork(); } };
$('workList').onclick = e => {
  const pick = e.target.closest('[data-pick]');
  if (pick) { S.pick = { operation: pick.dataset.pick }; $('mapHint').hidden = false; $('mapHint').textContent = 'Tap the recorded coverage of the new field'; return; }
  const r = e.target.closest('[data-field]');
  if (r) openField(r.dataset.field);
};

// ---------------------------------------------------------------- Harvest Profit
async function loadProfit(render = true) {
  try { S.profit = await api('/api/ops/profit'); S.finance = await api('/api/ops/finance'); } catch (e) { return; }
  if (render) renderProfit();
}

// Farm Finance (full read API: getFarmSummary + getMarket), shown like a lender's view of the farm
const pct = (v, d = 1) => typeof v === 'number' ? `${fmt(v * 100, d)} %` : '---';
const machineName = uid => { const m = uid && (S.summary.equipment || []).find(e => String(e.id) === String(uid)); return m ? m.name : null; };
function financeOf(e) {
  const sm = S.finance && S.finance.farmFinance && S.finance.farmFinance.summary;
  if (!sm) return null;
  const lease = (sm.leases || []).find(l => String(l.vehicleUid) === String(e.id) && l.status !== 'ended');
  if (lease) return { kind: 'lease', text: `Leased · ${money(lease.payment)}/mo · ${lease.monthsLeft} mo left` };
  const loan = (sm.loans || []).find(l => String(l.collateralUid) === String(e.id) && l.balance > 0);
  if (loan) return { kind: 'loan', text: `Financed · ${money(loan.balance)} left · ${money(loan.payment)}/mo` };
  return null;
}
const GPS_BILLING = { account: 'Input account, then operating line', line: 'Operating line', cash: 'Cash' };
const payerName = p => p === 'FS25_FarmFinance' ? 'Farm Finance' : p;
function renderFinance() {
  const ff = S.finance && S.finance.farmFinance, sm = ff && ff.summary;
  if (!sm) {
    setHtml($('profitBody'), `<p class="empty">${ff ? 'Farm Finance is installed, but its full read API (getFarmSummary) is not available. Update Farm Finance.' : 'Farm Finance is not installed or not ready. With it, loans, leases, credit and land contracts appear here.'}</p>`);
    return;
  }
  const cr = sm.credit || {}, ra = cr.ratios || {}, parts = cr.parts || {}, debt = sm.debt || {}, led = sm.ledger || {}, line = sm.operatingLine, mk = ff.market;
  const bar = (label, v) => `<div class="cost-row"><span>${label}</span><span><div class="svc-bar"><i class="${v < 0.4 ? 'due' : v < 0.7 ? 'soon' : ''}" style="width:${Math.round((v || 0) * 100)}%"></i></div></span></div>`;
  const card = (title, body) => `<div class="pl-card"><h3><span>${title}</span></h3>${body}</div>`;
  const grid = rows => `<div class="pl-grid">${rows.filter(Boolean).map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>`;
  const loans = (sm.loans || []).filter(l => l.status !== 'paid');
  const leases = sm.leases || [];
  const land = sm.land || [];
  setHtml($('profitBody'), [
    card(`Credit · ${cr.score ? fmt(cr.score, 0) : '---'} ${esc(cr.grade || '')}`, grid([
      ['Net worth', money(ra.netWorth)], ['Total assets', money(ra.totalAssets)], ['Total debt', money(ra.totalDebt ?? debt.total)],
      ['Debt to asset', pct(ra.debtToAsset)], ['Current ratio', typeof ra.currentRatio === 'number' ? fmt(ra.currentRatio, 2) : '---'],
      ['Term debt coverage', typeof ra.termDebtCoverage === 'number' ? fmt(ra.termDebtCoverage, 2) : '---'], ['Working capital', money(ra.workingCapital)],
    ]) + (Object.keys(parts).length ? Object.entries(parts).map(([k, v]) => bar(k[0].toUpperCase() + k.slice(1), v)).join('') : '')
      + (cr.history ? `<p class="note">Payments on time ${cr.history.onTime ?? 0}, late ${cr.history.late ?? 0}, missed ${cr.history.missed ?? 0}${cr.history.monthsOnRecord ? ` · ${cr.history.monthsOnRecord} months on record` : ''}.</p>` : '')),
    card('Debt', grid([
      ['Real estate', money(debt.debts && debt.debts.realEstate)], ['Equipment', money(debt.debts && debt.debts.equipment)],
      ['Operating', money(debt.debts && debt.debts.operating)], debt.debts && debt.debts.imported ? ['Imported', money(debt.debts.imported)] : null,
      ['Monthly payments', money(debt.monthlyPayments)], ['Next 12 months', money(debt.debtService12)],
      ['  of which interest', money(debt.interest12)],
      mk ? ['Base rate', `${pct(mk.baseRate, 2)} ${mk.trend > 0 ? '↑' : mk.trend < 0 ? '↓' : '→'}`] : null,
    ])),
    card(`Loans (${loans.length})`, loans.length ? loans.map(l => `<div class="svc-row"><b>${esc(l.label || l.productId || 'Loan')}</b><span>${money(l.balance)}</span>
      <span>${esc({ realEstate: 'Real estate', equipment: 'Equipment', operating: 'Operating' }[l.productId] || l.productId || '')} · ${pct(l.rate, 2)} · ${money(l.payment)}/mo · ${l.monthsLeft} of ${l.monthsTotal} mo${machineName(l.collateralUid) ? ' · on ' + esc(machineName(l.collateralUid)) : ''}${l.status && l.status !== 'active' ? ' · ' + esc(l.status) : ''}</span><span></span>
      <div class="svc-bar"><i style="width:${l.principal ? Math.round((1 - l.balance / l.principal) * 100) : 0}%"></i></div></div>`).join('') : '<p class="empty">No loans.</p>'),
    card(`Machine Leases (${leases.length})`, leases.length ? leases.map(l => `<div class="svc-row"><b>${esc(l.name || machineName(l.vehicleUid) || 'Lease')}</b><span>${money(l.payment)}/mo</span>
      <span>${l.monthsLeft} of ${l.months} mo left · residual ${money(l.residual)}${l.hoursPerYear ? ` · ${fmt(l.hoursPerYear, 0)} h/yr allowed` : ''}${l.status && l.status !== 'active' ? ' · ' + esc(l.status) : ''}</span><span></span></div>`).join('') : '<p class="empty">No machine leases.</p>'),
    line ? card('Operating Line', grid([['Limit', money(line.limit)], ['Balance', money(line.balance)], ['Rate', pct(line.rate, 2)], ['Open', line.open ? 'Yes' : 'No']])) : '',
    sm.inputAccount ? card('Input Account', grid([['Balance', money(sm.inputAccount.balance)], ['Limit', money(sm.inputAccount.limit)], ['Available', money(sm.inputAccount.available)],
      sm.inputAccount.pastDue > 0 ? ['Past due', money(sm.inputAccount.pastDue)] : null, ['Due crop year', sm.inputAccount.dueCropYear ?? '---'],
      ['Early-pay discount', pct(sm.inputAccount.earlyPayDiscount, 1)]])) : '',
    sm.gps && sm.gps.installed ? card('GPS Corrections (G5Link)', grid([
      ['Paid from', sm.gps.connected ? esc(GPS_BILLING[sm.gps.billing] || sm.gps.billing) : sm.gps.payer ? 'Billed through ' + esc(payerName(sm.gps.payer)) : 'Cash (Farm Finance not connected yet)'],
      ['Monthly', money(sm.gps.monthlyCost)], ['Machines subscribed', fmt(sm.gps.machines || 0, 0)],
      ['Paid by Farm Finance', money(sm.gps.paid)], ['  on the input account', money(sm.gps.onAccount)], ['  on the operating line', money(sm.gps.onLine)]]))
      + '<p class="note">Change where GPS subscriptions are paid from in the game: Farm Finance page, input account.</p>' : '',
    card(`Land Contracts (${land.length})`, land.length ? land.map(c => `<div class="svc-row"><b>${esc(c.name || 'Farmland ' + c.farmlandId)}</b><span>${c.leaseType === 'share' ? `${pct(c.landownerShare, 0)} share` : money(c.annualRent) + '/yr'}</span>
      <span>${c.kind === 'in' ? 'Rented in' : 'Rented out'} · ${c.leaseType === 'share' ? `crop share, landowner pays ${pct(c.inputShare, 0)} of inputs` : 'cash rent'}${c.endCropYear ? ' · to crop year ' + c.endCropYear : ''}</span><span></span></div>`).join('') : '<p class="empty">No land contracts.</p>'),
    card('Ledger', grid([['Interest paid', money(led.interestPaid)], ['Principal paid', money(led.principalPaid)], ['Rent paid', money(led.rentPaid)],
      ['Rent received', money(led.rentIncome)], ['Income, 12 months', money(led.income12)], ['Operating costs, 12 months', money(led.opex12)]])),
  ].join(''));
}
const CROP_NAMES = { MAIZE: 'Corn', SOYBEAN: 'Soybeans', WV_SPRINGWHEAT: 'Spring Wheat', WV_WINTERWHEAT: 'Winter Wheat' };
const cropName = c => !c ? '---' : CROP_NAMES[String(c).toUpperCase()] || String(c).toLowerCase().replace(/(^|_)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase());
const pricePer = (pt, crop) => typeof pt !== 'number' ? null : metric('grain') ? pt : pt * HU.lbPerBu(crop) * 0.000453592;   // per t -> per bu
const priceU = () => metric('grain') ? 't' : 'bu';
const qty = (t, crop) => metric('grain') ? `${fmt(t, 1)} t` : `${fmt(t * 1000 / 0.453592 / HU.lbPerBu(crop), 0)} bu`;
function renderProfit() {
  document.querySelectorAll('#profitTabs button').forEach(b => b.classList.toggle('on', b.dataset.sub === S.profitSub));
  const P = S.profit;
  if (!P) { setHtml($('profitBody'), '<p class="empty">Loading…</p>'); return; }
  if (S.profitSub === 'costs') return renderCosts();
  if (S.profitSub === 'finance') return renderFinance();
  const t = P.totals, fin = P.finances;
  const row = r => `<div class="row pl-row ${r.field === S.profitField ? 'on' : ''}" data-pf="${esc(r.field)}">${shapeSvg((S.summary.fields.find(f => f.id === r.field) || {}).polygon, r.net >= 0 ? '#5fa83a' : '#c40b0b', 'ico')}
    <div class="nm"><b>${esc(r.name)}</b><span>${esc(cropName(r.crop))} · ${area(r.areaHa)}</span></div>
    <span class="num ${r.net >= 0 ? 'pos' : 'neg'}">${money(perArea(r.netPerHa))}/${areaU()}</span><span class="chev">›</span></div>`;
  const sel = profitRow();
  setHtml($('profitBody'), `
    <div class="pl-card"><h3><span>Operation</span><span class="note">${P.economyAge ? 'Game prices' : 'No price data from the game yet'}</span></h3>
      <div class="pl-net ${t.net >= 0 ? 'pos' : 'neg'}">${money(t.net)}</div>
      <div class="pl-grid"><span>Revenue</span><b>${money(t.revenue)}</b><span>Expenses</span><b>${money(t.expenses)}</b>
        <span>Net per ${areaU()}</span><b>${t.areaHa ? money(perArea(t.net / t.areaHa)) : '---'}</b>
        ${fin ? `<div class="sep"></div><span>Farm balance</span><b>${money(fin.balance)}</b><span>Loan</span><b>${money(fin.loan)}</b><span>Equity</span><b>${money(fin.equity)}</b>` : ''}
        ${fin && fin.farmFinance ? farmFinanceLines(fin.farmFinance) : ''}</div></div>
    ${sel ? budgetCard(sel) : ''}
    <h3 style="margin:12px 0 4px;font-size:var(--fs-md)">Fields by profit per ${areaU()}</h3>
    ${P.fields.length ? P.fields.map(row).join('') : '<p class="empty">No work recorded on any field yet. Harvest, seeding and application work fills this in.</p>'}`);
}
function farmFinanceLines(ff) {
  const a = ff.inputAccount;
  return `<div class="sep"></div><span>Credit (Farm Finance)</span><b>${ff.creditScore ? fmt(ff.creditScore, 0) + ' · ' + esc(ff.creditGrade || '') : '---'}</b>
    ${a && a.enabled ? `<span>Input account</span><b>${money(a.balance)} of ${money(a.limit)}</b><span class="sub">Available</span><b>${money(a.available)}</b>
      ${a.pastDue > 0 ? `<span class="sub">Past due</span><b style="color:var(--red)">${money(a.pastDue)}</b>` : ''}` : ''}
    <span>Leased farmlands</span><b>${ff.leases}</b>`;
}
function budgetCard(r) {
  const ha = r.areaHa || 1, e = r.expenses;
  const line = (label, v) => `<span class="sub">${label}</span><b>${money(perArea(v / ha), 2)}</b>`;
  return `<div class="pl-card"><h3><span>${esc(r.name)} · ${esc(cropName(r.crop))}</span><span class="note">per ${areaU()}</span></h3>
    <div class="pl-net ${r.net >= 0 ? 'pos' : 'neg'}">${money(perArea(r.netPerHa), 2)} <small class="note">net</small></div>
    <div class="pl-grid">
      <span>Revenue</span><b>${money(perArea(r.revenue / ha), 2)}</b>
      <span>Expenses</span><b>${money(perArea(r.expensesPerHa), 2)}</b>
      ${line('Seed', e.seed)}${line('Fertilizer', e.fertilizer)}${line('Chemical', e.chemical)}${line('Machinery', e.machinery)}
      ${line(r.lease ? (r.lease.type === 'share' ? 'Rent (crop share)' : 'Rent (lease)') : 'Rent', e.rent)}
      <div class="sep"></div>
      <span>Harvested</span><b>${r.tonnes ? qty(r.tonnes, r.crop) : '---'}</b>
      <span>Market price</span><b>${r.pricePerT !== null ? money(pricePer(r.pricePerT, r.crop), 2) + '/' + priceU() : '---'}${r.priceSource === 'set' ? ' (set)' : r.priceSource === 'game' ? ' (game)' : ''}</b>
      <span>Cost per ${priceU()}</span><b>${r.breakEvenPrice !== null ? money(pricePer(r.breakEvenPrice, r.crop), 2) : '---'}</b>
      <span>Break-even yield</span><b>${r.breakEvenYield !== null ? fmt(HU.yield(r.breakEvenYield, r.crop), metric('grain') ? 2 : 1) + ' ' + HU.yieldUnit() : '---'}</b>
    </div>${r.lease ? `<p class="note">Farm Finance ${r.lease.type === 'share' ? `crop-share lease: landowner takes ${fmt((r.lease.landownerShare || 0) * 100, 0)} % of the crop and pays ${fmt((r.lease.inputShare || 0) * 100, 0)} % of inputs` : `cash lease: ${money(r.lease.annualRent)} a year for the farmland`}${r.lease.endCropYear ? ', to crop year ' + r.lease.endCropYear : ''}.</p>` : ''}
    ${r.missing.length ? `<div class="pl-warn">Not counted: ${esc(r.missing.join(', '))}.</div>` : ''}</div>`;
}
function renderCosts() {
  const P = S.profit, ps = P.settings, per = areaU();
  const crops = [...new Set(P.fields.map(r => r.crop).filter(Boolean).concat(Object.keys(ps.prices)))];
  const inp = (key, v, extra = '') => `<input data-cost="${key}" type="number" min="0" step="any" value="${v}" ${extra}>`;
  setHtml($('profitBody'), `
    <h3 style="margin:8px 0 4px;font-size:var(--fs-md)">Machinery cost per ${per}</h3>
    <p class="note">Fuel, repairs, depreciation and labor per ${per} worked, by work type (custom-rate style).</p>
    ${['tillage', 'seeding', 'application', 'harvest'].map(k => `<div class="cost-row"><span><i class="wk ${k}"></i>${KIND[k]}</span>${inp('machinery.' + k, +(perArea(ps.machinery[k])).toFixed(2))}</div>`).join('')}
    <h3 style="margin:14px 0 4px;font-size:var(--fs-md)">Land</h3>
    <div class="cost-row"><span>Rent per ${per}<small>Charged on the whole field area</small></span>${inp('rent', +(perArea(ps.rent)).toFixed(2))}</div>
    <h3 style="margin:14px 0 4px;font-size:var(--fs-md)">Crop prices per ${priceU()}</h3>
    <p class="note">Leave empty to use the game's price. Set one to plan with a contract price.</p>
    ${crops.length ? crops.map(c => { const g = P.fields.find(r => r.crop === c); const set = ps.prices[c];
      return `<div class="cost-row"><span>${esc(cropName(c))}<small>${g && g.priceSource === 'game' ? 'Game: ' + money(pricePer(g.pricePerT, c), 2) : 'No game price yet'}</small></span>
        ${inp('price.' + c, typeof set === 'number' ? +pricePer(set, c).toFixed(2) : '', 'placeholder="game"')}</div>`; }).join('') : '<p class="empty">Crops appear here once fields have work recorded.</p>'}
    <div class="cost-row"><span>Currency symbol</span><input data-cost="currency" value="${esc(ps.currency)}" maxlength="4" style="text-align:left"></div>`);
}
$('profitTabs').onclick = e => { const b = e.target.closest('[data-sub]'); if (b) { S.profitSub = b.dataset.sub; renderProfit(); } };
$('profitBody').onclick = e => {
  const r = e.target.closest('[data-pf]');
  if (!r) return;
  S.profitField = r.dataset.pf;
  const f = S.summary.fields.find(x => x.id === S.profitField);
  const harvest = (S.profit.fields.find(x => x.field === S.profitField) || {}).operations || [];
  const op = maps().find(m => m.kind === 'harvest' && harvest.includes(m.title));
  S.profitOp = op ? op.id : null; S.framesOp = null; profitRangeCache = null;
  if (f) fitTo([f.polygon]);
  renderProfit(); syncFrames(); renderLegend();
};
$('profitBody').addEventListener('change', async e => {
  const k = e.target.dataset.cost; if (!k) return;
  const v = e.target.value.trim(), body = {};
  const toHa = x => metric('area') ? x : x * 2.47105;                     // per ac -> per ha
  if (k === 'currency') body.currency = v;
  else if (k === 'rent') body.rent = toHa(Number(v) || 0);
  else if (k.startsWith('machinery.')) body.machinery = { [k.slice(10)]: toHa(Number(v) || 0) };
  else if (k.startsWith('price.')) {
    const crop = k.slice(6);
    body.prices = { [crop]: v === '' ? null : (metric('grain') ? Number(v) : Number(v) / (HU.lbPerBu(crop) * 0.000453592)) };
  }
  try { await api('/api/ops/profit-settings', body); await loadProfit(); toast('Saved.'); } catch (err) { toast(err.message); }
});

// ---------------------------------------------------------------- Service (maintenance from Advanced Damage System)
const DUE_SOON = 0.85;                                     // share of the interval
const prettyState = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/(^| )([a-z])/g, (m, a, b) => a + b.toUpperCase());
function renderService() {
  document.querySelectorAll('#serviceTabs button').forEach(b => b.classList.toggle('on', b.dataset.sub === S.serviceSub));
  const list = (S.summary && S.summary.equipment) || [];
  const withPlan = list.filter(e => e.ads && typeof e.ads.interval === 'number');
  const ratio = e => e.ads.hours / e.ads.interval;
  const pastDue = withPlan.filter(e => ratio(e) >= 1), soon = withPlan.filter(e => ratio(e) >= DUE_SOON && ratio(e) < 1);
  const shop = list.filter(e => e.ads && ['INSPECTION', 'MAINTENANCE', 'REPAIR'].includes(e.ads.state));
  const broken = list.filter(e => e.ads && e.ads.state === 'BROKEN');
  const noPlan = list.filter(e => !e.ads || typeof e.ads.interval !== 'number');
  const row = e => {
    const has = e.ads && typeof e.ads.interval === 'number', r = has ? ratio(e) : 0;
    return `<div class="svc-row" data-eq="${esc(e.id)}"><b>${esc(e.name)}</b><span>${has ? `${fmt(e.ads.hours, 1)} of ${fmt(e.ads.interval, 0)} h` : typeof e.damage === 'number' ? `Condition ${fmt(100 - e.damage, 0)} %` : ''}</span>
      <span>${e.ads && e.ads.state === 'BROKEN' ? 'Broken down' : e.ads && e.ads.state && e.ads.state !== 'READY' ? 'In workshop: ' + esc(prettyState(e.ads.state)) : has ? (r >= 1 ? 'Service overdue' : r >= DUE_SOON ? 'Service due soon' : 'Ready') : 'No maintenance plan'}${typeof e.hours === 'number' ? ` · ${fmt(e.hours, 1)} engine h` : ''}</span><span></span>
      ${has ? `<div class="svc-bar"><i class="${r >= 1 ? 'due' : r >= DUE_SOON ? 'soon' : ''}" style="width:${Math.min(100, r * 100).toFixed(0)}%"></i></div>` : ''}</div>`;
  };
  const card = (title, items, empty) => `<div class="svc-card"><h3>${title} (${items.length})</h3>${items.length ? items.map(row).join('') : `<p class="empty">${empty}</p>`}</div>`;
  const note = `<p class="note">Service intervals and workshop state come from Advanced Damage System, as the game shows them. Machine condition stays hidden until a workshop inspection, as in that mod.${withPlan.length ? '' : ' No machine reports a service interval: Advanced Damage System is not installed or not active.'}</p>`;
  setHtml($('serviceBody'), S.serviceSub === 'all'
    ? `<div class="svc-card"><h3>All Equipment (${list.length})</h3>${list.map(row).join('') || '<p class="empty">No machines reported yet.</p>'}</div>${note}`
    : card('Maintenance Past Due', pastDue, 'No equipment with maintenance past due.') + card('Maintenance Due Soon', soon, 'No equipment with maintenance due soon.')
      + card('Broken Down', broken, 'No broken-down equipment.') + card('In the Workshop', shop, 'No equipment in the workshop.')
      + card('Equipment Without a Maintenance Plan', noPlan, 'Every machine has a maintenance plan.')
      + `<div class="svc-card"><h3>Summary</h3><div class="svc-sum"><div><small>Machines</small><b>${list.length}</b></div><div><small>With a plan</small><b>${withPlan.length}</b></div>
        <div><small>Past due</small><b>${pastDue.length}</b></div><div><small>In workshop</small><b>${shop.length}</b></div>
        <div><small>Broken down</small><b>${broken.length}</b></div><div><small>Due soon</small><b>${soon.length}</b></div></div></div>${note}`);
}
$('serviceTabs').onclick = e => { const b = e.target.closest('[data-sub]'); if (b) { S.serviceSub = b.dataset.sub; renderService(); } };
$('serviceBody').onclick = e => { const q = e.target.closest('[data-eq]'); if (q) focusMachine(q.dataset.eq); };

// ---------------------------------------------------------------- RTK package (G5Link mod, scripts/Rtk.lua)
const RTK_SUBS = [['SF2', 'SF2'], ['SF3', 'SF3'], ['MRTK', 'M-RTK'], ['SFRTK', 'SF-RTK']];
const rtkMoney = v => typeof v === 'number' ? '$' + Math.round(v).toLocaleString() : '---';
async function loadRtk() {
  try { S.rtk = (await api('/api/rtk')).rtk; } catch (e) { S.rtk = null; }
  if (S.page === 'rtk') renderRtk();
}
async function rtkCmd(arg) {
  try { await api('/api/cmd', { name: 'rtk', value: 0, index: 0, arg }); toast('Sent to the game.'); } catch (e) { toast(e.message); }
  setTimeout(loadRtk, 1500);
}
function renderRtk() {
  document.querySelectorAll('#rtkTabs button').forEach(b => b.classList.toggle('on', b.dataset.sub === (S.rtkSub || 'machines')));
  const r = S.rtk;
  if (!r) return setHtml($('rtkBody'), '<p class="note">No RTK data yet. The G5Link mod writes it once a savegame is running.</p>');
  const p = r.prices || {}, sub = S.rtkSub || 'machines';
  const total = (r.vehicles || []).reduce((a, v) => a + (v.monthly || 0), 0);
  if (sub === 'machines') {
    const blocked = (v, k) => v.receiver === 'NONE' || (k === 'SFRTK' && v.receiver !== 'SF7000') || (v.receiver === 'SF3000' && (k === 'SF3' || k === 'MRTK'));
    const checks = (r.vehicles || []).flatMap(v => v.receiver === 'NONE' ? [[v, 'No GPS receiver. Fit one in the shop (Customize) to use corrections, headland automation and the Grain Cart remote.']]
      : v.receiver === 'SF3000' ? [[v, 'StarFire 3000: SF2 at most, no Mobile RTK or SF-RTK.']]
      : v.subs.includes('SFRTK') && v.receiver !== 'SF7000' ? [[v, 'SF-RTK subscription without a StarFire 7000.']] : []);
    setHtml($('rtkBody'), `${checks.length ? `<div class="svc-card"><h3>Equipment Check (${checks.length})</h3>${checks.map(([v, t]) => `<div class="rtk-row"><div><b>${esc(v.name)}</b><span>${esc(t)}</span></div><span></span><span></span><span></span></div>`).join('')}</div>` : ''}
      <div class="svc-card"><h3>Machines (${(r.vehicles || []).length}) · ${rtkMoney(total)}/month</h3>
      ${(r.vehicles || []).map(v => `<div class="rtk-mach"><div class="rtk-top"><div><b>${esc(v.name)}</b><span>${esc(v.receiverName || v.receiver)}${v.hwSource === 'shop' ? ' (shop option)' : ''}${v.rtk ? ' · RTK' : ''}${v.level ? ` · now ${esc(v.src || v.level)}` : ''}</span></div>
        <span class="num">${rtkMoney(v.monthly)}/mo</span></div>
        <div class="rtk-line"><div class="rtk-subs">${RTK_SUBS.map(([k, n]) => `<button class="chip ${v.subs.includes(k) ? 'on' : ''}" data-rsub="${k}" data-veh="${esc(v.id)}" data-on="${v.subs.includes(k) ? 0 : 1}"
          ${blocked(v, k) && !v.subs.includes(k) ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        <div class="rtk-buy">${v.rtk || v.receiver === 'NONE' ? '' : `<button class="btn" data-rbuy="RTK" data-veh="${esc(v.id)}">RTK ${rtkMoney(p.RTK)}</button>`}${v.receiver === 'SF7000' || v.hwSource === 'shop' ? '' : `<button class="btn" data-rbuy="SF7000" data-veh="${esc(v.id)}">SF7000 ${rtkMoney(p.SF7000)}</button>`}</div></div></div>`).join('') || '<p class="empty">No machines.</p>'}</div>
      <p class="note">SF1 is free on every receiver. Subscriptions are charged each game month${r.payer ? ` through ${esc(payerName(r.payer))}${rtkBilling()}` : ' in the game finances (GPS corrections)'}. SF3 includes SF2. SF-RTK needs a StarFire 7000; RTK by radio needs the RTK activation and your own base station in range. Machines whose mod offers GPS in the shop use that option as their receiver (change it with Customize).</p>`);
  } else if (sub === 'bases') {
    const items = r.stationItems || [];
    setHtml($('rtkBody'), `<div class="svc-card"><h3>Base Stations (${(r.bases || []).length})</h3>
      ${(r.bases || []).map(b => `<div class="rtk-row" data-base="${esc(b.id)}"><div><b>${esc(b.name)}</b><span>${b.state === 'survey' ? `Self survey, ${fmt(b.surveyLeftMin, 0)} game min left` : 'OK'} · range ${fmt((r.baseRange || 3000) / 1000, 1)} km</span></div>
        <span></span><span></span><span></span></div>`).join('') || '<p class="empty">No base station. Build an RTK station from the construction menu in the game.</p>'}</div>
      <div class="svc-card"><h3>RTK Stations in the Shop (${items.length})</h3>
      ${items.map(i => `<div class="rtk-row"><div><b>${esc(i.name)}</b><span>Mod price ${rtkMoney(i.modPrice)}, ${rtkMoney(i.modUpkeep)}/day</span></div><span></span>
        <span class="num">${rtkMoney(i.price)}</span><span>${rtkMoney(i.upkeep)}/day</span></div>`).join('') || '<p class="empty">No RTK station mod installed. Any placeable with "RTK" in its name works, e.g. the John Deere RTK Stations pack.</p>'}
      <div class="cost-grid rtk-actions"><div class="cost-row"><span>Shop price for every RTK station<small>0 keeps each mod's own price</small></span><input type="number" min="0" step="100" data-rprice="BASE" value="${p.BASE ?? ''}"></div>
        <div class="cost-row"><span>Daily upkeep</span><input type="number" min="0" step="1" data-rprice="BASE_UPKEEP" value="${p.BASE_UPKEEP ?? ''}"></div></div></div>
      <p class="note">A base self-surveys for ${fmt(r.surveyMin || 120, 0)} game minutes, then gives RTK to machines with the RTK activation within ${fmt((r.baseRange || 3000) / 1000, 1)} km. Out of range, RTK-X holds RTK accuracy for up to 14 game days.</p>`);
  } else {
    const items = [['SF2', 'SF2 per month'], ['SF3', 'SF3 per month'], ['MRTK', 'Mobile RTK per month'], ['SFRTK', 'SF-RTK per month'], ['RTK', 'RTK activation'],
      ['SF3000', 'StarFire 3000 (shop option)'], ['SF6000', 'StarFire 6000 or plain GPS (shop option)'], ['SF7000', 'StarFire 7000'], ['SHOP_GPS', 'Price GPS shop options (1 = yes, 0 = mods\' own)']];
    setHtml($('rtkBody'), `<div class="svc-card"><h3>Charges</h3>${(r.ledger || []).slice().reverse().map(l => `<div class="rtk-row"><div><b>${esc(l.text || l.item)}</b><span>Day ${l.day} · ${l.kind === 'subscription' ? 'Monthly' : 'Purchase'} · paid by ${esc(payerName(l.paidBy))}</span></div><span></span><span class="num">${rtkMoney(l.amount)}</span><span></span></div>`).join('') || '<p class="empty">No charges yet.</p>'}</div>
      <div class="svc-card"><h3>Prices</h3><div class="cost-grid">${items.map(([k, n]) => `<div class="cost-row"><span>${n}</span><input type="number" min="0" step="1" data-rprice="${k}" value="${p[k] ?? ''}"></div>`).join('')}</div></div>
      <div class="svc-card"><h3>Feature Requirements</h3><div class="rtk-row"><div><b>Like Deere activations</b><span>Headland automation needs SF2, the Grain Cart remote SF3</span></div><span></span><span></span>
        <div class="rtk-buy"><button class="chip ${r.gates !== false ? 'on' : ''}" data-rgates="1">On</button><button class="chip ${r.gates === false ? 'on' : ''}" data-rgates="0">Off</button></div></div></div>`);
  }
}
$('rtkTabs').onclick = e => { const b = e.target.closest('[data-sub]'); if (b) { S.rtkSub = b.dataset.sub; renderRtk(); } };
$('rtkBody').onclick = e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const p = (S.rtk && S.rtk.prices) || {};
  if (b.dataset.rsub) {
    const on = b.dataset.on === '1';
    if (on && !window.confirm(`Subscribe to ${b.textContent} for ${rtkMoney(p[b.dataset.rsub])} a month?`)) return;
    return rtkCmd(`action=sub;vehicle=${b.dataset.veh};item=${b.dataset.rsub};on=${on ? 1 : 0}`);
  }
  if (b.dataset.rbuy) {
    if (!window.confirm(`Buy ${b.dataset.rbuy === 'RTK' ? 'the RTK activation' : 'a StarFire 7000'} for ${rtkMoney(p[b.dataset.rbuy])}?`)) return;
    return rtkCmd(`action=buy;vehicle=${b.dataset.veh};item=${b.dataset.rbuy}`);
  }
  if (b.dataset.rgates) return rtkCmd(`action=gates;on=${b.dataset.rgates}`);
};
$('rtkBody').addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.rprice;
  if (k && e.target.value !== '' && Number(e.target.value) >= 0) rtkCmd(`action=price;item=${k};value=${Math.round(Number(e.target.value))}`);
});
setInterval(() => { if (S.page === 'rtk' || (S.rtk && S.rtk.bases && S.rtk.bases.length)) loadRtk(); }, 5000);
loadRtk();

// Where Farm Finance books GPS charges, for the RTK page note.
function rtkBilling() {
  const g = S.finance && S.finance.farmFinance && S.finance.farmFinance.summary && S.finance.farmFinance.summary.gps;
  return g && g.connected ? ` (${esc((GPS_BILLING[g.billing] || g.billing).toLowerCase())}; it charges cash when there is no room)` : '';
}

// Equipment
function equipmentRows(list) {
  const sm = S.summary;
  const fieldName = id => { const f = sm.fields.find(x => String(x.id) === String(id)); return f ? f.name : id ? `Field ${id}` : null; };
  return list.length ? `<div class="group"><span>Machines (${list.length})</span><span>Fuel</span></div>` + list.map(e => `
    <div class="row" data-eq="${esc(e.id)}"><span>${e.kind === 'combine' ? '🌾' : e.kind === 'truck' ? '🚚' : e.kind === 'sprayer' ? '💧' : '🚜'}</span>
      <div class="nm"><b>${esc(e.name)}<span class="badge ${e.inUse ? 'inuse' : e.ai ? 'ai' : 'parked'}">${e.inUse ? 'In use' : e.ai ? 'AI worker' : e.motorOn ? 'Running' : 'Parked'}</span></b>
        <span>${fieldName(e.field) ? esc(fieldName(e.field)) + ' · ' : ''}${typeof e.hours === 'number' ? fmt(e.hours, 1) + ' h' : ''}${e.ads && typeof e.ads.interval === 'number' ? ` · service ${fmt(e.ads.hours, 0)}/${fmt(e.ads.interval, 0)} h` : typeof e.damage === 'number' && !e.ads ? ` · condition ${fmt(100 - e.damage, 0)} %` : ''}${e.speed > 0.5 ? ` · ${fmt(U.speed(e.speed), 1)} ${U.speedUnit()}` : ''}${e.implements && e.implements.length ? ' · ' + esc(e.implements.join(', ')) : ''}</span>${financeOf(e) ? `<span>${esc(financeOf(e).text)}</span>` : ''}${gpsOf(e) ? `<span>${esc(gpsOf(e))}</span>` : ''}</div>
      <span class="num">${typeof e.fuelPct === 'number' ? fmt(e.fuelPct, 0) + ' %' : ''}</span><span class="chev">›</span></div>`).join('')
    : '<p class="empty">No machines reported yet.</p>';
}
// GPS line for the Equipment list (RTK package equipment check)
function gpsOf(e) {
  const v = S.rtk && (S.rtk.vehicles || []).find(x => x.id === e.id);
  if (!v) return null;
  if (v.receiver === 'NONE') return 'GPS: no receiver';
  return `GPS: ${v.receiverName || v.receiver}${v.hwSource === 'shop' ? ' (shop option)' : ''}${v.subs.length ? ' · ' + v.subs.map(k => (RTK_SUBS.find(x => x[0] === k) || [k, k])[1]).join(', ') : ' · SF1'}${v.rtk ? ' · RTK' : ''}`;
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
requestDraw();

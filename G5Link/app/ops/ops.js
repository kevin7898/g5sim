'use strict';
// G5Link Ops Center: fields with versioned boundaries (game map, driven, from coverage), work records
// per field and operation, and the farm's equipment. Data from the bridge (/api/ops/*, /api/map/*).

const $ = id => document.getElementById(id);
function setHtml(el, html) { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } }
const S = { summary: null, version: -1, tab: 'fields', field: null, detail: null, proposal: null, pick: null,
  layerOp: null, layerKey: 'coverage', frames: [], framesOp: null, framesSeq: 0, overlap: null, search: '' };

function toast(text, ms = 3000) {
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
const dayTxt = d => typeof d === 'number' ? `Day ${d}` : '---';
const dateTxt = ms => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const SOURCE = { game: 'Game map', driven: 'Driven', coverage: 'From coverage' };

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
  V.ppm = Math.min(r.width / Math.max(40, (x1 - x0) * 1.15), r.height / Math.max(40, (z1 - z0) * 1.15));
}
function fitAll() {
  const sm = S.summary;
  if (!sm) return;
  const polys = sm.fields.map(f => f.polygon);
  for (const e of sm.equipment || []) polys.push([[e.x - 50, e.z - 50], [e.x + 50, e.z + 50]]);
  fitTo(polys);
}
function pathPoly(poly, s) {
  ctx.beginPath();
  poly.forEach(([x, z], i) => { const [px, py] = toScreen(x, z, s); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
}

// layer colors (same rules as the G5 display: blue coverage, dark blue overlap, 10-step legend red -> green)
const RAMP = ['#c40b0b', '#dc3b1a', '#ec741c', '#f4a81e', '#f1d424', '#c7dc2c', '#8dc63a', '#55aa3b', '#2f8a31', '#1b6424'];
const LAYERS = {
  coverage: { label: 'Coverage' },
  yield: { label: 'Yield', good: 'high', conv: v => HU.yield(v, opCrop()), unit: () => HU.yieldUnit() },
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
const opMeta = () => (S.summary && S.summary.maps || []).find(o => o.id === S.layerOp) || {};
const opCrop = () => opMeta().product;
function rateUnit() {
  const u = opMeta().rateUnit;
  if (u === 'seeds/ac') return metric('rate') ? 'seeds/ha' : 'seeds/ac';
  if (u === 'lb/ac') return metric('rate') ? 'kg/ha' : 'lb/ac';
  return metric('volume') ? 'L/ha' : 'gal/ac';
}
function rateConv(v) {
  const u = opMeta().rateUnit;
  if (u === 'seeds/ac') return metric('rate') ? v * 2.47105 : v;
  if (u === 'lb/ac') return metric('rate') ? v * 1.12085 : v;
  return metric('volume') ? v : v * 0.106907;
}
let rangeCache = null;
function layerRange() {
  const L = LAYERS[S.layerKey];
  const key = S.layerKey + '|' + S.frames.length + '|' + JSON.stringify(settings.units) + '|' + (S.field || '');
  if (rangeCache && rangeCache.key === key) return rangeCache.r;
  let lo = Infinity, hi = -Infinity;
  const bb = fieldBox();
  for (const f of S.frames) {
    const v = f.v && f.v[S.layerKey];
    if (typeof v !== 'number') continue;
    if (bb && !inBox(f, bb)) continue;
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
function fieldBox() {
  const f = S.detail && S.detail.field;
  const b = f && f.boundaries.find(x => x.v === f.active);
  if (!b) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const m = 300;
  return { x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m };
}
const inBox = (f, b) => { const q = f.q[0]; return q && q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.z0 && q[1] <= b.z1; };

function draw() {
  requestAnimationFrame(draw);
  const s = size();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--map') || '#3f3b2b';
  ctx.fillRect(0, 0, s.w, s.h);
  const sm = S.summary;
  if (!sm) return;
  // grid every 100 m
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  const step = V.ppm > 0.6 ? 50 : 100;
  const [wx0, wz0] = toWorld(0, 0), [wx1, wz1] = toWorld(s.w / s.dpr, s.h / s.dpr);
  ctx.beginPath();
  for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) { const [px] = toScreen(x, 0, s); ctx.moveTo(px, 0); ctx.lineTo(px, s.h); }
  for (let z = Math.floor(wz0 / step) * step; z <= wz1; z += step) { const [, py] = toScreen(0, z, s); ctx.moveTo(0, py); ctx.lineTo(s.w, py); }
  ctx.stroke();

  // fields
  for (const f of sm.fields) {
    const owned = f.owner === undefined || f.owner === null || f.owner === (sm.farmId ?? 1) || f.owner === 1;
    pathPoly(f.polygon, s);
    ctx.fillStyle = owned ? 'rgba(120, 190, 90, .22)' : 'rgba(200, 200, 190, .10)'; ctx.fill();
    ctx.strokeStyle = f.id === S.field ? '#ffd200' : owned ? 'rgba(220, 240, 200, .75)' : 'rgba(220,220,210,.35)';
    ctx.lineWidth = (f.id === S.field ? 3 : 1.5) * s.dpr; ctx.stroke();
  }

  // coverage layer of the selected operation
  if (S.framesOp && S.frames.length) {
    const byColor = new Map(), bb = S.tab === 'field' ? fieldBox() : null;
    for (const f of S.frames) {
      if (bb && !inBox(f, bb)) continue;
      const c = frameColor(f) || '#4a7fd6';
      if (!byColor.has(c)) byColor.set(c, []);
      byColor.get(c).push(...f.q);
    }
    ctx.globalAlpha = 0.9;
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

  // field labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of sm.fields) {
    if (!f.center) continue;
    const [px, py] = toScreen(f.center.x, f.center.z, s);
    ctx.font = `700 ${13 * s.dpr}px Noto Sans, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(f.name, px + s.dpr, py + s.dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(f.name, px, py);
  }

  // boundary proposal from coverage
  if (S.proposal && S.proposal.polygon) {
    pathPoly(S.proposal.polygon, s);
    ctx.setLineDash([8 * s.dpr, 6 * s.dpr]); ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3 * s.dpr; ctx.stroke(); ctx.setLineDash([]);
  }

  // equipment
  for (const e of sm.equipment || []) {
    const [px, py] = toScreen(e.x, e.z, s), r = 8 * s.dpr;
    ctx.save(); ctx.translate(px, py); ctx.rotate((e.heading || 0) * Math.PI / 180);
    ctx.fillStyle = e.inUse ? '#ffd200' : e.motorOn ? '#8ff07c' : '#e8e6d6'; ctx.strokeStyle = '#1e1e1b'; ctx.lineWidth = 2 * s.dpr;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.5); ctx.lineTo(r, r); ctx.lineTo(0, r * 0.4); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (V.ppm > 0.35 || e.inUse) {
      ctx.font = `600 ${11 * s.dpr}px Noto Sans, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(e.name, px + r * 1.6, py);
    }
  }
}

// pan, zoom, tap
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
  V.cx = drag.cx - dx / V.ppm; V.cz = drag.cz - dy / V.ppm;
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
$('zoomFit').onclick = () => { if (S.tab === 'field' && S.detail) fitField(); else fitAll(); };

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
  if (S.pick) {                                          // create a field from coverage at this point
    S.pick = null; $('mapHint').hidden = true;
    try {
      const r = await api('/api/ops/from-coverage', { x, z });
      if (!r.proposal) return toast('No recorded coverage there.');
      S.proposal = { ...r.proposal, newField: true };
      renderWork();
      toast(`New field from coverage: ${area(r.proposal.areaHa)}. Save it from the Work list.`, 5000);
    } catch (e) { toast(e.message); }
    return;
  }
  const f = (S.summary && S.summary.fields || []).find(ff => inPoly(ff.polygon, x, z));
  if (f) openField(f.id);
}

// ---------------------------------------------------------------- data
async function refresh() {
  try {
    const sm = await api('/api/ops/summary');
    const first = !S.summary;
    S.summary = sm;
    $('saveName').textContent = sm.save === 'unsaved' ? 'Unsaved game' : sm.save;
    $('linkState').textContent = sm.link === 'live' ? 'Live' : sm.link === 'stale' ? 'Game paused' : 'Waiting for game';
    $('linkState').className = 'link ' + (sm.link === 'live' ? 'live' : 'down');
    if (first || (!V.fitted && sm.fields.length)) { fitAll(); V.fitted = sm.fields.length > 0; }
    if (sm.version !== S.version) { S.version = sm.version; if (S.field) loadField(S.field, false); }
    renderFields(); renderEquipment(); renderSettings();
    const mapsKey = (sm.maps || []).map(m => m.id).join('|');
    if (mapsKey !== S.mapsKey || S.tab === 'field') { S.mapsKey = mapsKey; renderLayerControls(); }
    if (S.tab === 'work') loadWork();
    syncFrames();
  } catch (e) {
    $('linkState').textContent = 'Bridge offline'; $('linkState').className = 'link down';
  }
}
// coverage frames of the selected operation, fetched incrementally
async function syncFrames() {
  const op = S.layerOp;
  if (!op) { S.frames = []; S.framesOp = null; return; }
  if (op !== S.framesOp) { S.frames = []; S.framesSeq = 0; S.framesOp = op; S.overlap = null; }
  const meta = opMeta();
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

// ---------------------------------------------------------------- views
function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (tab === 'field' ? 'fields' : tab)));
  ['fields', 'field', 'work', 'equipment', 'settings'].forEach(v => { $('view-' + v).hidden = v !== tab; });
  if (tab !== 'field') { S.field = null; S.detail = null; S.proposal = S.proposal && S.proposal.newField ? S.proposal : null; }
  if (tab === 'work') loadWork();
  renderLayerControls();
}
$('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
$('fieldSearch').oninput = e => { S.search = e.target.value.toLowerCase(); renderFields(); };

function renderFields() {
  const sm = S.summary;
  if (!sm) return;
  const list = sm.fields.filter(f => !S.search || String(f.name).toLowerCase().includes(S.search) || String(f.id).includes(S.search));
  $('fieldCount').textContent = `${sm.fields.length} fields · ${area(sm.fields.reduce((a, f) => a + (f.areaHa || 0), 0))}`;
  setHtml($('fieldList'), list.length ? list.map(f => `
    <div class="row ${f.id === S.field ? 'on' : ''}" data-field="${esc(f.id)}">
      <b>${esc(f.name)}<span class="badge ${f.source}">${SOURCE[f.source] || f.source}</span>${f.owner === 0 ? '<span class="badge unowned">Not owned</span>' : ''}</b>
      <span class="num">${area(f.areaHa)}</span>
      <span class="sub">${f.versions > 1 ? `${f.versions} boundary versions` : '1 boundary'}${f.farmland ? ` · Farmland ${f.farmland}` : ''}</span>
    </div>`).join('')
    : `<p class="empty">${sm.settings && sm.settings.importGame === false
      ? 'No fields yet. Drive a field edge with the Boundary app on the G5 display (Menu > Applications > Boundary), or create a field from coverage on the Work tab.'
      : 'Waiting for the game to send its fields.'}</p>`);
}
$('fieldList').onclick = e => { const r = e.target.closest('[data-field]'); if (r) openField(r.dataset.field); };

async function openField(id) {
  S.field = String(id); S.proposal = null;
  showTab('field');
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
  } catch (e) { toast(e.message); showTab('fields'); }
}
function fitField() {
  const f = S.detail && S.detail.field, b = f && f.boundaries.find(x => x.v === f.active);
  if (b) fitTo([b.polygon].concat(S.proposal && S.proposal.polygon ? [S.proposal.polygon] : []));
}
function recordValues(r) {
  const a = r.avg || {}, out = [];
  const L = (k, d) => { const def = LAYERS[k]; if (typeof a[k] !== 'number') return; const prev = S.layerOp; S.layerOp = r.op;
    const v = def.conv ? def.conv(a[k]) : a[k]; const u = def.unit(); S.layerOp = prev; out.push(`${def.label} ${fmt(v, d)} ${u}`.trim()); };
  if (r.kind === 'harvest') { L('yield', metric('grain') ? 2 : 1); L('moisture', 1); L('loss', 2); }
  if (r.kind === 'seeding') { L('rate', 0); L('singulation', 1); L('skips', 2); L('doubles', 2); L('soilMoisture', 0); }
  if (r.kind === 'application') L('rate', 1);
  L('speed', 1);
  return out.join(' · ');
}
function renderField() {
  const d = S.detail;
  if (!d) return;
  const f = d.field, b = f.boundaries.find(x => x.v === f.active);
  const recs = d.records;
  const html = `
    <h2>${esc(f.name)}</h2>
    <div class="meta">${f.game ? `Map field ${esc(f.id)}` : 'Custom field'}${f.farmland ? ` · Farmland ${f.farmland}` : ''}${f.owner === 0 ? ' · not owned' : ''}</div>
    <div class="kpis">
      <div class="kpi"><small>Area</small><b>${area(b && b.areaHa)}</b></div>
      <div class="kpi"><small>Boundary</small><b>${b ? SOURCE[b.source] : '---'}</b></div>
      <div class="kpi"><small>Operations</small><b>${new Set(recs.map(r => r.op)).size}</b></div>
    </div>
    <h3>Boundaries</h3>
    ${[...f.boundaries].reverse().map(x => `
      <label class="ver"><input type="radio" name="ver" value="${x.v}" ${x.v === f.active ? 'checked' : ''}>
        <b>Version ${x.v} <span class="badge ${x.source}">${SOURCE[x.source] || x.source}</span></b>
        <span>${area(x.areaHa)}</span>
        <span class="sub">${dateTxt(x.at)}${x.note ? ' · ' + esc(x.note) : ''}${x.source !== 'game' ? ` · <a href="#" data-remove="${x.v}">delete</a>` : ''}</span>
      </label>`).join('')}
    <div class="actions">
      <button class="btn" id="expandBtn">Expand from coverage</button>
    </div>
    ${S.proposal && !S.proposal.newField ? `
      <div class="proposal">Proposed boundary from coverage: ${area(S.proposal.areaHa)} (${S.proposal.addedHa >= 0 ? '+' : ''}${area(S.proposal.addedHa)}).
        <div class="actions"><button class="btn primary" id="propSave">Save as new version</button><button class="btn" id="propDrop">Discard</button></div></div>` : ''}
    <p class="note">To drive the edge instead, use the Boundary app on the G5 display (Menu > Applications > Boundary) while in this field.
      The newest driven or coverage boundary is used unless you pick a version above.</p>
    <h3>Work records</h3>
    ${recs.length ? `<table class="rec"><tr><th>Operation</th><th>Days</th><th class="n">Covered</th><th class="n">Overlap</th></tr>
      ${recs.map(r => `<tr><td><b>${esc(r.title)}</b><br><span class="note">${esc(recordValues(r))}</span></td><td>${dayTxt(r.firstDay)}${r.lastDay !== r.firstDay ? ' – ' + dayTxt(r.lastDay) : ''}</td>
        <td class="n">${area(r.coveredHa)}</td><td class="n">${area(r.overlapHa)}</td></tr>`).join('')}</table>`
      : '<p class="empty">No work recorded in this field yet.</p>'}`;
  setHtml($('fieldDetail'), html);
  $('expandBtn').onclick = async () => {
    try {
      const r = await api('/api/ops/from-coverage', { fieldId: f.id });
      if (!r.proposal) return toast('No recorded coverage around this field.');
      S.proposal = r.proposal; renderField(); fitField();
    } catch (e) { toast(e.message); }
  };
  if ($('propSave')) $('propSave').onclick = async () => {
    try { await api('/api/ops/boundary', { fieldId: f.id, source: 'coverage', polygon: S.proposal.polygon, note: 'Expanded from coverage' }); S.proposal = null; toast('Boundary saved.'); refresh(); }
    catch (e) { toast(e.message); }
  };
  if ($('propDrop')) $('propDrop').onclick = () => { S.proposal = null; renderField(); };
  $('fieldDetail').querySelectorAll('input[name=ver]').forEach(r => { r.onchange = async () => {
    try { await api('/api/ops/active', { fieldId: f.id, v: +r.value }); refresh(); } catch (e) { toast(e.message); } }; });
  $('fieldDetail').querySelectorAll('[data-remove]').forEach(a => { a.onclick = async ev => {
    ev.preventDefault();
    if (!confirm(`Delete boundary version ${a.dataset.remove} of ${f.name}?`)) return;
    try { await api('/api/ops/remove-boundary', { fieldId: f.id, v: +a.dataset.remove }); refresh(); } catch (e) { toast(e.message); } }; });
}
$('fieldBack').onclick = () => showTab('fields');
$('fieldRename').onclick = async () => {
  const f = S.detail && S.detail.field;
  if (!f) return;
  const name = prompt('Field name', f.name);
  if (!name) return;
  try { await api('/api/ops/rename', { fieldId: f.id, name }); refresh(); } catch (e) { toast(e.message); }
};

// layer controls on the map (operation + layer)
function renderLayerControls() {
  const sm = S.summary;
  const ops = S.tab === 'field' && S.detail ? [...new Set(S.detail.records.map(r => r.op))] : (sm && sm.maps || []).map(o => o.id);
  if (S.tab !== 'field' && !ops.includes(S.layerOp)) S.layerOp = (sm && sm.maps && sm.maps[0] && sm.maps[0].id) || null;
  $('mapLayer').hidden = !ops.length;
  const maps = (sm && sm.maps) || [];
  setHtml($('layerOp'), ops.map(id => `<option value="${esc(id)}" ${id === S.layerOp ? 'selected' : ''}>${esc((maps.find(m => m.id === id) || {}).title || id)}</option>`).join(''));
  const meta = maps.find(m => m.id === S.layerOp) || { values: [] };
  const keys = ['coverage'].concat((meta.values || []).filter(k => LAYERS[k]));
  if (!keys.includes(S.layerKey)) S.layerKey = 'coverage';
  setHtml($('layerKey'), keys.map(k => `<option value="${k}" ${k === S.layerKey ? 'selected' : ''}>${LAYERS[k].label}</option>`).join(''));
  renderLegend();
}
$('layerOp').onchange = e => { S.layerOp = e.target.value; rangeCache = null; renderLayerControls(); syncFrames(); };
$('layerKey').onchange = e => { S.layerKey = e.target.value; rangeCache = null; renderLegend(); };
function renderLegend() {
  if (!S.framesOp) { $('mapLegend').hidden = true; return; }
  $('mapLegend').hidden = false;
  if (S.layerKey === 'coverage') {
    setHtml($('mapLegend'), `<b>Coverage</b><div class="lg"><i style="background:#4a7fd6"></i>Covered</div><div class="lg"><i style="background:#16307f"></i>Overlap</div>`);
    return;
  }
  const L = LAYERS[S.layerKey], r = layerRange();
  if (!r) { setHtml($('mapLegend'), `<b>${L.label}</b>No data`); return; }
  let rows = '';
  for (let i = r.n - 1; i >= 0; i--) {
    const a = r.lo + i * r.step, d = r.step < 1 ? (r.step < 0.1 ? 2 : 1) : 0;
    rows += `<div class="lg"><i style="background:${colorIdx(i, r.n, L.good)}"></i>${fmt(a, d)} – ${fmt(a + r.step, d)}</div>`;
  }
  setHtml($('mapLegend'), `<b>${L.label} ${esc(L.unit())}</b>${rows}`);
}

// work records (all fields)
async function loadWork() {
  try {
    const r = await api('/api/ops/records');
    S.work = r.records; renderWork();
  } catch (e) { /* offline */ }
}
function renderWork() {
  const recs = S.work || [];
  $('workCount').textContent = `${recs.length} records`;
  const prop = S.proposal && S.proposal.newField ? `
    <div class="proposal" style="margin:10px 14px">New field from coverage: ${area(S.proposal.areaHa)}
      <div class="actions"><button class="btn primary" id="newSave">Save as new field</button><button class="btn" id="newDrop">Discard</button></div></div>` : '';
  setHtml($('workList'), prop + (recs.length ? recs.map(r => `
    <div class="row" ${r.field ? `data-field="${esc(r.field)}"` : ''}>
      <b>${esc(r.title)}</b><span class="num">${r.field ? area(r.coveredHa) : area(r.swathHa)}</span>
      <span class="sub">${esc(r.fieldName)} · ${dayTxt(r.firstDay)}${r.lastDay !== r.firstDay ? ' – ' + dayTxt(r.lastDay) : ''}${recordValues(r) ? ' · ' + esc(recordValues(r)) : ''}</span>
      ${r.field ? '' : '<span class="sub"><button class="btn" data-pick="1">Create field from this coverage</button></span>'}
    </div>`).join('') : '<p class="empty">No work recorded in this savegame yet.</p>'));
  if ($('newSave')) $('newSave').onclick = async () => {
    const name = prompt('Name for the new field', 'New Field');
    if (!name) return;
    try { await api('/api/ops/boundary', { name, newField: true, source: 'coverage', polygon: S.proposal.polygon, note: 'Created from coverage' }); S.proposal = null; toast('Field created.'); refresh(); loadWork(); }
    catch (e) { toast(e.message); }
  };
  if ($('newDrop')) $('newDrop').onclick = () => { S.proposal = null; renderWork(); };
}
$('workList').onclick = e => {
  if (e.target.closest('[data-pick]')) {
    S.pick = true; $('mapHint').hidden = false; $('mapHint').textContent = 'Tap the covered ground of the new field';
    return;
  }
  const r = e.target.closest('[data-field]');
  if (r) openField(r.dataset.field);
};

// equipment
function renderEquipment() {
  const sm = S.summary;
  const list = (sm && sm.equipment) || [];
  $('equipCount').textContent = `${list.length} machines`;
  const fieldName = id => { const f = sm.fields.find(x => String(x.id) === String(id)); return f ? f.name : id ? `Field ${id}` : null; };
  setHtml($('equipList'), list.length ? list.map(e => `
    <div class="row" data-eq="${esc(e.id)}">
      <b>${esc(e.name)}<span class="badge ${e.inUse ? 'inuse' : e.ai ? 'ai' : 'parked'}">${e.inUse ? 'In use' : e.ai ? 'AI worker' : e.motorOn ? 'Running' : 'Parked'}</span></b>
      <span class="num">${typeof e.fuelPct === 'number' ? fmt(e.fuelPct, 0) + ' % fuel' : ''}</span>
      <span class="sub">${esc(e.kind)}${fieldName(e.field) ? ' · ' + esc(fieldName(e.field)) : ''}${typeof e.hours === 'number' ? ` · ${fmt(e.hours, 1)} h` : ''}${typeof e.damage === 'number' ? ` · condition ${fmt(100 - e.damage, 0)} %` : ''}${e.speed > 0.5 ? ` · ${fmt(U.speed(e.speed), 1)} ${U.speedUnit()}` : ''}</span>
      ${e.implements && e.implements.length ? `<span class="sub">${esc(e.implements.join(', '))}</span>` : ''}
    </div>`).join('') : '<p class="empty">No machines reported yet.</p>');
}
$('equipList').onclick = e => {
  const r = e.target.closest('[data-eq]');
  const m = r && (S.summary.equipment || []).find(x => x.id === r.dataset.eq);
  if (m) { V.cx = m.x; V.cz = m.z; V.ppm = Math.max(V.ppm, 1.2); }
};

// settings
function renderSettings() {
  const sm = S.summary;
  if (!sm) return;
  const imp = !(sm.settings && sm.settings.importGame === false);
  setHtml($('settingsBody'), `
    <div class="set-row"><div><b>Import field boundaries from the game map</b>
      <p>On: every map field is available right away. Off: fields exist only once you drive their edge or create them from coverage.
      Setting for this savegame (${esc(sm.save)}).</p></div>
      <div class="switch" data-set="importGame"><button data-v="1" class="${imp ? 'on' : ''}">On</button><button data-v="0" class="${imp ? '' : 'on'}">Off</button></div></div>
    <div class="set-row"><div><b>Units</b><p>Shared with the G5 display on this device. Per-unit settings are on the display (Menu > System > Unit Settings).</p></div>
      <div class="switch" data-units="1"><button data-v="metric" class="${unitPreset() === 'metric' ? 'on' : ''}">Metric</button><button data-v="imperial" class="${unitPreset() === 'imperial' ? 'on' : ''}">US</button></div></div>`);
}
$('settingsBody').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.closest('[data-set]')) {
    try { await api('/api/ops/settings', { importGame: b.dataset.v === '1' }); refresh(); } catch (err) { toast(err.message); }
  } else if (b.closest('[data-units]')) {
    UNIT_KINDS.forEach(([k]) => { settings.units[k] = b.dataset.v; }); saveSettings(); rangeCache = null;
    renderSettings(); renderFields(); renderEquipment(); renderField(); renderLegend();
  }
};

// the display in the same browser may change units: follow along
window.addEventListener('storage', ev => {
  if (ev.key !== 'g5link') return;
  try { Object.assign(settings, JSON.parse(ev.newValue || '{}')); } catch (e) { return; }
  rangeCache = null; renderFields(); renderEquipment(); renderSettings(); renderField(); renderLegend();
});

refresh();
setInterval(refresh, 3000);
requestAnimationFrame(draw);

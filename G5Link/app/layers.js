'use strict';
// G5Link map layers: keeps the recorded coverage of one operation in sync with the bridge
// (bridge/coverage.js), defines the layers and their colors, and runs the Map Legend and the
// Select Map View window. guidance.js draws what this provides.
//
// G5 behaviour followed (Deere help center, mapping): coverage is blue for one pass and dark blue
// for more than one; value layers use a 10-step legend set from the data; maps are per operation.

(function () {
  const M = Object.assign({ op: 'auto', layer: 'coverage', legend: true }, settings.map || {});
  settings.map = M;
  const save = () => { settings.map = M; saveSettings(); };

  // 10 legend colors, worst to best (red, orange, yellow, light green, dark green as on the G5 yield map)
  const RAMP = ['#c40b0b', '#dc3b1a', '#ec741c', '#f4a81e', '#f1d424', '#c7dc2c', '#8dc63a', '#55aa3b', '#2f8a31', '#1b6424'];
  const COVER = '#4a7fd6', OVER = '#16307f';
  const crop = () => (data.rh && data.rh.crop && data.rh.crop !== '--') ? data.rh.crop : data.combine && data.combine.crop;

  function rateUnit(meta) {
    const u = meta && meta.rateUnit;
    if (u === 'seeds/ac') return metric('rate') ? 'seeds/ha' : 'seeds/ac';
    if (u === 'lb/ac') return metric('rate') ? 'kg/ha' : 'lb/ac';
    return metric('volume') ? 'L/ha' : 'gal/ac';
  }
  function rateConv(v, meta) {
    const u = meta && meta.rateUnit;
    if (u === 'seeds/ac') return metric('rate') ? v * 2.47105 : v;
    if (u === 'lb/ac') return metric('rate') ? v * 1.12085 : v;
    return metric('volume') ? v : v * 0.106907;
  }
  const pct = { unit: () => '%', conv: v => v, digits: 1 };
  // good: which end of the scale is best ('high', 'low'), or 'none' for a plain gradient
  const LAYERS = [
    { id: 'coverage', label: () => 'Coverage' },
    { id: 'yield', key: 'yield', kinds: ['harvest'], good: 'high', label: () => 'Yield',
      unit: () => HU.yieldUnit(), conv: v => HU.yield(v, crop()), digits: () => metric('grain') ? 1 : 0 },
    { id: 'moisture', key: 'moisture', kinds: ['harvest'], good: 'low', label: () => 'Moisture', ...pct },
    { id: 'loss', key: 'loss', kinds: ['harvest'], good: 'low', label: () => 'Grain Loss', ...pct, digits: 2 },
    { id: 'rate', key: 'rate', kinds: ['seeding', 'application'], good: 'none',
      label: meta => meta && meta.kind === 'seeding' ? 'Seeding Rate' : 'Applied Rate',
      unit: meta => rateUnit(meta), conv: (v, meta) => rateConv(v, meta), digits: () => 0 },
    { id: 'singulation', key: 'singulation', kinds: ['seeding'], good: 'high', label: () => 'Singulation', ...pct },
    { id: 'skips', key: 'skips', kinds: ['seeding'], good: 'low', label: () => 'Skips', ...pct, digits: 2 },
    { id: 'doubles', key: 'doubles', kinds: ['seeding'], good: 'low', label: () => 'Doubles', ...pct, digits: 2 },
    { id: 'cv', key: 'cv', kinds: ['seeding'], good: 'low', label: () => 'Distribution CV', ...pct },
    { id: 'depth', key: 'depth', kinds: ['seeding'], good: 'none', label: () => 'Seed Depth',
      unit: () => metric('distance') ? 'mm' : 'in', conv: v => metric('distance') ? v : v / 25.4, digits: () => metric('distance') ? 0 : 2 },
    { id: 'soilMoisture', key: 'soilMoisture', kinds: ['seeding'], good: 'none', label: () => 'Soil Moisture', ...pct },
    { id: 'compaction', key: 'compaction', good: 'low', label: () => 'Compaction', ...pct },
    { id: 'yieldPotential', key: 'yieldPotential', kinds: ['seeding'], good: 'high', label: () => 'Yield Potential', ...pct },
    { id: 'speed', key: 'speed', good: 'none', label: () => 'Speed', unit: () => U.speedUnit(), conv: v => U.speed(v), digits: () => 1 },
    { id: 'soilN', key: 'soilN', good: 'high', label: () => 'Soil Nitrogen', unit: () => '', conv: v => v, digits: () => 0 },
    { id: 'soilP', key: 'soilP', good: 'high', label: () => 'Soil Phosphorus', unit: () => '', conv: v => v, digits: () => 0 },
    { id: 'soilK', key: 'soilK', good: 'high', label: () => 'Soil Potassium', unit: () => '', conv: v => v, digits: () => 0 },
    { id: 'soilPH', key: 'soilPH', good: 'none', label: () => 'Soil pH', unit: () => '', conv: v => v, digits: () => 1 },
  ];
  const digitsOf = (L) => typeof L.digits === 'function' ? L.digits() : (L.digits ?? 1);

  // ---------------------------------------------------------------- sync with the bridge
  const S = { save: undefined, op: null, seq: 0, frames: [], overlap: { runs: [], cell: 1 }, ovVer: -1, ops: [], meta: {},
    busy: false, lastFetch: 0, version: 0, range: null, opsKey: '' };

  function effectiveOp(m) {
    const ids = Object.keys(m.ops || {});
    if (M.op !== 'auto' && ids.includes(M.op)) return M.op;
    if (m.current && ids.includes(m.current)) return m.current;
    if (S.op && ids.includes(S.op)) return S.op;
    return ids[0] || null;
  }
  function resetOp(op) {
    S.op = op; S.seq = 0; S.frames = []; S.ovVer = -1; S.overlap = { runs: [], cell: 1 }; S.range = null; S.meta = {}; S.version++;
  }
  async function refreshOps() {
    try {
      const r = await (await fetch('/api/map/ops')).json();
      S.ops = r.ops || [];
      const cur = S.ops.find(o => o.id === S.op);
      if (cur) S.meta = { ...cur, ...S.meta };
      renderLegend();
    } catch (e) { /* bridge restarting */ }
  }
  async function sync(op, seq, ov) {
    S.busy = true; S.lastFetch = Date.now();
    try {
      for (let guard = 0; S.seq < seq && guard < 50; guard++) {
        const r = await (await fetch(`/api/map/frames?op=${encodeURIComponent(op)}&since=${S.seq}`)).json();
        if (S.op !== op) return;
        if (r.meta) S.meta = { ...S.meta, ...r.meta };
        for (const f of r.frames) S.frames.push(f);
        S.seq = r.frames.length ? r.frames[r.frames.length - 1].s : r.seq;
        S.range = null; S.version++;
        if (!r.more) break;
      }
      if (ov !== S.ovVer) {
        const o = await (await fetch(`/api/map/overlap?op=${encodeURIComponent(op)}`)).json();
        if (S.op === op) { S.overlap = o; S.ovVer = o.version; S.version++; }
      }
    } catch (e) { /* retried on the next frame */ } finally { S.busy = false; renderLegend(); }
  }
  function onTelemetry(d) {
    const m = d.map;
    if (!m) return;
    if (m.save !== S.save) { S.save = m.save; resetOp(null); }
    const opsKey = Object.keys(m.ops || {}).sort().join('|');
    const op = effectiveOp(m);
    if (op !== S.op) { resetOp(op); refreshOps(); }
    else if (opsKey !== S.opsKey) refreshOps();
    S.opsKey = opsKey;
    if (!op) { renderLegend(); return; }
    const [seq, ov] = m.ops[op] || [0, 0];
    if (seq < S.seq) resetOp(op);                        // the bridge restarted or the map was cleared
    if (!S.busy && (seq > S.seq || ov !== S.ovVer) && Date.now() - S.lastFetch > 400) sync(op, seq, ov);
  }

  // ---------------------------------------------------------------- layers and colors
  function availableLayers(meta = S.meta) {
    const have = new Set((meta && meta.values) || []);
    return LAYERS.filter(L => L.id === 'coverage' || (have.has(L.key) && (!L.kinds || L.kinds.includes(meta.kind))));
  }
  function layer() {
    const list = availableLayers();
    return list.find(L => L.id === M.layer) || list[0] || LAYERS[0];
  }
  function niceStep(span) {
    const raw = span / 10, p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  // 10 legend steps from the data (display units)
  function range() {
    const L = layer();
    const key = L.id + '|' + S.version + '|' + JSON.stringify(settings.units);
    if (S.range && S.range.key === key) return S.range;
    let lo = Infinity, hi = -Infinity;
    if (L.key) {
      for (const f of S.frames) {
        const v = f.v && f.v[L.key];
        if (typeof v !== 'number') continue;
        const x = L.conv(v, S.meta);
        if (x < lo) lo = x; if (x > hi) hi = x;
      }
    }
    let r = null;
    if (lo <= hi) {
      if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
      const step = niceStep(hi - lo), start = Math.floor(lo / step) * step;
      r = { lo: start, step, n: Math.min(10, Math.max(1, Math.ceil((hi - start) / step))) };
    }
    S.range = { key, r };
    return S.range;
  }
  function colorIndex(i, n, good) {
    const t = n <= 1 ? 1 : i / (n - 1);
    const k = Math.round((good === 'low' ? 1 - t : t) * 9);
    return RAMP[Math.max(0, Math.min(9, k))];
  }
  // fill color of a recorded frame for the current layer (null = no value: drawn as plain coverage)
  function colorOf(f) {
    const L = layer();
    if (!L.key) return COVER;
    const v = f.v && f.v[L.key];
    if (typeof v !== 'number') return null;
    const { r } = range();
    if (!r) return null;
    const i = Math.max(0, Math.min(r.n - 1, Math.floor((L.conv(v, S.meta) - r.lo) / r.step)));
    return colorIndex(i, r.n, L.good);
  }

  // ---------------------------------------------------------------- Map Legend
  function renderLegend() {
    const L = layer();
    $('mapCrop').textContent = L.label(S.meta);
    $('mapLegend').hidden = !M.legend;
    $('mlLayer').textContent = L.label(S.meta);
    $('mlOp').textContent = S.meta && S.meta.title ? S.meta.title : 'No work recorded';
    const cur = S.ops.find(o => o.id === S.op);
    let rows = '';
    if (!L.key) {
      const a = cur ? fmt(U.areaFromHa(cur.areaHa), 2) : '---', o = cur ? fmt(U.areaFromHa(cur.overlapHa), 2) : '---';
      rows = `<div class="ml-row"><i style="background:${COVER}"></i><span>Coverage</span><b>${a}</b></div>
        <div class="ml-row"><i style="background:${OVER}"></i><span>Overlap</span><b>${o}</b></div>
        <div class="ml-unit">${U.areaUnit()}</div>`;
    } else {
      const { r } = range();
      if (!r) rows = '<div class="ml-none">No data yet</div>';
      else {
        const d = digitsOf(L);
        for (let i = r.n - 1; i >= 0; i--) {
          const a = r.lo + i * r.step, b = a + r.step;
          rows += `<div class="ml-row"><i style="background:${colorIndex(i, r.n, L.good)}"></i><span>${fmt(a, d)} – ${fmt(b, d)}</span></div>`;
        }
        rows += `<div class="ml-unit">${esc(L.unit(S.meta))}</div>`;
      }
    }
    setHtml($('mlRows'), rows);
    $('mlNew').disabled = !S.op;
  }
  $('mlNew').onclick = () => {
    if (!S.op) return;
    const name = (S.meta && S.meta.title) || 'this operation';
    confirmBox('New Work', `Start new work for ${name}? The recorded map for ${name} in this savegame is cleared.`, async () => {
      try {
        await fetch('/api/map/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: S.op }) });
        resetOp(null); refreshOps();
      } catch (e) { shade('Map not cleared: G5Link bridge unreachable', 'warn', 3000); }
    });
  };

  // ---------------------------------------------------------------- Select Map View window
  let draft = null, tab = 'op';
  function openSelect() {
    draft = { op: M.op, layer: M.layer, legend: M.legend };
    tab = 'op';
    refreshOps().then(renderSelect);
    renderSelect();
    openWin('layerWin');
  }
  function draftMeta() {
    if (draft.op === 'auto') return S.ops.find(o => o.id === (data.map && data.map.current)) || S.ops.find(o => o.id === S.op) || S.meta;
    return S.ops.find(o => o.id === draft.op) || S.meta;
  }
  function renderSelect() {
    if (!draft) return;
    const meta = draftMeta();
    const layers = availableLayers(meta);
    if (!layers.some(L => L.id === draft.layer)) draft.layer = 'coverage';
    const opTitle = draft.op === 'auto' ? 'Current Operation' : (S.ops.find(o => o.id === draft.op) || {}).title || '---';
    const L = layers.find(x => x.id === draft.layer) || LAYERS[0];
    const tabs = [['op', 'Operation', opTitle], ['layer', 'Primary Layer', L.label(meta)], ['legend', 'Map Legend', draft.legend ? 'Shown' : 'Hidden']];
    setHtml($('smvTabs'), tabs.map(([id, t, v]) => `<button class="smv-tab ${tab === id ? 'on' : ''}" data-tab="${id}"><b>${t}</b><span>${esc(v)}</span></button>`).join(''));
    let items;
    if (tab === 'op') {
      items = [['auto', 'Current Operation', 'Follows the machine']].concat(S.ops.map(o => [o.id, o.title, `${fmt(U.areaFromHa(o.areaHa), 2)} ${U.areaUnit()}`]))
        .map(([id, t, sub]) => `<button class="smv-item ${draft.op === id ? 'on' : ''}" data-op="${esc(id)}"><b>${esc(t)}</b><span>${esc(sub)}</span></button>`);
    } else if (tab === 'layer') {
      items = layers.map(x => `<button class="smv-item ${draft.layer === x.id ? 'on' : ''}" data-layer="${x.id}"><b>${esc(x.label(meta))}</b></button>`);
    } else {
      items = [['1', 'Show Map Legend'], ['0', 'Hide Map Legend']]
        .map(([v, t]) => `<button class="smv-item ${(draft.legend ? '1' : '0') === v ? 'on' : ''}" data-legend="${v}"><b>${t}</b></button>`);
    }
    setHtml($('smvList'), items.join('') || '<p class="hint">No recorded work yet.</p>');
  }
  $('smvTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderSelect(); } };
  $('smvList').onclick = e => {
    const b = e.target.closest('button'); if (!b || !draft) return;
    if (b.dataset.op !== undefined) { draft.op = b.dataset.op; tab = 'layer'; }        // auto-advance like the G5
    else if (b.dataset.layer !== undefined) { draft.layer = b.dataset.layer; tab = 'legend'; }
    else if (b.dataset.legend !== undefined) draft.legend = b.dataset.legend === '1';
    renderSelect();
  };
  $('smvCancel').onclick = () => { draft = null; closeWin('layerWin'); };
  $('smvOk').onclick = () => {
    if (!draft) return;
    const opChanged = draft.op !== M.op;
    Object.assign(M, draft); save(); draft = null; closeWin('layerWin');
    if (opChanged) resetOp(null);
    S.range = null; renderLegend();
  };
  $('mapLayers').onclick = openSelect;
  $('mapCrop').onclick = openSelect;

  window.G5Layers = {
    onTelemetry, colorOf, layer, renderLegend,
    frames: () => S.frames, overlap: () => S.overlap, version: () => S.version,
    COVER, OVER,
  };
  renderLegend();
})();

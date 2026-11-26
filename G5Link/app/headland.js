'use strict';
// G5Link display: Headland Management. Settings live in the bridge per savegame (/api/ops/headland); the
// bridge hands them with the field boundary and nearby coverage to the mod, which raises and lowers the
// implements and changes speed (scripts/Headland.lua). This file runs the window, the HEADLAND key state,
// the map chip, and the headland line drawn on the Guidance map.

(function () {
  const H = { cfg: null, status: null, at: 0, inner: null, innerKey: '' };
  async function load() {
    try { const r = await (await fetch('/api/ops/headland')).json(); H.cfg = r.headland; H.status = r.status; } catch (e) { /* offline */ }
    render();
  }
  async function save(patch) {
    try {
      const r = await fetch('/api/ops/headland', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'not saved');
      H.cfg = j.headland;
    } catch (e) { shade('Headland settings not saved: ' + e.message, 'warn', 3000); }
    render();
  }
  const ftOrM = m => metric('distance') ? `${fmt(m, 1)} m` : `${fmt(m * 3.28084, 0)} ft`;
  const spd = k => k > 0 ? `${fmt(U.speed(k), 1)} ${U.speedUnit()}` : '';
  const STATE = { off: 'Off', work: 'Working', headland: 'In headland', manual: 'Manual (lower to resume)', ai: 'AI worker driving',
    noImplement: 'No implement to raise', noSignal: 'Needs SF2 or better (StarFire)' };
  const SOURCE = { boundary: 'Field boundary', coverage: 'Previous passes', 'boundary+coverage': 'Boundary and previous passes',
    base: 'Steering assist line end', ev: 'Enhanced Vehicle headland', none: 'None found' };
  const live = () => data.headland || null;

  function render() {
    const c = H.cfg, st = H.status || {}, hl = live() || {};
    if ($('headlandWin').hidden) return;
    if (!c) { setHtml($('hlBody'), '<p class="hint win-loading">Loading headland settings…</p>'); return; }
    const fieldName = st.fieldName || (st.field ? `Field ${st.field}` : null);
    const fieldW = st.field && c.perField ? c.perField[st.field] : undefined;
    const seg = (key, opts, cur) => `<div class="seg hl-seg" data-hl="${key}">${opts.map(([v, t]) =>
      `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    setHtml($('hlBody'), `
      <div class="hl-status ${hl.state === 'headland' ? 'raised' : hl.armed ? 'armed' : ''}">
        <b>${esc(c.armed ? STATE[hl.state] || 'Armed' : 'Off')}</b>
        <span>${esc(fieldName || 'Not on a field')} · Headland ${ftOrM(st.width || 0)} · ${esc(SOURCE[hl.source] || '---')}</span>
        <span>${hl.steer ? (hl.steer === 'ev' ? 'Enhanced Vehicle' : 'Steering assist') + (hl.steerOn ? ' engaged' : ' off') : 'No steering helper'}${hl.dist !== undefined && c.armed ? ' · next ' + ftOrM(hl.dist) : ''}</span>
      </div>
      <div class="hl-top"><div>
      <div class="set-row"><span>Automation</span>${seg('armed', [[false, 'Off'], [true, 'Armed']], c.armed)}</div>
      <div class="set-row"><span>From</span><div class="hl-right">
        <button class="g5btn hl-chk ${c.useBoundary ? 'on' : ''}" data-tog="useBoundary">Boundary</button>
        <button class="g5btn hl-chk ${c.useCoverage ? 'on' : ''}" data-tog="useCoverage">Previous Passes</button></div></div>
      </div><div>
      <div class="set-row"><span>Width</span><div class="hl-right">
        ${seg('widthMode', [['distance', 'Distance'], ['passes', 'Passes']], c.widthMode)}
        <button class="g5btn hl-val" data-num="${c.widthMode === 'passes' ? 'passes' : 'width'}">${c.widthMode === 'passes' ? fmt(c.passes, 1) + ' passes' : ftOrM(c.width)}</button></div></div>
      <div class="set-row"><span>This Field</span><div class="hl-right">
        <em class="ws-note">${esc(fieldName || '---')}${fieldW !== undefined ? ': ' + ftOrM(fieldW) : ''}</em>
        <button class="g5btn hl-val" data-num="fieldWidth" ${st.field ? '' : 'disabled'}>Set</button>
        ${fieldW !== undefined ? '<button class="g5btn hl-val" data-clear="1">Clear</button>' : ''}</div></div>
      </div></div>
      <div class="hl-cols">
        <div><h4>Entering Headland</h4>
          <div class="set-row"><span>Raise</span><button class="g5btn hl-val" data-num="raiseLead">${fmt(c.raiseLead, 1)} s early</button></div>
          <div class="set-row"><span>Speed</span><div class="hl-right">${seg('headKeep', [[1, 'Keep'], [0, 'Set']], c.headSpeed > 0 ? 0 : 1)}
            ${c.headSpeed > 0 ? `<button class="g5btn hl-val" data-num="headSpeed">${spd(c.headSpeed)}</button>` : ''}</div></div></div>
        <div><h4>Leaving Headland</h4>
          <div class="set-row"><span>Lower</span>${seg('lowerMode', [['auto', 'Automatic'], ['steer', 'Steering On'], ['both', 'Either']], c.lowerMode)}</div>
          <div class="set-row"><span>Lead</span><button class="g5btn hl-val" data-num="lowerLead">${fmt(c.lowerLead, 1)} s early</button></div>
          <div class="set-row"><span>Speed</span><div class="hl-right">${seg('workKeep', [[1, 'Restore'], [0, 'Set']], c.workSpeed > 0 ? 0 : 1)}
            ${c.workSpeed > 0 ? `<button class="g5btn hl-val" data-num="workSpeed">${spd(c.workSpeed)}</button>` : ''}</div></div></div>
      </div>
      <p class="hint">Lead times allow for the hitch. Steering On lowers when base game steering assist or Enhanced Vehicle track
        steering is switched on. Raising by hand pauses automation until you lower again.</p>`);
  }

  const NUM = {
    width: () => [`Headland Width (${metric('distance') ? 'm' : 'ft'})`, v => ({ width: metric('distance') ? v : v / 3.28084 })],
    passes: () => ['Headland Passes', v => ({ passes: v })],
    fieldWidth: () => [`Headland Width, this field (${metric('distance') ? 'm' : 'ft'})`, v => ({ field: H.status && H.status.field, fieldWidth: metric('distance') ? v : v / 3.28084 })],
    raiseLead: () => ['Raise Lead Time (s)', v => ({ raiseLead: v })],
    lowerLead: () => ['Lower Lead Time (s)', v => ({ lowerLead: v })],
    headSpeed: () => [`Headland Speed (${U.speedUnit()})`, v => ({ headSpeed: metric('speed') ? v : v / 0.621371 })],
    workSpeed: () => [`Work Speed (${U.speedUnit()})`, v => ({ workSpeed: metric('speed') ? v : v / 0.621371 })],
  };
  $('hlBody').onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const seg = b.closest('[data-hl]');
    if (seg) {
      const k = seg.dataset.hl, v = b.dataset.v;
      if (k === 'armed') return save({ armed: v === 'true' });
      if (k === 'widthMode' || k === 'lowerMode') return save({ [k]: v });
      if (k === 'headKeep') return v === '1' ? save({ headSpeed: 0 }) : openNum('headSpeed');
      if (k === 'workKeep') return v === '1' ? save({ workSpeed: 0 }) : openNum('workSpeed');
    }
    if (b.dataset.tog) return save({ [b.dataset.tog]: !H.cfg[b.dataset.tog] });
    if (b.dataset.num) return openNum(b.dataset.num);
    if (b.dataset.clear) return save({ field: H.status && H.status.field, fieldWidth: null });
  };
  function openNum(k) { const [title, f] = NUM[k](); openNumpad(title, v => save(f(v))); }

  function open() { closeWin('menu'); openWin('headlandWin'); load(); }
  $('appHeadland').onclick = open;
  $('mapHl').onclick = open;

  // Inner headland line for the map: the boundary moved inward by the width (miter offset; drawing only).
  function innerLine() {
    const st = H.status, hl = live();
    if (!st || !st.armed || !st.boundary || !st.width || !window.G5Bounds) return null;
    const f = G5Bounds.fields().find(x => String(x.id) === String(st.field));
    if (!f || f.polygon.length < 3) return null;
    const key = f.id + ':' + f.v + ':' + st.width;
    if (key === H.innerKey) return H.inner;
    const P = f.polygon, n = P.length, w = st.width;
    let area = 0;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;            // inward normal side
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const n1 = norm(b[0] - a[0], b[1] - a[1]), n2 = norm(c[0] - b[0], c[1] - b[1]);
      const m1 = [-n1[1] * sgn, n1[0] * sgn], m2 = [-n2[1] * sgn, n2[0] * sgn];
      const bis = norm(m1[0] + m2[0], m1[1] + m2[1]);
      const cos = bis[0] * m1[0] + bis[1] * m1[1];
      const d = w / Math.max(0.35, cos);       // limit spikes at sharp corners
      out.push([b[0] + bis[0] * d, b[1] + bis[1] * d]);
    }
    H.inner = out; H.innerKey = key;
    return out;
    function norm(x, z) { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }
  }

  function onTelemetry(d) {
    if (d.headlandLink) H.status = d.headlandLink;
    if (!H.cfg && Date.now() - H.at > 5000) { H.at = Date.now(); load(); }
    const hl = d.headland, chip = $('mapHl');
    const armed = !!(hl && hl.armed);
    chip.hidden = !armed || d.state !== 'vehicle';
    if (armed) {
      chip.className = 'map-hl ' + (hl.state === 'headland' ? 'raised' : hl.state === 'manual' ? 'manual' : '');
      chip.innerHTML = `<b>${hl.state === 'headland' ? 'Headland' : hl.state === 'manual' ? 'Manual' : 'Headland Auto'}</b>` +
        `<span>${hl.dist !== undefined ? (hl.state === 'headland' ? 'Lower in ' : 'Raise in ') + ftOrM(hl.dist) : esc(STATE[hl.state] || '')}</span>`;
    }
    render();
  }

  window.G5Headland = { onTelemetry, innerLine, toggle: () => save({ armed: !(H.cfg && H.cfg.armed) }), open, cfg: () => H.cfg };
  load();
})();

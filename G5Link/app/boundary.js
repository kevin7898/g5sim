'use strict';
// G5Link display: Boundary app (record a field edge by driving it) and Ops Center field boundaries
// for the map. The bridge records the positions (POST /api/boundary) so nothing is lost if the iPad sleeps.

(function () {
  const B = { status: { active: false }, path: [], fields: [], fieldsVersion: -1, pathAt: 0, side: 'center', offset: null, target: 'this' };

  async function post(body) {
    const r = await fetch('/api/boundary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'not accepted');
    return j;
  }
  async function loadFields() {
    try { const r = await (await fetch('/api/ops/summary')).json(); B.fields = r.fields || []; render(); } catch (e) { /* offline */ }
  }
  async function loadPath() {
    B.pathAt = Date.now();
    try { const r = await (await fetch('/api/boundary')).json(); B.path = r.path || []; } catch (e) { /* offline */ }
  }

  const currentField = () => {
    const id = data.field ?? (data.vehicle && data.vehicle.field);
    if (id === null || id === undefined) return null;
    const f = B.fields.find(x => String(x.id) === String(id));
    return { id: String(id), name: f ? f.name : `Field ${id}` };
  };
  const implWidth = () => (data.implements || []).reduce((m, i) => Math.max(m, i.width || 0), 0);
  const lenTxt = m => metric('distance') ? (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, 0)} m`) : (m >= 1609 ? `${fmt(m / 1609.34, 2)} mi` : `${fmt(m * 3.28084, 0)} ft`);

  function onTelemetry(d) {
    const ops = d.ops || {};
    B.status = ops.boundary || { active: false };
    if (ops.fields !== undefined && ops.fields !== B.fieldsVersion) { B.fieldsVersion = ops.fields; loadFields(); }
    if (B.status.active && Date.now() - B.pathAt > 1500) loadPath();
    if (!B.status.active && B.path.length) B.path = [];
    render();
  }

  function render() {
    const st = B.status, cf = currentField();
    // map chip while recording
    $('mapRec').hidden = !st.active;
    if (st.active) $('mapRec').innerHTML = `<b>${st.paused ? 'Boundary paused' : 'Recording boundary'}</b><span>${lenTxt(st.length || 0)}${st.gap !== null ? ` · ${lenTxt(st.gap)} to start` : ''}</span>`;
    if ($('boundaryWin').hidden) return;
    const off = B.offset ?? +(implWidth() / 2).toFixed(2);
    const offTxt = metric('distance') ? `${fmt(off, 2)} m` : `${fmt(off * 3.28084, 1)} ft`;
    setHtml($('bdBody'), st.active ? `
      <div class="bd-state ${st.paused ? 'paused' : 'rec'}"><i></i><b>${st.paused ? 'Paused' : 'Recording'}</b>
        <span>${esc(st.name || (st.fieldId ? `Field ${st.fieldId}` : 'New field'))}</span></div>
      <div class="bd-grid">
        <div><small>Distance</small><b>${lenTxt(st.length || 0)}</b></div>
        <div><small>Back to start</small><b>${st.gap !== null ? lenTxt(st.gap) : '---'}</b></div>
        <div><small>Points</small><b>${st.points}</b></div>
        <div><small>Recording</small><b>${st.side === 'center' ? 'Center' : (st.side === 'left' ? 'Left' : 'Right') + ' edge'}</b></div>
      </div>
      <p class="hint">Drive the whole edge and finish near where you started. The line is closed automatically.</p>
      <div class="bd-actions">
        <button class="g5btn" data-bd="${st.paused ? 'resume' : 'pause'}">${st.paused ? 'Resume' : 'Pause'}</button>
        <button class="g5btn" data-bd="cancel">Cancel</button>
        <button class="g5btn smv-ok" data-bd="finish"><svg><use href="#i-check"/></svg>Finish &amp; Save</button>
      </div>` : `
      <div class="set-row"><span>Field</span><div class="seg" id="bdTarget">
        <button data-v="this" class="${B.target === 'this' ? 'on' : ''}" ${cf ? '' : 'disabled'}>${esc(cf ? cf.name : 'No field here')}</button>
        <button data-v="new" class="${B.target === 'new' || !cf ? 'on' : ''}">New Field</button></div></div>
      <div class="set-row"><span>Record</span><div class="seg" id="bdSide">
        <button data-v="left" class="${B.side === 'left' ? 'on' : ''}">Left Edge</button>
        <button data-v="center" class="${B.side === 'center' ? 'on' : ''}">Center</button>
        <button data-v="right" class="${B.side === 'right' ? 'on' : ''}">Right Edge</button></div></div>
      <div class="set-row"><span>Edge Offset</span><button class="g5btn" id="bdOffset" ${B.side === 'center' ? 'disabled' : ''}>${offTxt}</button></div>
      <p class="hint">${B.side === 'left' ? 'Drive with the field edge on your left; the edge is recorded at the offset.' : B.side === 'right' ? 'Drive with the field edge on your right; the edge is recorded at the offset.' : 'The center of the vehicle is recorded.'}
        Any vehicle works, a Gator or pickup included. The bridge records while you drive, even if this screen sleeps.</p>
      <div class="bd-actions"><button class="g5btn smv-ok" data-bd="start"><svg><use href="#i-check"/></svg>Start Recording</button></div>`);
  }

  $('bdBody').onclick = async e => {
    const seg = e.target.closest('.seg'), b = e.target.closest('button');
    if (!b) return;
    if (seg && seg.id === 'bdTarget') { B.target = b.dataset.v; render(); return; }
    if (seg && seg.id === 'bdSide') { B.side = b.dataset.v; render(); return; }
    if (b.id === 'bdOffset') {
      openNumpad(`Edge Offset (${metric('distance') ? 'm' : 'ft'})`, v => { B.offset = metric('distance') ? v : v / 3.28084; render(); });
      return;
    }
    const action = b.dataset.bd;
    if (!action) return;
    try {
      if (action === 'start') {
        const cf = currentField();
        const target = B.target === 'this' && cf ? cf : null;
        await post({ action, side: B.side, offset: B.side === 'center' ? 0 : (B.offset ?? implWidth() / 2), fieldId: target ? target.id : null });
        B.path = [];
      } else if (action === 'cancel') {
        confirmBox('Boundary', 'Cancel this recording? The driven line is discarded.', async () => { await post({ action }); render(); });
        return;
      } else {
        const r = await post({ action });
        if (action === 'finish' && r.saved) { shade(`Boundary saved (field ${r.saved.field}, version ${r.saved.v}).`, 'info', 4000); closeWin('boundaryWin'); loadFields(); }
      }
    } catch (err) { shade(err.message, 'warn', 4000); }
    render();
  };
  $('appBoundary').onclick = () => { closeWin('menu'); loadFields(); openWin('boundaryWin'); render(); };
  $('mapRec').onclick = () => { openWin('boundaryWin'); render(); };

  window.G5Bounds = { onTelemetry, fields: () => B.fields, path: () => B.path, recording: () => B.status.active };
  loadFields();
})();

'use strict';

(function () {
  const B = { status: { active: false }, path: [], preview: null, pathRevision: -1, pathAt: 0,
    fields: [], fieldsVersion: -1, side: 'center', reference: 'vehicle', offset: 0, target: 'this', name: '', tool: null, busy: false };

  async function loadFields() {
    try {
      const result = await (await fetch('/api/ops/summary')).json();
      if (result.save !== (data.game?.save || 'unsaved')) return;
      B.fields = result.fields || [];
      render();
    } catch (err) { /* offline */ }
  }

  function updateStatus(status) {
    if (status.recorderId === B.status.recorderId && status.revision < B.status.revision) return;
    if (status.draftId !== B.status.draftId || status.recorderId !== B.status.recorderId) {
      B.path = [];
      B.preview = null;
      B.pathRevision = -1;
      B.pathAt = 0;
    }
    B.status = status;
  }

  function readSnapshot(result) {
    const { path, preview, ...status } = result;
    updateStatus(status);
    if (status.recorderId === B.status.recorderId && status.draftId === B.status.draftId && status.revision >= B.pathRevision) {
      B.path = path;
      B.pathRevision = status.revision;
      if (B.status.mode === status.mode) B.preview = preview;
    }
  }

  async function loadPath() {
    B.pathAt = Date.now();
    const recorderId = B.status.recorderId;
    try {
      const result = await (await fetch('/api/boundary')).json();
      if (!Array.isArray(result.path) || B.status.recorderId !== recorderId && B.status.recorderId !== result.recorderId) return;
      readSnapshot(result);
      render();
    } catch (err) { /* retry on telemetry */ }
  }

  function currentField() {
    const work = data.workSetup;
    const id = work?.fieldMode === 'fixed' && work.fieldId != null ? work.fieldId : data.field ?? data.vehicle?.field;
    if (id == null) return null;
    const field = B.fields.find(f => String(f.id) === String(id));
    return field ? { id: String(id), name: field.name } : null;
  }

  const selectedTool = () => B.status.tools?.find(tool => tool.key === B.tool) || B.status.tools?.[0];
  const liveVehicle = () => !!B.status.recorderId && data.link === 'live' && data.state === 'vehicle'
    && Number.isFinite(data.vehicle?.x) && Number.isFinite(data.vehicle?.z);
  const gapText = gap => gap == null ? '—' : U.dist(gap);

  function onTelemetry(frame) {
    if (frame.ops?.boundary) updateStatus(frame.ops.boundary);
    if (frame.ops?.fields !== undefined && frame.ops.fields !== B.fieldsVersion) {
      B.fieldsVersion = frame.ops.fields;
      loadFields();
    }
    if (B.status.active && B.status.revision !== B.pathRevision && Date.now() - B.pathAt > 1000) loadPath();
    render();
  }

  function button(action, label, disabled = false, classes = '') {
    return `<button class="g5btn ${classes}" data-bd="${action}" ${disabled || B.busy ? 'disabled' : ''}>${label}</button>`;
  }

  function recordControls() {
    const st = B.status;
    const pause = st.paused ? button('resume', 'Resume', !st.cursor) : button('pause', 'Pause');
    return `${pause}${button('review', 'Review', !st.sameSave, 'smv-ok')}${button('cancel', 'Cancel')}`;
  }

  function editControls() {
    const st = B.status;
    return `${button('undo', 'Undo', !st.canUndo || !st.sameSave)}${button('redo', 'Redo', !st.canRedo || !st.sameSave)}`;
  }

  function referenceDiagram(side, offset, tool) {
    const span = tool ? 46 : 70;
    const arrowX = side === 'center' || !offset ? 88 : 88 + (side === 'left' ? -span : span);
    return `<svg class="bd-reference-diagram" viewBox="0 0 176 110" role="img" aria-label="${side} reference, ${U.width(offset)} from vehicle center">
      <path d="M88 10l-6 8h12Z" fill="currentColor"/>
      <rect x="78" y="26" width="20" height="38" rx="5" fill="#666f63"/>
      <path d="M73 33v8m30-8v8M72 51v12m32-12v12" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
      ${tool ? `<path d="M88 64v15m-46 0h92" fill="none" stroke="#8cbc73" stroke-width="4"/>` : ''}
      <path d="M88 23v73M88 94h${arrowX - 88}" stroke="#b9c0aa" stroke-dasharray="4 3"/>
      <path d="M${arrowX} 80v23" stroke="#ffbd68" stroke-width="3"/>
      <circle cx="${arrowX}" cy="94" r="4" fill="#ffdc9f"/>
    </svg>`;
  }

  function setupPane() {
    const field = currentField();
    const tool = selectedTool();
    const newField = B.target === 'new' || !field;
    const useImplement = B.reference === 'implement';
    const offset = B.side === 'center' ? 0 : useImplement ? (tool?.width || 0) / 2 : B.offset;
    return `
      <div class="bd-setup"><div>
      <div class="set-row"><span>Field</span><div class="seg" id="bdTarget">
        <button data-v="this" class="${!newField ? 'on' : ''}" ${field ? '' : 'disabled'}>${esc(field?.name || 'No field here')}</button>
        <button data-v="new" class="${newField ? 'on' : ''}">New Field</button></div></div>
      ${newField ? '<label class="set-row" for="bdName"><span>Name</span><input id="bdName" maxlength="60" placeholder="New field name (optional)"></label>' : ''}
      <div class="set-row"><span>Reference</span><div class="seg" id="bdReference">
        <button data-v="vehicle" class="${useImplement ? '' : 'on'}">Vehicle</button>
        <button data-v="implement" class="${useImplement ? 'on' : ''}" ${tool ? '' : 'disabled'}>Implement Edge</button></div></div>
      <div class="set-row"><span>Record</span><div class="seg" id="bdSide">
        <button data-v="left" class="${B.side === 'left' ? 'on' : ''}">Left</button>
        <button data-v="center" class="${B.side === 'center' ? 'on' : ''}" ${useImplement ? 'disabled' : ''}>Center</button>
        <button data-v="right" class="${B.side === 'right' ? 'on' : ''}">Right</button></div></div>
      ${useImplement && tool ? `<label class="set-row" for="bdTool"><span>Implement</span><select id="bdTool" ${B.status.tools.length === 1 ? 'disabled' : ''}>${B.status.tools.map(choice =>
        `<option value="${esc(choice.key)}" ${choice.key === tool.key ? 'selected' : ''}>${esc(choice.name)} · ${U.width(choice.width)}</option>`).join('')}</select></label>` : ''}
      <div class="set-row"><span>Lateral Offset</span>${useImplement || B.side === 'center' ? `<b>${tool || !useImplement ? U.width(offset) : '—'}</b>`
        : `<button class="g5btn" id="bdOffset" aria-label="Set lateral offset, ${U.width(offset)}">${U.width(offset)}</button>`}</div>
      </div><div class="bd-reference">${referenceDiagram(B.side, offset, useImplement && tool)}<b>${useImplement ? 'Working edge' : 'Vehicle reference'}</b></div></div>
      <p class="hint">${data.link === 'live' && !B.status.recorderId ? 'Update the bridge to use reviewed boundary recording.'
        : !liveVehicle() ? 'Enter a vehicle with a live connection to start.' : useImplement
        ? tool ? 'The displayed half-width is fixed for this recording.' : 'Attach a working implement or switch to Vehicle.'
        : 'Record the vehicle center or set a left or right offset from it.'}</p>
      <div class="bd-actions">${button('start', 'Start Recording', !liveVehicle() || useImplement && !tool, 'smv-ok')}</div>`;
  }

  const pauseReasons = {
    save: 'Return to the savegame where recording started to continue this draft.',
    link: 'Recording paused while waiting for live game data.',
    vehicle: 'Return to the vehicle that started the recording.',
    position: 'Wait for a live position and heading before resuming.',
    restart: 'Recording paused because the game session restarted.',
    jump: 'Recording paused after a jump in vehicle position.',
  };

  function recordingPane(label) {
    const st = B.status;
    const side = st.side === 'center' ? 'Center' : `${st.side === 'left' ? 'Left' : 'Right'} · ${U.width(st.offset)}`;
    return `<div class="bd-state ${st.paused ? 'paused' : 'rec'}"><i></i><b>${st.paused ? 'Paused' : 'Recording'}</b><span>${label}</span></div>
      <div class="bd-grid">
        <div><small>Distance</small><b id="bdDistance"></b></div>
        <div><small>Back to start</small><b id="bdGap"></b></div>
        <div><small>Reference</small><b title="${esc(st.tool?.name || 'Vehicle')}">${st.reference === 'implement' ? 'Implement edge' : 'Vehicle'}</b></div>
        <div><small>Offset</small><b>${side}</b></div>
      </div>
      <p class="hint">${pauseReasons[st.pauseReason] || (st.paused ? 'Resume joins the last recorded point to your current position.'
        : 'Return to the start of the boundary, then review the outline.')}</p>
      <div class="bd-edit">
        <div class="bd-actions">${editControls()}</div>
        <div class="bd-actions">${recordControls()}</div>
      </div>`;
  }

  function outlineMap(outline, valid, problemSegments) {
    if (!outline.length) return '<div class="bd-empty-map">No outline recorded</div>';
    const width = 640, height = 220, pad = 20;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of outline) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const scale = Math.min((width - 2 * pad) / Math.max(1, maxX - minX), (height - 2 * pad) / Math.max(1, maxZ - minZ));
    const middleX = (minX + maxX) / 2, middleZ = (minZ + maxZ) / 2;
    const project = ([x, z]) => [(width / 2 + (x - middleX) * scale).toFixed(1), (height / 2 + (z - middleZ) * scale).toFixed(1)];
    const coords = outline.map(project);
    const points = coords.map(pair => pair.join(',')).join(' ');
    const [[startX, startZ]] = coords;
    const [endX, endZ] = coords[coords.length - 1];
    return `<svg class="bd-outline ${valid ? '' : 'invalid'}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Boundary preview with dashed closing segment">
      ${valid ? `<polygon points="${points}"/>` : ''}
      <polyline points="${points}"/>
      <line x1="${endX}" y1="${endZ}" x2="${startX}" y2="${startZ}"/>
      ${problemSegments.map(([a, b]) => `<polyline class="bd-problem" points="${project(a).join(',')} ${project(b).join(',')}"/>`).join('')}
      <circle cx="${startX}" cy="${startZ}" r="5"/>
    </svg>`;
  }

  function reviewPane(label) {
    const preview = B.preview;
    if (!B.status.sameSave) return `<p class="hint">${pauseReasons.save}</p><div class="bd-actions">${button('cancel', 'Discard')}</div>`;
    if (!preview) return '<p class="hint">Loading boundary preview…</p>';
    const valid = !preview.issues.length;
    const area = valid ? `${fmt(U.area(preview.area), 3)} ${U.areaUnit()}` : '—';
    return `<div class="bd-state"><b>Review Boundary</b><span>${label}</span></div>
      ${outlineMap(preview.outline, valid, preview.problemSegments || [])}
      <div class="bd-grid bd-review-stats">
        <div><small>Enclosed area</small><b>${area}</b></div>
        <div><small>Perimeter</small><b>${valid ? gapText(preview.perimeter) : '—'}</b></div>
        <div><small>Closing gap</small><b>${gapText(preview.gap)}</b></div>
        <div><small>Maximum gap</small><b>${U.dist(preview.gapLimit)}</b></div>
      </div>
      ${valid ? '<p class="hint">Ready to save. The dashed segment closes the outline.</p>'
        : `<ul class="bd-issues">${preview.issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>`}
      <div class="bd-actions">${button('cancel', 'Discard')}${button('edit', 'Edit Recording', !B.status.sameSave)}
        ${button('finish', 'Save Boundary', !valid || !B.status.sameSave, 'smv-ok')}</div>`;
  }

  function render() {
    const st = B.status;
    for (const panel of [$('mapRec'), $('pageRec')]) {
      panel.hidden = !st.active || (settings.pageName === 'Guidance') !== (panel.id === 'mapRec');
      if (panel.hidden) continue;
      const reviewing = st.mode === 'review';
      const label = reviewing ? 'Boundary in review' : st.paused ? 'Boundary paused' : 'Recording boundary';
      panel.classList.toggle('paused', st.mode !== 'recording');
      setHtml(panel, `<button class="bd-map-status" data-bd="open"><i></i><b>${label}</b><span data-bd-gap></span></button>
        <div class="bd-map-actions">${reviewing ? button('open', 'Open Review', false, 'smv-ok') : editControls() + recordControls()}</div>`);
      panel.querySelector('[data-bd-gap]').textContent = `${U.dist(st.length)} recorded${st.gap == null ? '' : ` · ${U.dist(st.gap)} to start`}`;
    }
    if ($('boundaryWin').hidden) return;
    const field = B.fields.find(f => String(f.id) === st.fieldId);
    const label = esc(st.name || field?.name || (st.fieldId ? `Field ${st.fieldId}` : 'New Field'));
    setHtml($('bdBody'), !st.active ? setupPane() : st.mode === 'review' ? reviewPane(label) : recordingPane(label));
    const name = $('bdName');
    if (name && name.value !== B.name) name.value = B.name;
    if (st.active && st.mode !== 'review') {
      $('bdGap').textContent = gapText(st.gap);
      $('bdDistance').textContent = U.dist(st.length);
    }
  }

  async function command(input) {
    if (B.busy) return;
    B.busy = true;
    render();
    try {
      const response = await fetch('/api/boundary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Boundary command failed.');
      readSnapshot(result);
      if (input.action === 'review') openWin('boundaryWin');
      if (result.saved) {
        shade(`Boundary saved (field ${result.saved.field}, version ${result.saved.v}).`, 'info', 4000);
        if (!result.active) { B.name = ''; closeWin('boundaryWin'); }
        loadFields();
      }
      if (input.action === 'cancel') { B.name = ''; closeWin('boundaryWin'); }
    } catch (err) {
      shade(err.message, 'warn', 4000);
    } finally {
      B.busy = false;
      render();
    }
  }

  function open() {
    openWin('boundaryWin');
    render();
    loadPath();
  }

  function handleAction(event) {
    const control = event.target.closest('button[data-bd]');
    if (!control) return;
    const action = control.dataset.bd;
    if (action === 'open') return open();
    if (action === 'start') {
      const fieldId = B.target === 'this' ? currentField()?.id : null;
      return command({ action, fieldId, name: fieldId == null ? B.name : null, tool: selectedTool()?.key,
        side: B.side, reference: B.reference, offset: B.offset });
    }
    const input = { action, draftId: B.status.draftId, reviewId: B.preview?.id };
    if (action === 'cancel') return confirmBox('Discard Boundary', 'Discard this unsaved boundary?', () => command(input));
    if (action === 'resume' && B.status.needsConnectorConfirmation) {
      input.resumeTo = B.status.cursor;
      return confirmBox('Join Boundary', `Join to this position with a straight segment of ${U.dist(B.status.connectorLength)}?`, () => command(input));
    }
    command(input);
  }

  $('bdBody').onclick = event => {
    const control = event.target.closest('button');
    if (!control) return;
    if (control.id === 'bdOffset') {
      openNumpad(`Lateral Offset (${metric('distance') ? 'm' : 'ft'})`, value => {
        B.offset = Math.max(0, Math.min(30, metric('distance') ? value : value / 3.28084));
        render();
      });
      return;
    }
    const segment = control.closest('.seg');
    if (!segment) return handleAction(event);
    if (segment.id === 'bdTarget') B.target = control.dataset.v;
    if (segment.id === 'bdSide') B.side = control.dataset.v;
    if (segment.id === 'bdReference') {
      B.reference = control.dataset.v;
      if (B.reference === 'implement' && B.side === 'center') B.side = 'left';
    }
    render();
  };
  $('appBoundary').onclick = () => { closeWin('menu'); loadFields(); open(); };
  $('mapRec').onclick = handleAction;
  $('pageRec').onclick = handleAction;
  $('bdBody').oninput = event => { if (event.target.id === 'bdName') B.name = event.target.value; };
  $('bdBody').onchange = event => { if (event.target.id === 'bdTool') { B.tool = event.target.value; render(); } };

  function connector() {
    if (!B.path.length) return null;
    const end = B.path[B.path.length - 1];
    if (B.status.paused) return B.status.cursor ? [end, B.status.cursor] : null;
    return B.path.length > 1 ? [end, B.path[0]] : null;
  }

  window.G5Bounds = { onTelemetry, render, fields: () => B.fields, path: () => B.status.sameSave ? B.path : [], connector };
  loadFields();
})();

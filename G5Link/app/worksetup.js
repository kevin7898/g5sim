'use strict';
// G5Link display: Work Setup (as on the G5: client, farm, field, crop, variety, product). Saved in the
// bridge per savegame, so every display and the Ops Center share it. The variety names seeding maps.

(function () {
  const W = { ws: null, clientDefault: null, farmDefault: null, draft: null, target: null, pending: false };
  const targetOf = d => ({ save: d.game?.save || 'unsaved', session: d.session, vehicle: d.vehicle?.id });
  async function load() {
    try {
      const r = await (await fetch('/api/ops/work-setup')).json();
      W.ws = r.workSetup; W.clientDefault = r.clientDefault; W.farmDefault = r.farmDefault;
    } catch (e) { /* offline */ }
  }
  const crops = () => {
    const set = new Set(Object.keys(LB_PER_BU));
    (data.implements || []).forEach(i => { const crop = i.seeder?.crop || i.stockCrop; if (crop) set.add(String(crop).toUpperCase()); });
    if (data.combine && data.combine.crop) set.add(String(data.combine.crop).toUpperCase());
    return [...set].sort();
  };
  const products = () => [...new Set((data.implements || []).flatMap(i => (i.fills || []).map(f => f.title)).filter(Boolean))];
  const cropLabel = c => ({ MAIZE: 'Corn', SOYBEAN: 'Soybeans', WV_SPRINGWHEAT: 'Spring Wheat', WV_WINTERWHEAT: 'Winter Wheat' }[c]
    || String(c).toLowerCase().replace(/(^|_)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()));
  const machineCrop = () => {
    const tool = (data.implements || []).find(i => i.seeder || i.stockCrop);
    return tool?.seeder?.crop || tool?.stockCrop || data.combine?.crop || null;
  };
  const currentFieldName = () => {
    const id = data.field ?? (data.vehicle && data.vehicle.field);
    const f = window.G5Bounds ? G5Bounds.fields().find(x => String(x.id) === String(id)) : null;
    return id === null || id === undefined ? null : (f ? f.name : `Field ${id}`);
  };

  function renderJob() {
    const controls = $('wsJob');
    if (!controls || $('workSetupWin').hidden) return;
    const state = data.workJob;
    const active = state?.active;
    const sameTarget = JSON.stringify(W.target) === JSON.stringify(targetOf(data));
    const live = sameTarget && data.link === 'live' && data.state === 'vehicle' && data.session && data.vehicle?.id != null;
    const status = active ? `${active.title}${active.field ? ' · ' + active.field : ''} · ${{ active: 'Active', ready: 'Ready', requested: 'Requested', paused: 'Paused' }[active.state]}` : 'No active job';
    const reason = sameTarget ? state?.reason || '' : 'Machine or save changed. Reopen Work Setup.';
    setHtml(controls, `<div><b>${esc(status)}</b>${reason ? `<small>${esc(reason)}</small>` : ''}</div>
      ${active ? `<button class="g5btn" data-job="finish" ${live && !W.pending ? '' : 'disabled'}>Finish Work</button>`
        : `<button class="g5btn" data-job="start" ${live && state?.eligible && !W.pending ? '' : 'disabled'}>Start New Work</button>`}`);
  }

  function render() {
    const d = W.draft;
    if (!d) return;
    const fields = window.G5Bounds ? G5Bounds.fields() : [];
    const mc = machineCrop();
    // only the rows this operation records (like the G5's Work Summary): harvest crop + variety, seeding crop +
    // variety + seed, application the product, tillage none of them
    const op = (typeof MACHINE !== 'undefined' && MACHINE.operation) || 'none';
    const show = { crop: ['harvest', 'seeding', 'none'], variety: ['harvest', 'seeding'], product: ['seeding', 'application', 'none'] };
    const has = k => show[k].includes(op);
    const OP_NAME = { harvest: 'Harvest', seeding: 'Seeding', application: 'Product Application', tillage: 'Tillage', none: 'No implement detected' };
    const row = (k, html) => has(k) ? html : '';
    setHtml($('wsBody'), `
      <div class="set-row"><span>Operation</span><em class="ws-note ws-op">${OP_NAME[op]}</em></div>
      <div class="set-row"><span>Client</span><input class="ws-in" data-k="client" value="${esc(d.client ?? W.clientDefault ?? '')}" placeholder="My Operation"></div>
      <div class="set-row"><span>Farm</span><input class="ws-in" data-k="farm" value="${esc(d.farm ?? '')}" placeholder="${esc(W.farmDefault || 'From the game')}"></div>
      <div class="set-row"><span>Field</span><div class="ws-right">
        <div class="seg ws-seg" data-seg="fieldMode"><button data-v="auto" class="${d.fieldMode !== 'fixed' ? 'on' : ''}">Automatic</button><button data-v="fixed" class="${d.fieldMode === 'fixed' ? 'on' : ''}">Choose</button></div>
        ${d.fieldMode === 'fixed' ? `<select class="ws-in" data-k="fieldId">${fields.map(f => `<option value="${esc(f.id)}" ${String(f.id) === String(d.fieldId) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`
          : `<em class="ws-note">${esc(currentFieldName() || 'Not on a field')}</em>`}</div></div>
      ${row('crop', `<div class="set-row"><span>Crop</span><div class="ws-right"><select class="ws-in" data-k="crop">
        <option value="">${mc ? 'From the machine (' + esc(cropLabel(String(mc).toUpperCase())) + ')' : 'From the machine'}</option>
        ${crops().map(c => `<option value="${esc(c)}" ${d.crop === c ? 'selected' : ''}>${esc(cropLabel(c))}</option>`).join('')}</select></div></div>`)}
      ${row('variety', `<div class="set-row"><span>Variety</span><input class="ws-in" data-k="variety" value="${esc(d.variety ?? '')}" placeholder="e.g. P1197AM"></div>`)}
      ${row('product', `<div class="set-row"><span>${op === 'seeding' ? 'Seed' : 'Product'}</span><input class="ws-in" data-k="product" list="wsProducts" value="${esc(d.product ?? '')}" placeholder="${op === 'seeding' ? 'Seed product' : 'Fertilizer or chemical'}">
        <datalist id="wsProducts">${products().map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>`)}
      <p class="hint">${op === 'tillage' ? 'Tillage records the field and the work; no crop or product.' : 'Saved for this savegame and shared with every display and the Ops Center. Seeding maps and records are split by variety.'}</p>
      <div class="set-row ws-job" id="wsJob"></div>
      <div class="bd-actions"><button class="g5btn" data-close="workSetupWin">Cancel</button><button class="g5btn smv-ok" id="wsSave"><svg><use href="#i-check"/></svg>Save</button></div>`);
    renderJob();
  }
  $('wsBody').addEventListener('input', e => { const k = e.target.dataset.k; if (k && W.draft) W.draft[k] = e.target.value; });
  $('wsBody').addEventListener('change', e => { const k = e.target.dataset.k; if (k && W.draft) W.draft[k] = e.target.value; });
  $('wsBody').addEventListener('click', async e => {
    const job = e.target.closest('[data-job]');
    if (job) {
      const action = job.dataset.job;
      W.pending = true;
      renderJob();
      try {
        const response = await fetch('/api/ops/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...W.target, action, id: data.workJob?.active?.id, setup: action === 'start' ? W.draft : undefined }) });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error);
        W.ws = result.workSetup;
        if (action === 'start') W.draft = { ...W.ws };
        shade(action === 'start' ? 'Work started.' : 'Work saved to history.', 'info', 2500);
      } catch (error) { shade(error.message, 'warn', 3500); }
      finally { W.pending = false; renderJob(); }
      return;
    }
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      W.draft.fieldMode = segBtn.dataset.v;
      if (W.draft.fieldMode === 'fixed' && !W.draft.fieldId) {
        const id = data.field ?? (data.vehicle && data.vehicle.field);
        const fields = window.G5Bounds ? G5Bounds.fields() : [];
        W.draft.fieldId = id !== null && id !== undefined ? String(id) : fields[0] ? String(fields[0].id) : null;
      }
      render(); return;
    }
    if (e.target.closest('#wsSave')) {
      try {
        const r = await fetch('/api/ops/work-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(W.draft) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        W.ws = j.workSetup; closeWin('workSetupWin'); shade('Work Setup saved.', 'info', 2500);
      } catch (err) { shade('Work Setup not saved: ' + err.message, 'warn', 3000); }
    }
  });
  async function open() {
    closeWin('menu');
    W.target = targetOf(data);
    await load();
    W.draft = { ...W.ws };
    openWin('workSetupWin');
    render();
  }
  $('appWorkSetup').onclick = open;

  // SETUP key state and the Location module follow the Work Setup on every frame
  window.G5WorkSetup = {
    open,
    onTelemetry: renderJob,
    keyState(d) {
      const ws = d.workSetup || {};
      const crop = ws.crop || machineCrop();
      return { on: !!(ws.variety || ws.crop || ws.fieldMode === 'fixed'), txt: crop ? cropLabel(String(crop).toUpperCase()).toUpperCase().slice(0, 12) : '--' };
    },
  };
  load();
})();

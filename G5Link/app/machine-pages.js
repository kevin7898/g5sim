'use strict';

(() => {
  let selectedLane = null;
  let laneTarget = null;
  let boomRequest = null;
  let boomOwner = null;
  let job = { key: null, totals: null, next: 0 };
  const position = $('plSection');
  const unitsArea = n => Number.isFinite(n) ? `${fmt(U.areaFromHa(n), 2)} ${U.areaUnit()}` : '—';
  const vol = n => Number.isFinite(n) ? `${fmt(U.vol(n), 0)} ${U.volUnit()}` : '—';
  const pct = n => Number.isFinite(n) ? `${fmt(n, 0)}%` : '—';
  const status = d => ({ unavailable: 'Unavailable', paused: 'Paused', ready: 'Ready', active: 'Active' })[d.workState?.state] || '—';
  const yes = v => v === null || v === undefined ? '—' : v ? 'On' : 'Off';
  const pairs = rows => rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v || '—')}</b>`).join('');
  const currentJob = d => d.workJob?.active?.id ?? null;

  function syncJob(d) {
    const id = currentJob(d), save = d.game?.save || 'unsaved';
    const key = id ? `${save}:${id}` : null;
    if (key !== job.key) job = { key, totals: null, next: 0 };
    if (!id || Date.now() < job.next) return;
    const loading = job;
    job.next = Date.now() + 3000;
    fetch(`/api/ops/jobs?id=${encodeURIComponent(id)}`).then(response => response.json()).then(result => {
      if (job === loading && save === result.save) {
        loading.totals = result.jobs?.[0]?.totals || null;
        render(data);
      }
    }).catch(() => { /* retried on the next telemetry frame */ });
  }

  function renderTillage(d) {
    const tool = (d.implements || []).find(i => i.tillage);
    const toolStatus = tool?.processing?.includes(true) ? 'Active' : tool?.areas?.includes(true) ? 'Ready' : status(d);
    setHtml($('tlWork'), pairs([['Ground work', toolStatus], ['Unique field area', unitsArea(job.totals?.fieldHa != null ? job.totals.workedHa : null)],
      ['Field overlap', unitsArea(job.totals?.fieldHa != null ? job.totals.overlapHa : null)]]));
  }

  function renderLanes(d, dedicated) {
    const plant = (d.implements || []).find(i => i.seeder || i.operation === 'seeding');
    const sc = plant?.section;
    const readings = plant?.seeder?.rows || [];
    const target = `${d.session || ''}:${d.vehicle?.id || ''}:${plant?.id || plant?.name || ''}`;
    if (target !== laneTarget) { laneTarget = target; selectedLane = null; }
    const name = sc?.kind === 'section' ? 'Section' : 'Row';
    const options = sc?.states || [];
    const stateName = (bit, row) => bit === 'a' ? 'Off · overlap' : bit === '1' ? 'Enabled' : bit === '0' ? 'Off' : row?.on === true ? 'Working' : row?.on === false ? 'Off' : '—';
    if (dedicated) {
      $('sectionRunStatus').textContent = !sc ? 'Lane control is unavailable for this implement.' : `${plant.name} · ${options.length} ${name.toLowerCase()}${options.length === 1 ? '' : 's'} · Green enabled, amber off for overlap`;
      setHtml($('sectionRunLanes'), options.map((bit, n) => `<button type="button" class="lane-mark ${bit === 'a' ? 'auto' : bit === '1' ? 'on' : ''} ${n === selectedLane ? 'is-selected' : ''}"
        data-run-lane="${n}" aria-pressed="${n === selectedLane}" aria-label="Inspect ${name.toLowerCase()} ${n + 1}, ${esc(stateName(bit))}">${n + 1}</button>`).join(''));
    }
    const info = $(dedicated ? 'sectionRunDetail' : 'plLaneDetail');
    const row = selectedLane === null ? null : readings[selectedLane];
    const bit = selectedLane === null ? null : options[selectedLane];
    if (row == null && bit == null) { setHtml(info, ''); return; }
    const sd = plant.seeder;
    const seedRate = value => sd && Number.isFinite(value) ? `${fmt(SR.conv(sd, value), sd.kind === 'drill' ? 1 : 0)} ${SR.unit(sd)}` : '—';
    const delta = row?.target > 0 && Number.isFinite(row?.actual) ? `${fmt((row.actual - row.target) / row.target * 100, 1)}%` : '—';
    setHtml(info, pairs([[`${name} ${selectedLane + 1}`, stateName(bit, row)], ['Target', seedRate(row?.target)], ['Actual', seedRate(row?.actual)], ['Deviation', delta]]));
  }

  function renderLogistics(d) {
    const c = d.combine;
    const gc = d.grainCart;
    const tool = (d.implements || []).find(i => i.operation === 'harvest' || i.geometry?.length);
    const pipe = d.controls?.pipe;
    $('logisticsCart').disabled = !gc;
    const pipeState = d.link === 'live' && pipe?.unloading === true ? 'Unloading'
      : pipe?.state == null ? '—' : pipe.state !== pipe.target ? 'Moving' : pipe.state > 1 ? 'Extended' : 'Retracted';
    setHtml($('harvestLogisticsReadings'), pairs([['Header', tool?.name], ['Pipe', pipeState],
      ['Tank', c?.tankCap ? `${pct(c.tank / c.tankCap * 100)} · ${HU.tank(c.tank)}` : '—'], ['Crop', c?.cropTitle || c?.crop],
      ['Grain cart', gc?.name || 'Unavailable'], ['Field harvested', unitsArea(job.totals?.workedHa)]]));
  }

  function renderBoom(d, tool, index) {
    const sprayer = tool?.sprayer;
    const boom = sprayer?.boom;
    const target = commandTarget(d);
    const canSet = target && d.link === 'live' && !d.vehicle?.ai && boom?.canSet && tool.id != null;
    const owner = boom && target ? JSON.stringify([target.session, target.save, target.vehicle, tool.id]) : null;
    if (owner !== boomOwner) {
      boomOwner = owner;
      $('boomCommand').textContent = '';
    }
    if (boomRequest) {
      const req = boomRequest;
      if (!canSet || req.index !== index || req.target.implement !== tool.id || req.target.session !== target.session
          || req.target.save !== target.save || req.target.vehicle !== target.vehicle) {
        boomRequest = null;
        $('boomCommand').textContent = 'Sprayer control changed.';
      } else if (req.id !== null && d.lastCmd >= req.id) {
        boomRequest = null;
        $('boomCommand').textContent = boom[req.side] === req.count ? 'Width confirmed by the sprayer.' : 'Sprayer did not confirm the requested width.';
      }
    }
    if (!boom) {
      setHtml($('boomStrip'), sprayer ? `<div class="lane-mark broadcast ${sprayer.applying ? 'on' : ''}">Broadcast</div>` : '');
      $('boomNote').textContent = sprayer ? 'Broadcast application.' : 'Boom sections are unavailable.';
      return;
    }
    const group = (side, n) => {
      const enabled = n <= boom[side];
      const name = `${side === 'left' ? 'Left' : 'Right'} group ${n}`;
      const label = `${name}, ${enabled ? 'enabled' : 'off'}`;
      return `<button type="button" class="lane-mark ${enabled ? 'on' : ''}" data-boom-side="${side}" data-boom-group="${n}"
        aria-label="${label}" aria-pressed="${enabled}" ${!canSet || boomRequest ? 'disabled' : ''}>${side === 'left' ? 'L' : 'R'}${n}</button>`;
    };
    const left = Array.from({ length: boom.leftMax }, (_, i) => group('left', boom.leftMax - i)).join('');
    const right = Array.from({ length: boom.rightMax }, (_, i) => group('right', i + 1)).join('');
    setHtml($('boomStrip'), `${left}<div class="lane-mark broadcast on" aria-label="Center group, enabled">C</div>${right}`);
    $('boomNote').textContent = canSet ? 'Tap a wing group to change its outer edge.'
      : d.vehicle?.ai ? 'The AI worker controls the boom width.' : 'Boom width controls are unavailable.';
  }

  function renderSpray(d, boom) {
    const index = (d.implements || []).findIndex(i => i.sprayer);
    const tool = d.implements?.[index];
    const sprayer = tool?.sprayer;
    const rate = d.rate;
    const opState = sprayer?.applying === true ? 'Applying' : sprayer?.applying === false ? 'Idle' : 'Unavailable';
    const width = tool?.width > 0 ? U.width(tool.width) : null;
    const flow = d.link === 'live' && Number.isFinite(sprayer?.flowLpm) ? `${fmt(U.vol(sprayer.flowLpm), 1)} ${U.volUnit()}/min` : '—';
    if (boom) {
      setHtml($('boomReadings'), pairs([['Master', yes(sprayer?.master)], ['Application', opState], ['Work Job', d.workJob?.active ? 'Open' : 'Idle'],
        ['Working Width', width], ['Flow', flow], ['Pressure', '—']]));
      renderBoom(d, tool, index);
      return;
    }
    $('sprayTitle').textContent = tool?.name || 'Spraying';
    const tankPct = sprayer?.cap > 0 && Number.isFinite(sprayer.level) ? sprayer.level / sprayer.cap * 100 : null;
    setHtml($('sprayTiles'), [tile('Tank', tankPct === null ? '—' : fmt(tankPct, 0), tankPct === null ? '' : '%', { pct: tankPct, sub: vol(sprayer?.level) }),
      tile('Application', opState, '', { on: sprayer?.applying === true }), tile('Working Width', width || '—')].join(''));
    const target = rate?.value != null ? rate.system === 'sf' ? `${fmt(rate.value, 2)}×` : `Level ${fmt(rate.value, 0)}` : '—';
    const measured = d.link === 'live' && sprayer?.applying && d.applicationRate?.implement === tool.id ? d.applicationRate?.litersPerHa : null;
    const actual = Number.isFinite(measured) ? `${fmt(U.vol(measured) / U.areaFromHa(1), 1)} ${U.volUnit()}/${U.areaUnit()}` : '—';
    const product = sprayer?.product !== 'UNKNOWN' && (sprayer?.productTitle || sprayer?.product);
    setHtml($('sprayReadings'), pairs([['Product', product || d.workSetup?.product], ['Target setting', target], ['Actual Rate', actual], ['Flow', flow],
      ['Worked', unitsArea(job.totals?.workedHa)], ['Applied', unitsArea(job.totals?.appliedHa)], ['Mapped Product Used', vol(job.totals?.productUsed?.quantity)]]));
    $('sprayRates').hidden = !rate;
  }

  function mount(name) {
    const dest = $(name === 'Section Control' ? 'sectionRunControls' : 'plSectionHome');
    if (position.parentElement !== dest) dest.append(position);
  }

  function render(d) {
    const page = settings.pageName;
    if (['Tillage', 'Harvest Logistics', 'Spraying'].includes(page)) syncJob(d);
    if (page === 'Tillage') renderTillage(d);
    if (page === 'Planter' || page === 'Section Control') renderLanes(d, page === 'Section Control');
    if (page === 'Harvest Logistics') renderLogistics(d);
    if (page === 'Spraying' || page === 'Boom & Sections') renderSpray(d, page === 'Boom & Sections');
  }

  $('plRows').onclick = e => {
    const hit = e.target.closest('[data-pl-inspect]');
    if (hit) { selectedLane = Number(hit.dataset.plInspect); renderLanes(data, false); }
  };
  $('sectionRunLanes').onclick = e => {
    const hit = e.target.closest('[data-run-lane]');
    if (hit) { selectedLane = Number(hit.dataset.runLane); renderLanes(data, true); $('sectionRunLanes').querySelector(`[data-run-lane="${selectedLane}"]`)?.focus(); }
  };
  $('logisticsCart').onclick = () => window.G5GrainCart?.open();
  $('spraySectionPage').onclick = () => showPage('Boom & Sections');
  $('sprayRates').onclick = () => window.G5Rate?.open();
  $('boomStrip').onclick = async event => {
    const button = event.target.closest('[data-boom-side]');
    const target = commandTarget(data);
    if (!button || button.disabled || boomRequest || !target || data.link !== 'live' || data.vehicle?.ai) return;
    const index = (data.implements || []).findIndex(i => i.sprayer);
    const tool = data.implements?.[index];
    const boom = tool?.sprayer?.boom;
    if (!boom?.canSet || tool.id == null) return;
    const side = button.dataset.boomSide, group = Number(button.dataset.boomGroup);
    const count = group <= boom[side] ? group - 1 : group;
    const req = { target: { ...target, implement: tool.id }, index, side, count, id: null };
    boomRequest = req;
    $('boomCommand').textContent = 'Waiting for the sprayer.';
    renderBoom(data, tool, index);
    req.id = await send('boomWidth', count, index, null, side, req.target);
    if (boomRequest !== req) return;
    if (req.id === null) {
      boomRequest = null;
      $('boomCommand').textContent = 'Width change could not be sent.';
      render(data);
      return;
    }
    render(data);
    setTimeout(() => {
      if (boomRequest !== req) return;
      boomRequest = null;
      $('boomCommand').textContent = 'No confirmation from the sprayer.';
      render(data);
    }, 3500);
  };
  window.G5MachinePages = { mount, render };
  mount(settings.pageName);
  render(data);
})();

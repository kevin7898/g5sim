'use strict';

(() => {
  let selectedLane = null;
  let laneTarget = null;
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
    const pipeState = pipe?.state == null ? '—' : pipe.state !== pipe.target ? 'Moving' : pipe.state > 1 ? 'Extended' : 'Retracted';
    setHtml($('harvestLogisticsReadings'), pairs([['Header', tool?.name], ['Pipe', pipeState],
      ['Tank', c?.tankCap ? `${pct(c.tank / c.tankCap * 100)} · ${HU.tank(c.tank)}` : '—'], ['Crop', c?.cropTitle || c?.crop],
      ['Grain cart', gc?.name || 'Unavailable'], ['Field harvested', unitsArea(job.totals?.workedHa)]]));
  }

  function renderSpray(d, boom) {
    const tool = (d.implements || []).find(i => i.sprayer);
    const sprayer = tool?.sprayer;
    const rate = d.rate;
    const opState = sprayer?.applying === true ? 'Applying' : sprayer?.applying === false ? 'Idle' : 'Unavailable';
    const width = tool?.width > 0 ? U.width(tool.width) : null;
    const flow = d.link === 'live' && Number.isFinite(sprayer?.flowLpm) ? `${fmt(U.vol(sprayer.flowLpm), 1)} ${U.volUnit()}/min` : '—';
    if (boom) {
      setHtml($('boomReadings'), pairs([['Master', yes(sprayer?.master)], ['Application', opState], ['Work Job', d.workJob?.active ? 'Open' : 'Idle'],
        ['Working Width', width], ['Flow', flow], ['Pressure', '—']]));
      setHtml($('boomStrip'), sprayer ? `<div class="lane-mark broadcast ${sprayer.applying ? 'on' : ''}">${esc(width || 'Broadcast')}</div>` : '');
      $('boomNote').textContent = sprayer ? 'Broadcast application. Individual sections require a supported controller.' : 'Boom status is unavailable from this tool.';
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
  window.G5MachinePages = { mount, render };
  mount(settings.pageName);
  render(data);
})();

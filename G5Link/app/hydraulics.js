'use strict';
// G5Link display: Realistic Hydraulics (FS25_RealHydraulicsSCV, optional companion mod; data in d.hyd).
//   Hydraulics run page: pump flow, pressure, oil temperature and one card per SCV (function, state, flow, detent, float).
//   EPG run page: electric power for implements (tractor EPG or an implement PTO/hydraulic generator) and its consumers.
//   SCV Settings window: per valve the function, Standard/Independent flow, detent time and priority, like the
//   G5's SCV settings (research/deere-help-notes.md, "SCV"). Flow shows as the G5's 0-10 setting (10 = 100 %).
// The SCV setup is saved by the hydraulics mod in the savegame, not here: this page only sends commands.

(function () {
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const scvName = i => 'SCV ' + (ROMAN[i - 1] || i);
  // G5 detent time steps: 1 s to 10, 2 s to 20, 5 s to 30, 10 s to 60, 30 s to 120
  const TIMER_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 40, 50, 60, 90, 120];
  const FLOW_STEP = 5;                                // % (0.5 on the G5 setting)
  const KIND = { fold: 'Fold', lower: 'Lift', motor: 'Motor', movingTool: 'Cylinder', turnOn: 'Drive' };
  const STATE = { extend: 'Extend', retract: 'Retract', neutral: 'Neutral', float: 'Float' };
  const SOURCE = { tractor_epg: 'Tractor EPG', pto_generator: 'PTO Generator', hyd_generator: 'Hydraulic Generator' };
  const MODE_TXT = {
    off: 'EPG is off. Implements on electric drive get no power.',
    auto: 'Auto: the EPG turns on when the implement asks for power.',
    icm: 'Implement Control Mode: the implement runs its electric drives itself.',
  };
  const WARN = { HYD_OIL_HOT: 'Hydraulic oil temperature high.', HYD_FLOW_SHARED: 'Hydraulic demand is over pump flow. Flow is being shared.',
    HYD_LOW_PRESSURE: 'Hydraulic pressure low.', HYD_PUMP: 'Hydraulic pump fault.', HYD_LEAK: 'Hydraulic cylinder drifting.',
    EPG_OFF: 'EPG off: electric drives have no power.', EPG_OVERLOAD: 'EPG overloaded: electric drives slowed.', EPG_FAULT: 'EPG fault.' };
  const REASON = { notServer: 'only the game host can change SCV settings', noHydraulicsMod: 'Realistic Hydraulics is not loaded',
    badIndex: 'this SCV does not exist', badMode: 'unknown EPG mode', badConfig: 'no valid setting', unknownFunction: 'that function is not attached',
    notSupported: 'the hydraulics mod does not support this', noVehicle: 'not in a machine', error: 'script error (see the game log)' };

  const flow = l => metric('volume') ? l : l / 3.78541;            // L/min -> US gal/min
  const flowUnit = () => metric('volume') ? 'L/min' : 'gpm';
  const pres = b => metric('pressure') ? b : b * 14.5038;
  const presUnit = () => metric('pressure') ? 'bar' : 'psi';
  const temp = c => metric('temperature') ? c : c * 9 / 5 + 32;
  const tempUnit = () => metric('temperature') ? '°C' : '°F';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const setting = pct => num(pct) ? fmt(pct / 10, 1) : '---';     // % -> G5 flow setting 0-10
  const detentTxt = s => s.detent === 'continuous' ? 'C' : s.detent === 'timed' && num(s.timer) ? fmt(s.timer, 0) + ' s' : 'Off';
  const kv = (k, val) => `<div class="kv"><span>${k}</span><b>${val}</b></div>`;

  // ------------------------------------------------------------ Hydraulics run page
  function arrow(state) {
    if (state === 'extend') return '<svg viewBox="0 0 24 24"><path d="M12 20V5M5 11l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (state === 'retract') return '<svg viewBox="0 0 24 24"><path d="M12 4v15M5 13l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (state === 'float') return '<svg viewBox="0 0 24 24"><path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 16c3-3 6 3 9 0s6 3 9 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
  }
  function scvCard(s) {
    const st = s.state || 'neutral', active = st === 'extend' || st === 'retract';
    const timed = s.detent === 'timed' && num(s.timer) && s.timer > 0 && num(s.timerLeft) && s.timerLeft > 0;
    const flowTxt = s.mode === 'independent' ? `${setting(s.flowExt)} / ${setting(s.flowRet)}` : setting(s.flowExt);
    const short = num(s.lpm) && num(s.demandLpm) && s.demandLpm > 0 && s.lpm < s.demandLpm - 0.5;
    return `<div class="hy-scv ${active ? 'on' : ''} ${st === 'float' ? 'float' : ''}">
      <div class="hy-scv-head"><b>${scvName(s.index)}</b>${s.front ? '<small>Front</small>' : ''}</div>
      <div class="hy-fn" title="${esc(s.boundLabel || '')}">${esc(s.label || (s.bound ? s.bound : 'Not assigned'))}</div>
      <div class="hy-state ${st}">${arrow(st)}<span>${STATE[st] || '---'}</span></div>
      <div class="hy-kv"><span>Flow</span><b>${flowTxt}</b></div>
      <div class="hy-kv"><span>Detent</span><b>${timed ? fmt(s.timerLeft, 1) + ' s' : detentTxt(s)}</b></div>
      <div class="hy-kv ${short ? 'short' : ''}"><span>${flowUnit()}</span><b>${num(s.lpm) ? fmt(flow(s.lpm), 0) : '---'}${short ? ' ▾' : ''}</b></div>
      <div class="hy-timer"><i style="width:${timed ? Math.min(100, s.timerLeft / s.timer * 100).toFixed(0) : 0}%"></i></div>
      <div class="hy-scv-btns">
        <button class="g5btn ${s.float ? 'on' : ''}" data-float="${s.index}">Float</button>
        <button class="g5btn" data-edit="${s.index}" aria-label="${scvName(s.index)} settings"><svg><use href="#i-gear"/></svg></button>
      </div>
    </div>`;
  }
  function renderPage(h) {
    const live = !!h.pumpLpm;
    $('hyTitle').textContent = `${data.vehicle && data.vehicle.name ? data.vehicle.name + ' - ' : ''}Hydraulics`;
    const hot = num(h.oilTempC) && h.oilTempC > 85;
    setHtml($('hyTiles'), [
      tile('Pump Flow', num(h.pumpLpm) ? fmt(flow(h.pumpLpm), 0) : '---', flowUnit(), { on: live, sub: num(h.maxLpm) ? `Max ${fmt(flow(h.maxLpm), 0)}` : '' }),
      tile('Flow Used', num(h.usedLpm) ? fmt(flow(h.usedLpm), 0) : '---', flowUnit(), { on: live && h.usedLpm > 0, alert: h.shared === true, sub: h.shared ? 'Flow shared' : '' }),
      tile('Pressure', num(h.pressureBar) ? fmt(pres(h.pressureBar), 0) : '---', presUnit(), { on: live, sub: num(h.maxBar) ? `Relief ${fmt(pres(h.maxBar), 0)}` : '' }),
      tile('Oil Temp', num(h.oilTempC) ? fmt(temp(h.oilTempC), 0) : '---', tempUnit(), { on: live, alert: hot, sub: hot ? 'High' : '' }),
    ].join(''));
    const scvs = h.scvs || [];
    setHtml($('hyScvs'), scvs.length ? scvs.map(scvCard).join('') : '<p class="pl-none">This tractor has no SCVs.</p>');
    $('hyScvs').style.setProperty('--n', Math.max(1, Math.min(6, scvs.length)));

    const max = Math.max(1, h.maxLpm || h.pumpLpm || 1);
    const pct = v => Math.max(0, Math.min(100, (v || 0) / max * 100)).toFixed(0);
    setHtml($('hyFlow'), `<div class="hy-gauge"><i class="avail" style="height:${pct(h.pumpLpm)}%"></i><i class="used ${h.shared ? 'over' : ''}" style="height:${pct(h.usedLpm)}%"></i></div>
      <div class="hv-tank-sub">${num(h.usedLpm) ? fmt(flow(h.usedLpm), 0) : '---'} / ${num(h.pumpLpm) ? fmt(flow(h.pumpLpm), 0) : '---'} ${flowUnit()}</div>`);
    const warns = (h.warnings || []).map(w => w.code);
    setHtml($('hyCircuit'), [
      kv('Hitch & Steering', num(h.hitchLpm) ? fmt(flow(h.hitchLpm), 0) + ' ' + flowUnit() : '---'),
      kv('Flow Sharing', h.shared ? 'Active' : 'No'),
      kv('Messages', warns.length ? esc(warns.map(c => WARN[c] ? WARN[c].replace(/\.$/, '') : c).join(', ')) : 'None'),
    ].join(''));
  }
  $('hyScvs').onclick = e => {
    const f = e.target.closest('[data-float]'), ed = e.target.closest('[data-edit]');
    if (f) { const s = scvOf(Number(f.dataset.float)); if (s) send('scvFloat', s.float ? 0 : 1, s.index, f); }
    else if (ed) open(Number(ed.dataset.edit));
  };
  $('hySetup').onclick = () => open();
  const scvOf = i => ((data.hyd && data.hyd.scvs) || []).find(s => s.index === i);

  // ------------------------------------------------------------ EPG run page
  function renderEpg(h) {
    const e = h.epg;
    if (!e) return;
    const on = e.mode !== 'off' && (e.availKw ?? e.capKw) > 0;
    $('epTitle').textContent = `EPG - ${SOURCE[e.source] || 'Electric Power'}${num(e.nominalV) ? ` ${fmt(e.nominalV, 0)} V` : ''}`;
    const usedPct = num(e.usedKw) && num(e.capKw) && e.capKw > 0 ? e.usedKw / e.capKw * 100 : null;
    const sag = num(e.busV) && num(e.nominalV) && on && e.busV < e.nominalV * 0.9;
    setHtml($('epTiles'), [
      tile('Power Used', num(e.usedKw) ? fmt(e.usedKw, 1) : '---', 'kW', { on, alert: usedPct !== null && usedPct > 95, pct: usedPct }),
      tile('Available', num(e.availKw ?? e.capKw) ? fmt(e.availKw ?? e.capKw, 1) : '---', 'kW', { on, sub: num(e.capKw) ? `Rated ${fmt(e.capKw, 0)} kW` : '' }),
      tile('Bus Voltage', num(e.busV) ? fmt(e.busV, 1) : '---', 'V', { on, alert: sag, sub: sag ? 'Low' : '' }),
      tile('Source', esc(SOURCE[e.source] ? SOURCE[e.source].split(' ')[0] : '---'), '', { on, sub: SOURCE[e.source] ? SOURCE[e.source].split(' ').slice(1).join(' ') : '' }),
    ].join(''));
    $('epMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === e.mode));
    $('epMsg').textContent = e.fault ? `Fault: ${e.fault}` : MODE_TXT[e.mode] || '---';
    const uses = e.uses || [];
    const top = Math.max(0.1, ...uses.map(u => Math.max(u.kw || 0, u.demandKw || 0)), e.capKw || 0);
    setHtml($('epUses'), uses.length ? uses.map(u => {
      const short = num(u.demandKw) && num(u.kw) && u.kw < u.demandKw - 0.05;
      return `<div class="ep-use ${short ? 'short' : ''}"><span>${esc(u.name)}</span><div class="ep-bar"><i style="width:${Math.min(100, (u.kw || 0) / top * 100).toFixed(0)}%"></i></div><b>${num(u.kw) ? fmt(u.kw, 1) : '---'} kW</b></div>`;
    }).join('') : '<p class="pl-none">No electric consumers.</p>');
    setHtml($('epGauge'), `<div class="hy-gauge"><i class="used ${usedPct > 95 ? 'over' : ''}" style="height:${Math.min(100, usedPct || 0).toFixed(0)}%"></i></div>
      <div class="hv-tank-sub">${usedPct === null ? '---' : fmt(usedPct, 0) + ' %'}</div>`);
    setHtml($('epGen'), [
      kv('Source', esc(SOURCE[e.source] || '---')),
      kv('Mode', esc({ off: 'Off', auto: 'Auto', icm: 'ICM' }[e.mode] || '---')),
      kv('Fault', esc(e.fault || 'None')),
    ].join(''));
  }
  $('epMode').onclick = e => {
    const b = e.target.closest('button'); if (!b || !data.hyd || !data.hyd.epg || b.dataset.v === data.hyd.epg.mode) return;
    send('epgMode', 0, 0, b, 'mode=' + b.dataset.v);
  };

  // ------------------------------------------------------------ SCV Settings window
  let sel = 1, draft = null, pick = false, savedIds = new Set();
  function load(i) {
    const s = scvOf(i);
    sel = i; pick = false;
    draft = s ? { index: s.index, bound: s.bound || '', mode: s.mode === 'independent' ? 'independent' : 'standard', flowExt: num(s.flowExt) ? s.flowExt : 100,
      flowRet: num(s.flowRet) ? s.flowRet : num(s.flowExt) ? s.flowExt : 100, detent: s.detent || 'none', timer: num(s.timer) && s.timer > 0 ? s.timer : 5,
      prio: num(s.prio) ? s.prio : s.index } : null;
  }
  function stepper(key, value, minus, plus) {
    return `<div class="tl-set hy-step"><button class="g5btn tl-step" data-step="${key}" data-d="-1" ${minus ? '' : 'disabled'}>−</button>
      <button class="tl-setpoint" data-num="${key}"><b>${value}</b></button>
      <button class="g5btn tl-step" data-step="${key}" data-d="1" ${plus ? '' : 'disabled'}>+</button></div>`;
  }
  function renderWin() {
    if ($('hydWin').hidden) return;
    const h = data.hyd, scvs = (h && h.scvs) || [];
    $('hydFoot').hidden = !scvs.length;
    if (!scvs.length) { setHtml($('hydBody'), `<p class="hint win-loading">${h ? 'This tractor has no SCVs.' : 'Waiting for Realistic Hydraulics…'}</p>`); return; }
    if (!draft || !scvOf(sel)) load(scvs[0].index);
    const d = draft, funcs = h.funcs || [];
    const fn = funcs.find(f => f.id === d.bound);
    const tabs = scvs.map(s => `<button data-tab="${s.index}" class="${s.index === sel ? 'on' : ''}">${scvName(s.index)}</button>`).join('');
    const ti = TIMER_STEPS.indexOf(d.timer);
    const panel = pick ? `
      <div class="lower-head">Assign a function to ${scvName(sel)}</div>
      <div class="hy-funcs">${funcs.map(f => {
        const other = scvs.find(s => s.bound === f.id && s.index !== sel);
        return `<button class="g5btn ${f.id === d.bound ? 'on' : ''}" data-fn="${esc(f.id)}"><b>${esc(f.label)}</b><small>${esc([f.impl, KIND[f.kind] || f.kind].filter(Boolean).join(' · '))}${other ? ` · now on ${scvName(other.index)}` : ''}</small></button>`;
      }).join('')}<button class="g5btn ${!d.bound ? 'on' : ''}" data-fn=""><b>None</b><small>Leave this SCV unassigned</small></button></div>
      ${funcs.length ? '' : '<p class="hint">No hydraulic functions found on the attached implements.</p>'}` : `
      <div class="set-row"><span>Function</span><div class="set-right"><b class="hy-fn-cur">${esc(fn ? fn.label : d.bound || 'Not assigned')}</b><button class="g5btn" id="hyPick">Change</button></div></div>
      <div class="set-row"><span>Flow Mode</span><div class="seg" data-seg="mode"><button data-v="standard" class="${d.mode === 'standard' ? 'on' : ''}">Standard</button><button data-v="independent" class="${d.mode === 'independent' ? 'on' : ''}">Independent</button></div></div>
      <div class="set-row"><span>${d.mode === 'independent' ? 'Extend Flow' : 'Flow'}</span>${stepper('flowExt', setting(d.flowExt), d.flowExt > 0, d.flowExt < 100)}</div>
      ${d.mode === 'independent' ? `<div class="set-row"><span>Retract Flow</span>${stepper('flowRet', setting(d.flowRet), d.flowRet > 0, d.flowRet < 100)}</div>` : ''}
      <div class="set-row"><span>Detent</span><div class="seg" data-seg="detent"><button data-v="none" class="${d.detent === 'none' ? 'on' : ''}">Off</button><button data-v="timed" class="${d.detent === 'timed' ? 'on' : ''}">Timed</button><button data-v="continuous" class="${d.detent === 'continuous' ? 'on' : ''}">C</button></div></div>
      ${d.detent === 'timed' ? `<div class="set-row"><span>Detent Time</span>${stepper('timer', fmt(d.timer, 0) + ' s', ti > 0, ti < TIMER_STEPS.length - 1)}</div>` : ''}
      <div class="set-row"><span>Flow Priority</span>${stepper('prio', fmt(d.prio, 0), d.prio > 1, d.prio < scvs.length)}</div>
      <p class="hint">Flow 10.0 is the valve's full flow. Continuous (C) valves get flow first, then the lowest priority number.</p>`;
    setHtml($('hydBody'), `<div class="tab-list" id="hydTabs">${tabs}</div><div class="tab-panel hy-panel">${panel}</div>`);
    $('hydSave').disabled = pick;
  }
  $('hydBody').onclick = e => {
    const t = e.target.closest('[data-tab]');
    if (t) { load(Number(t.dataset.tab)); renderWin(); return; }
    if (!draft) return;
    const d = draft;
    if (e.target.closest('#hyPick')) { pick = true; renderWin(); return; }
    const f = e.target.closest('[data-fn]');
    if (f) { d.bound = f.dataset.fn; pick = false; renderWin(); return; }
    const sg = e.target.closest('[data-seg] button');
    if (sg) {
      const key = sg.parentElement.dataset.seg;
      d[key] = sg.dataset.v;
      if (key === 'mode' && d.mode === 'standard') d.flowRet = d.flowExt;
      renderWin(); return;
    }
    const st = e.target.closest('[data-step]');
    if (st && !st.disabled) {
      const k = st.dataset.step, dir = Number(st.dataset.d);
      if (k === 'timer') d.timer = TIMER_STEPS[Math.max(0, Math.min(TIMER_STEPS.length - 1, TIMER_STEPS.indexOf(d.timer) + dir))] || TIMER_STEPS[4];
      else if (k === 'prio') d.prio = Math.max(1, Math.min(((data.hyd && data.hyd.scvs) || []).length || 1, d.prio + dir));
      else d[k] = Math.max(0, Math.min(100, Math.round((d[k] + dir * FLOW_STEP) / FLOW_STEP) * FLOW_STEP));
      renderWin(); return;
    }
    const n = e.target.closest('[data-num]');
    if (n) {
      const k = n.dataset.num;
      if (k === 'timer') openNumpad('Detent Time (s)', v => { d.timer = TIMER_STEPS.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a); renderWin(); });
      else if (k === 'prio') return;
      else openNumpad(`${k === 'flowRet' ? 'Retract' : 'Extend'} Flow (0-10)`, v => { d[k] = Math.max(0, Math.min(100, Math.round(v * 10))); renderWin(); });
    }
  };
  $('hydSave').onclick = async () => {
    const d = draft, s = d && scvOf(d.index);
    if (!s) return;
    const arg = [`mode=${d.mode}`, `flowExt=${d.flowExt}`, `flowRet=${d.mode === 'standard' ? d.flowExt : d.flowRet}`, `detent=${d.detent}`,
      d.detent === 'timed' ? `timer=${d.timer}` : '', `prio=${d.prio}`].filter(Boolean).join(';');
    const ids = [await send('scvSet', 0, d.index, $('hydSave'), arg)];
    if ((s.bound || '') !== d.bound) ids.push(await send('scvAssign', 0, d.index, null, 'fn=' + d.bound));
    ids.forEach(id => { if (id) savedIds.add(id); });
    closeWin('hydWin');
  };
  $('appScv').onclick = () => open();
  function open(i) {
    closeWin('menu');
    const scvs = (data.hyd && data.hyd.scvs) || [];
    load(i || (scvOf(sel) ? sel : scvs[0] ? scvs[0].index : 1));
    openWin('hydWin');
    renderWin();
  }

  // ------------------------------------------------------------ every frame
  let lastResult = 0;
  function render(d) {
    const h = d.hyd;
    $('appScv').hidden = !h;
    const codes = new Set(((h && h.warnings) || []).map(w => w.code));
    edge('hydHot', codes.has('HYD_OIL_HOT'), WARN.HYD_OIL_HOT, 'warn');
    edge('hydPump', codes.has('HYD_PUMP'), WARN.HYD_PUMP, 'stop');
    edge('epgFault', !!(h && h.epg && h.epg.fault), 'EPG fault: electric drives have no power.', 'warn');
    // a refused SCV/EPG command: say why, once
    const r = h && h.result;
    if (r && r.id !== lastResult) {
      lastResult = r.id;
      if (!r.ok && (savedIds.has(r.id) || ['scvFloat', 'epgMode'].includes(r.cmd))) shade(`${r.cmd === 'epgMode' ? 'EPG' : 'SCV'} change not made: ${REASON[r.reason] || r.reason || 'refused'}.`, 'warn', 5000);
      savedIds.delete(r.id);
    }
    renderWin();
    if (!h) return;
    renderPage(h);
    renderEpg(h);
  }
  window.G5Hyd = { render, open };
})();

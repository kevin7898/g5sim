'use strict';
// G5Link display: AutoTrac (RTK package). The G5's four-quarter status pie, Steer ON/OFF, AutoTrac Diagnostics,
// the Last Exit Code, Steering Sensitivity, Track Spacing (distance or rows x row width) and Shift Master.
// The mod steers (scripts/Steering.lua); the settings travel with the guidance track (guidance.js -> /api/guidance).
//   stage 1/4 Installed: activation and receiver   2/4 Configured: track, no AI worker
//   stage 3/4 Enabled: Steer ON                     4/4 Engaged: Resume pressed (hardware key or here)

(function () {
  const STAGE = ['Not Installed', 'Installed', 'Configured', 'Enabled', 'Engaged'];
  const DIAG = [
    ['activation', 'AutoTrac activation'], ['receiver', 'StarFire receiver'], ['steerable', 'Steering controller'],
    ['track', 'Guidance track set'], ['noAi', 'No AI worker driving'], ['steerOn', 'Steer ON'],
    ['speed', 'Speed over 0.5 km/h'], ['heading', 'Heading within 80° of the track'], ['onTrack', 'Within 40% of track spacing'],
  ];
  const EXIT = {
    off: 'Turned off by the operator', manual: 'Steering wheel moved', steerOff: 'Steer turned OFF', slow: 'Speed under 0.5 km/h',
    reverse: 'Reverse for over 45 s', lost: 'Too far off the track', heading: 'Heading over 80° off the track',
    offTrack: 'Not within 40% of track spacing', speed: 'Speed under 0.5 km/h', noTrack: 'No guidance track',
    aiActive: 'AI worker driving', needsActivation: 'No AutoTrac activation', needsReceiver: 'No StarFire receiver',
    notSteerable: 'Machine can not be steered', noVehicle: 'No machine',
  };
  const SHORT = { noTrack: 'Set a track', needsActivation: 'No activation', needsReceiver: 'No receiver', aiActive: 'AI driving',
    notSteerable: 'Not steerable', steerOff: 'Steer OFF', noVehicle: '---' };

  const stageOf = at => !at ? 0 : typeof at.stage === 'number' ? at.stage
    : at.state === 'engaged' || at.state === 'turning' ? 4 : at.state === 'ready' ? 3 : at.reason === 'noTrack' || at.reason === 'aiActive' ? 1 : 0;
  const diagOf = at => Object.fromEntries(String(at && at.diag || '').split(';').filter(Boolean).map(p => p.split('=')).map(([k, v]) => [k, v === '1']));
  function shortText(at) {
    if (!at) return '---';
    if (at.state === 'engaged') return 'Engaged';
    if (at.state === 'turning') return 'Turning';
    if (at.state === 'ready') return at.reason === 'steerOff' || at.steerOn === false ? 'Steer OFF' : 'Ready';
    return SHORT[at.reason] || 'Not ready';
  }

  // Four-quarter pie, filled clockwise from 12 o'clock; all green when engaged
  function pie(stage, state) {
    const q = [[24, 3, 45, 24], [45, 24, 24, 45], [24, 45, 3, 24], [3, 24, 24, 3]];
    const on = stage >= 4 ? (state === 'turning' ? '#ffb400' : '#4ee166') : 'currentColor';
    return `<svg viewBox="0 0 48 48" aria-hidden="true">${q.map(([x1, y1, x2, y2], i) =>
      `<path d="M24 24 L${x1} ${y1} A21 21 0 0 1 ${x2} ${y2} Z" fill="${i < stage ? on : 'none'}" ${i < stage ? '' : 'opacity=".35"'}/>`).join('')}
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3"/>
      <path d="M24 3v42M3 24h42" stroke="#1e1e1b" stroke-width="2"/></svg>`;
  }

  const lenIn = m => metric('distance') ? `${fmt(m * 100, 1)} cm` : `${fmt(m / 0.0254, 1)} in`;

  function render() {
    if ($('autotracWin').hidden) return;
    const gd = window.G5Guidance;
    const at = data.autotrac;
    if (!gd || data.state !== 'vehicle' || !at) {
      setHtml($('atBody'), `<p class="hint win-loading">${data.state === 'vehicle' ? 'Waiting for AutoTrac status from the game…' : 'Enter a machine to set up AutoTrac.'}</p>`);
      $('atResume').disabled = true; return;
    }
    const G = gd.get(), st = stageOf(at), dg = diagOf(at), eng = st === 4;
    const seg = (key, opts, cur) => `<div class="seg at-seg" data-at="${key}">${opts.map(([v, t]) =>
      `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const last = at.last || null;
    setHtml($('atBody'), `
      <div class="at-cols">
        <div>
          <div class="at-status s${st} ${at.state}">
            <span class="at-pie">${pie(st, at.state)}</span>
            <div><b>${st}/4 ${STAGE[st]}</b><span>${eng ? (at.state === 'turning' ? 'Turning onto the next pass' : 'Steering on ' + esc((gd.track() || {}).name || 'the track'))
              : st === 3 ? 'Press Resume to engage' : esc(EXIT[at.reason] || 'See AutoTrac Diagnostics')}</span></div>
          </div>
          <div class="set-row"><span>Steer</span>${seg('steerOn', [[false, 'OFF'], [true, 'ON']], G.steerOn !== false)}</div>
          <div class="set-row"><span>Last Exit Code</span><em class="at-exit">${last ? esc(EXIT[last] || last) : 'None'}</em></div>
          <div class="set-row"><span>Steering Sensitivity</span><button class="g5btn at-val" data-num="sens">${G.sens || 70}</button></div>
          <div class="set-row"><span>Shift Master</span>${seg('shiftMaster', [[false, 'Off'], [true, 'On']], G.shiftMaster !== false)}</div>
        </div>
        <div>
          <h4>AutoTrac Diagnostics</h4>
          <ul class="at-diag">${DIAG.map(([k, t]) => {
            const ok = k in dg ? dg[k] : k === 'steerOn' ? G.steerOn !== false : null;
            return `<li class="${ok === null ? '' : ok ? 'ok' : 'bad'}"><i>${ok === null ? '–' : ok ? '✓' : '✕'}</i>${esc(t)}</li>`;
          }).join('')}</ul>
        </div>
      </div>
      <div class="set-row at-spacing"><span>Track Spacing</span><div class="hl-right">
        ${seg('spacingMode', [['distance', 'Distance'], ['rows', 'Rows']], G.spacingMode || 'distance')}
        ${G.spacingMode === 'rows'
          ? `<button class="g5btn at-val" data-num="rows">${G.rows} rows</button><span class="at-x">×</span><button class="g5btn at-val" data-num="rowWidth">${lenIn(G.rowWidth)}</button>`
          : `<button class="g5btn at-val" data-num="spacing">${gd.lenText(gd.spacing())}</button>`}
        <em class="at-eq">${G.spacingMode === 'rows' ? '= ' + gd.lenText(gd.spacing()) : ''}</em></div></div>
      <p class="hint">Resume engages within 80° of the track and 40% of the spacing of a pass. Bind the Resume key in the game's
        controls (G5Link Resume, Alt+R). Higher sensitivity steers harder. While engaged the track can't change and shifts are limited to ${metric('distance') ? '0.3 m' : '12 in'}.</p>`);
    $('atResume').disabled = false;
    $('atResume').textContent = eng ? 'Disengage' : 'Resume';
    $('atResume').classList.toggle('on', eng);
  }

  $('atBody').onclick = e => {
    const gd = window.G5Guidance;
    if (!gd) return;
    const b = e.target.closest('[data-v]'), sg = b && b.closest('[data-at]');
    if (sg) {
      const key = sg.dataset.at, raw = b.dataset.v, v = raw === 'true' ? true : raw === 'false' ? false : raw;
      gd.set({ [key]: v });
      gd.send();
      return render();
    }
    const n = e.target.closest('[data-num]');
    if (!n) return;
    const k = n.dataset.num, done = patch => { gd.set(patch); gd.send(); render(); };
    if (k === 'sens') openNumpad('Steering Sensitivity (50-200)', v => done({ sens: Math.round(Math.max(50, Math.min(200, v))) }));
    else if (k === 'rows') openNumpad('Number of Rows', v => done({ rows: Math.max(1, Math.min(96, Math.round(v))) }));
    else if (k === 'rowWidth') openNumpad(`Row Width (${metric('distance') ? 'cm' : 'in'})`, v => v > 0 && done({ rowWidth: metric('distance') ? v / 100 : v * 0.0254 }));
    else if (k === 'spacing') openNumpad(`Track Spacing (${metric('distance') ? 'm' : 'ft'})`, v => v > 0 && done({ spacing: metric('distance') ? v : v / 3.28084 }));
  };

  // Resume on the screen (the hardware Resume key does the same in the game)
  function resume(el) {
    const at = data.autotrac, st = stageOf(at);
    if (st === 4) return send('autotrac', 0, 0, el);
    if (st < 3) return shade(`AutoTrac is at ${st}/4: ${EXIT[at && at.reason] || 'see AutoTrac Diagnostics'}.`, 'info', 3500);
    send('autotrac', 1, 0, el);
  }
  $('atResume').onclick = () => resume($('atResume'));
  $('atSwap').onclick = () => window.G5Guidance && G5Guidance.swap();

  window.G5AutoTrac = {
    pie, stageOf, shortText, resume,
    open() { openWin('autotracWin'); render(); },
    onTelemetry() { render(); },
  };
})();

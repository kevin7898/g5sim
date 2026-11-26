'use strict';
// G5Link display: remote for Courseplay Grain Cart (MMP Farms add-on, optional). Commands go to the mod
// as grainCart with index = the add-on's GC_COMMANDS number; the mod calls its GrainCartCommandEvent.

(function () {
  const CMD = { call: 1, forward: 2, back: 3, pause: 4, release: 5, unload: 6, left: 7, right: 8, away: 9 };
  const KIND = { waiting: 'Waiting', pathfinding: 'Finding a path', driving: 'Driving to you', unloading: 'Under the pipe',
    outOfPosition: 'Waiting to line up', lettingPass: 'Letting you pass', movingAway: 'Moving away', goingToUnload: 'Unloading at truck', busy: 'Busy' };
  const SHORT = { waiting: 'WAITING', pathfinding: 'PATHING', driving: 'COMING', unloading: 'AT PIPE', outOfPosition: 'LINE UP',
    lettingPass: 'PASSING', movingAway: 'AWAY', goingToUnload: 'UNLOAD', busy: 'BUSY' };
  const gc = () => data.grainCart || null;
  const stateText = g => !g || !g.name ? 'No grain cart in range' : g.paused ? 'Paused' : g.released ? 'Released (call to resume)' : KIND[g.kind] || 'Busy';
  const shortText = g => !g || !g.name ? 'NONE' : g.paused ? 'PAUSED' : g.released ? 'RELEASED' : SHORT[g.kind] || 'BUSY';
  const lenTxt = m => metric('distance') ? (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, 0)} m`) : `${fmt(m * 3.28084, 0)} ft`;
  const nudgeTxt = m => `${m > 0 ? '+' : ''}${metric('distance') ? fmt(m, 1) + ' m' : fmt(m * 3.28084, 1) + ' ft'}`;

  function render() {
    if ($('grainCartWin').hidden) return;
    const g = gc();
    const pct = g && g.cap ? g.fill / g.cap * 100 : null;
    const has = !!(g && g.name);
    const dis = has ? '' : 'disabled';
    setHtml($('gcBody'), `
      <div class="gc-head ${has ? (g.paused || g.released ? 'warn' : 'ok') : ''}">
        <div><b>${esc(has ? g.name : 'Grain Cart')}</b><span>${esc(stateText(g))}${has && g.dist !== undefined ? ' · ' + lenTxt(g.dist) : ''}</span></div>
        ${g && g.carts > 1 ? `<button class="g5btn gc-next" data-gc="next">Next Cart (${g.carts})</button>` : ''}
      </div>
      <div class="gc-main">
        <div class="gc-fill"><div class="hv-tank"><i style="height:${(pct ?? 0).toFixed(0)}%"></i><b>${pct === null ? '--' : fmt(pct, 0)}%</b></div>
          <span>${has && g.fill !== undefined ? HU.tank(g.fill) : '---'}</span></div>
        <div class="gc-cmds">
          <button class="g5btn gc-big" data-gc="call" ${dis}>Call</button>
          <button class="g5btn gc-big ${g && g.paused ? 'on' : ''}" data-gc="pause" ${dis}>${g && g.paused ? 'Resume' : 'Pause'}</button>
          <button class="g5btn gc-big" data-gc="release" ${dis}>Release</button>
          <button class="g5btn gc-big" data-gc="unload" ${dis}>Unload</button>
          <button class="g5btn gc-big" data-gc="away" ${dis}>Move Away</button>
        </div>
        <div class="gc-nudge">
          <small>Position under the pipe</small>
          <button class="g5btn" data-gc="forward" ${dis}>▲</button>
          <div><button class="g5btn" data-gc="left" ${dis}>◀</button><b>${has ? nudgeTxt(g.nudgeX || 0) + ' / ' + nudgeTxt(g.nudge || 0) : '---'}</b><button class="g5btn" data-gc="right" ${dis}>▶</button></div>
          <button class="g5btn" data-gc="back" ${dis}>▼</button>
          <small>Left/right ${metric('distance') ? '0.5 m' : '1.6 ft'}, forward/back ${metric('distance') ? '1 m' : '3.3 ft'} per tap</small>
        </div>
      </div>
      <p class="hint">Needs Courseplay with the Courseplay Grain Cart add-on (MMP Farms) and a Courseplay "Unload combine" job on the cart tractor.
        Release and Move Away stop this harvester calling the cart until you press Call.</p>`);
  }
  $('gcBody').onclick = e => {
    const b = e.target.closest('[data-gc]');
    if (!b || b.disabled) return;
    if (b.dataset.gc === 'next') return send('grainCartNext', 0, 0, b);
    send('grainCart', 0, CMD[b.dataset.gc], b);
  };
  function open() { closeWin('menu'); openWin('grainCartWin'); render(); }
  $('appGrainCart').onclick = open;

  window.G5GrainCart = { open, render, shortText, stateText, call: el => send('grainCart', 0, CMD.call, el) };
})();

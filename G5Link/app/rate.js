'use strict';
// G5Link display: Rate Controller for sprayers and spreaders (RateControl.lua): the soil mod in use
// (Precision Farming or Realistic Soil & Fertilizer), Auto or Manual, rate steps, and the prescription.

(function () {
  const SYS = { pf: 'Precision Farming', sf: 'Realistic Soil & Fertilizer' };
  const valTxt = r => r.system === 'sf' ? `${fmt(r.value, 2)}×` : `Level ${fmt(r.value, 0)}`;
  function shortTxt(r) {
    if (!r) return '--';
    if (r.rxActive && r.rxRate !== undefined) return `RX ${fmt(r.rxRate, 2)}×`;
    return r.auto ? 'AUTO' : r.system === 'sf' ? `${fmt(r.value, 2)}×` : `LVL ${fmt(r.value, 0)}`;
  }
  function render() {
    if ($('rateWin').hidden) return;
    const r = data.rate;
    setHtml($('rateBody'), !r ? '<p class="hint win-loading">No sprayer or spreader with rate control is attached.</p>' : `
      <div class="hl-status ${r.rxActive ? 'raised' : r.auto ? 'armed' : ''}"><b>${esc(SYS[r.system] || r.system)}</b>
        <span>${r.rxActive ? `Prescription ${esc(r.rxName || '')}: ${fmt(r.rxRate, 2)}× here` : r.rx ? `Prescription ${esc(r.rxName || '')} ready, applies while the sprayer is on` : 'No prescription in use (Ops Center > Field > Prescriptions)'}</span></div>
      <div class="set-row"><span>Mode</span><div class="seg" id="rateMode"><button data-v="1" class="${r.auto ? 'on' : ''}" ${r.rxActive ? 'disabled' : ''}>Auto</button><button data-v="0" class="${!r.auto ? 'on' : ''}">Manual</button></div></div>
      <div class="set-row"><span>Rate</span><div class="tl-set rate-set"><button class="g5btn tl-step" data-step="-1" ${r.auto || r.rxActive ? 'disabled' : ''}>−</button>
        <div class="tl-setpoint"><small>${r.auto ? 'Set by ' + esc(SYS[r.system] || '') : 'Manual'}</small><b>${valTxt(r)}</b></div>
        <button class="g5btn tl-step" data-step="1" ${r.auto || r.rxActive ? 'disabled' : ''}>+</button></div></div>
      <p class="hint">Auto lets ${esc(SYS[r.system] || 'the soil mod')} vary the rate from its soil maps. A prescription from the Ops Center sets the rate zone by zone instead.</p>`);
  }
  $('rateBody').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.closest('#rateMode')) return send('rateAuto', Number(b.dataset.v), 0, b);
    if (b.dataset.step) send('rateStep', Number(b.dataset.step), 0, b);
  };
  function open() { closeWin('menu'); openWin('rateWin'); render(); }
  window.G5Rate = { open, render, shortTxt };
  $('appRate').onclick = open;
})();

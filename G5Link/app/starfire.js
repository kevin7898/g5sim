'use strict';
// G5Link display: StarFire (RTK package). Receiver, correction mode, accuracy and RTK-X like the G5's
// StarFire application; subscriptions, activations and base stations for this machine. Changes go to the
// mod as "rtk" commands (scripts/Rtk.lua); farm-wide lists come from /api/rtk.

(function () {
  const S = { state: null, at: 0, lastResult: 0 };
  const SUBS = [['SF2', 'SF2', 'Pass to pass ±5 cm'], ['SF3', 'SF3', 'Pass to pass ±3 cm'],
    ['MRTK', 'Mobile RTK', 'RTK over the cell network, ±2.5 cm'], ['SFRTK', 'SF-RTK', 'RTK from satellite, needs StarFire 7000']];
  const ERR = { needsSF7000: 'SF-RTK needs a StarFire 7000 receiver.', needsSF6000: 'This needs a StarFire 6000 or newer.',
    needsReceiver: 'This machine has no GPS receiver. Fit one in the shop (Customize).', changeInShop: 'This machine\'s GPS is a shop option: change it in the shop (Customize).', notServer: 'Only the host can change subscriptions.',
    unknownSubscription: 'Unknown subscription.', badPosition: 'No position for the base station.' };
  const money = v => (typeof v === 'number' ? '$' + Math.round(v).toLocaleString() : '---');
  const cm = m => metric('distance') ? `±${fmt(m * 100, 1)} cm` : `±${fmt(m * 39.37, 1)} in`;
  const lenTxt = m => metric('distance') ? (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, 0)} m`) : (m >= 1609 ? `${fmt(m / 1609.34, 2)} mi` : `${fmt(m * 3.28084, 0)} ft`);
  const compass = b => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
  const days = min => min >= 1440 ? `${fmt(min / 1440, 1)} days` : min >= 60 ? `${fmt(min / 60, 1)} h` : `${fmt(min, 0)} min`;

  async function load() {
    S.at = Date.now();
    try { S.state = (await (await fetch('/api/rtk')).json()).rtk; } catch (e) { /* offline */ }
    render();
  }
  function rtk(arg, el) { send('rtk', 0, 0, el, arg); setTimeout(load, 900); }

  function mine() {
    const st = S.state;
    if (!st || !st.vehicles) return null;
    const name = data.vehicle && data.vehicle.name;
    return st.vehicles.find(v => v.level) || st.vehicles.find(v => v.name === name) || null;
  }

  function render() {
    if ($('starfireWin').hidden) return;
    const g = data.gnss, st = S.state || {}, me = mine(), prices = st.prices || {};
    const subs = new Set(me ? me.subs : []);
    const head = !g ? '<p class="hint">No receiver data. Get in a machine.</p>' : `
      <div class="sf-grid">
        <div><small>Receiver${g.hwSource === 'shop' ? ' (shop option)' : ''}</small><b title="${esc(g.hwOption || '')}">${esc(g.receiverName || g.receiver)}</b></div>
        <div><small>Correction</small><b class="sf-mode ${g.level}">${esc(g.src || g.level)}</b></div>
        <div><small>Accuracy</small><b>${fmt(g.accuracy, 0)}%</b></div>
        <div><small>Pass to Pass</small><b>${cm(g.p2p || 0)}</b></div>
        <div><small>RTK-X</small><b>${g.rtkxMin !== undefined ? days(g.rtkxMin) + ' left' : g.src === 'RTK-X' ? 'Active' : '---'}</b></div>
        <div><small>Base Station</small><b>${g.base ? `${esc(g.base)} · ${g.baseState === 'survey' ? 'Surveying' : lenTxt(g.baseDist) + ' ' + compass(g.baseBearing)}${g.inRange === false ? ' (out of range)' : ''}` : 'None'}</b></div>
      </div>`;
    const subRows = SUBS.map(([k, label, note]) => {
      const rc = me ? me.receiver : 'SF6000';
      const blocked = rc === 'NONE' || (k === 'SFRTK' && rc !== 'SF7000') || (rc === 'SF3000' && (k === 'SF3' || k === 'MRTK'));
      const on = subs.has(k), needs7000 = blocked;
      return `<div class="sf-row"><span><b>${label}</b><small>${note}</small></span><em>${money(prices[k])}/month</em>
        <button class="g5btn ${on ? 'on' : ''}" data-sub="${k}" data-on="${on ? 0 : 1}" ${needs7000 && !on ? 'disabled' : ''}>${on ? 'Cancel' : 'Subscribe'}</button></div>`;
    }).join('');
    const bases = (st.bases || []);
    setHtml($('sfBody'), `${head}
      <div class="sf-cols">
        <div><h4>Subscriptions${me ? ' · ' + esc(me.name) : ''}</h4>${subRows}
          <div class="sf-row total"><span><b>This machine</b></span><em>${money(me ? me.monthly : 0)}/month</em><span></span></div></div>
        <div><h4>Activations</h4>
          <div class="sf-row"><span><b>RTK</b><small>Use your own base station by radio</small></span><em>${money(prices.RTK)}</em>
            <button class="g5btn" data-buy="RTK" ${me && (me.rtk || me.receiver === 'NONE') ? 'disabled' : ''}>${me && me.rtk ? (me.hwSource === 'shop' ? 'In option' : 'Active') : 'Buy'}</button></div>
          <div class="sf-row"><span><b>StarFire 7000</b><small>Needed for SF-RTK</small></span><em>${money(prices.SF7000)}</em>
            ${me && me.hwSource === 'shop' ? `<em class="sf-shop">In the shop</em>` : `<button class="g5btn" data-buy="SF7000" ${me && me.receiver === 'SF7000' ? 'disabled' : ''}>${me && me.receiver === 'SF7000' ? 'Fitted' : 'Upgrade'}</button>`}</div>
          ${me && me.hwSource === 'shop' ? `<p class="hint">GPS on this machine is a shop option${me.hwOption ? ': ' + esc(me.hwOption) : ''}. Change the receiver with Customize in the shop.</p>` : ''}
          ${me && me.receiver === 'NONE' ? '<p class="hint">No GPS receiver: corrections, headland automation and the Grain Cart remote need one.</p>' : me && me.receiver === 'SF3000' ? '<p class="hint">StarFire 3000: SF1 and SF2, RTK by radio, RTK-X 15 min.</p>' : ''}
          <h4>Base Stations</h4>
          ${bases.length ? bases.map(b => `<div class="sf-row"><span><b>${esc(b.name)}</b><small>${b.state === 'survey' ? `Self survey, ${days(b.surveyLeftMin)} left` : 'OK'} · range ${lenTxt(st.baseRange || 3000)}</small></span><em></em><span></span></div>`).join('')
            : `<p class="hint">No base station. Build an RTK station from the construction menu${(st.stationItems || []).length ? '' : ' (needs an RTK station mod, e.g. John Deere RTK Stations)'}.</p>`}
        </div>
      </div>
      <div class="sf-foot"><span>Feature requirements</span>
        <div class="seg" id="sfGates"><button data-v="1" class="${st.gates !== false ? 'on' : ''}">On</button><button data-v="0" class="${st.gates === false ? 'on' : ''}">Off</button></div>
        <small>Headland automation needs SF2, the Grain Cart remote SF3.${st.payer ? ` Billed through ${esc(st.payer)}.` : ' Billed monthly in the game finances.'}</small></div>`);
  }

  $('sfBody').onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const prices = (S.state && S.state.prices) || {};
    if (b.dataset.sub) {
      const k = b.dataset.sub, on = b.dataset.on === '1', label = SUBS.find(x => x[0] === k)[1];
      if (on) confirmBox('StarFire', `Subscribe to ${label} for ${money(prices[k])} a month on this machine?`, () => rtk(`action=sub;vehicle=current;item=${k};on=1`, b));
      else rtk(`action=sub;vehicle=current;item=${k};on=0`, b);
      return;
    }
    if (b.dataset.buy) {
      const k = b.dataset.buy;
      return confirmBox('StarFire', `${k === 'RTK' ? 'Buy the RTK activation' : 'Upgrade to a StarFire 7000'} for ${money(prices[k])}?`, () => rtk(`action=buy;vehicle=current;item=${k}`, b));
    }
    const seg = b.closest('#sfGates');
    if (seg) rtk(`action=gates;on=${b.dataset.v}`, b);
  };

  function open() { closeWin('menu'); openWin('starfireWin'); load(); }
  $('appStarfire').onclick = open;

  function onTelemetry(d) {
    const g = d.gnss;
    // title bar: the correction mode next to the satellite icon, as on the G5
    if (g && d.link === 'live' && d.state === 'vehicle') {
      $('scLinkTxt').textContent = g.src === 'RTK-X' ? 'RTK-X' : (g.src || g.level);
      const bars = g.level === 'RTK' ? 5 : g.level === 'SF3' ? 4 : g.level === 'SF2' ? 3 : g.level === 'SF1' ? 2 : 1;
      const shown = Math.max(1, Math.round(bars * Math.min(1, (g.accuracy || 0) / 100)));
      document.querySelectorAll('#scBars i').forEach((b, i) => b.classList.toggle('on', i < shown));
    }
    const r = g && g.result;
    if (r && r.id && r.id !== S.lastResult) {
      S.lastResult = r.id;
      if (r.ok === false) shade(ERR[r.error] || `Not done: ${r.error || 'refused'}`, 'warn', 4000);
      load();
    }
    if (!$('starfireWin').hidden) { if (Date.now() - S.at > 5000) load(); else render(); }
  }

  window.G5StarFire = { open, onTelemetry, allows: f => { const g = data.gnss; return !g || g.gates === false || !g.gate || g.gate[f] !== false; } };
})();

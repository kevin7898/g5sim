'use strict';
// G5Link display: shortcut keys and the Layout Manager (Shortcut Bars).
// Every key lives in one registry (KEYS): icon, label, which app it belongs to, whether this machine has it, its
// state and what a tap does. A bar is a list of key ids. The "Automatic" bar picks keys for the machine (fixed
// keys plus the four most useful extras); named bars are edited in Menu > Layout Manager, like the G5's
// Layout Manager > Shortcut Bars. Bars can be chosen per machine type (tractor, combine).
// Key look as on the G5 (G5 Field Guide pp. 5, 43): only keys that toggle a function have the status strip, black
// with white text (off) or green with white text (on); keys that open an app have none (strip: false). Keys with an
// automatic mode show a round LED and AUTO across the top; value keys show the value; the AutoTrac key shows the
// blue status pie; keys this machine can't use are grayed out.

(function () {
  const MAX_KEYS = 12;                     // plus MENU: the G5 frame fits 13
  const v = d => d.state === 'vehicle' ? d.vehicle : null;
  const imps = d => d.implements || [];
  const ctl = d => d.controls || {};
  const onOff = b => b ? 'ON' : 'OFF';
  const atOn = at => !!at && (at.state === 'engaged' || at.state === 'turning');
  const AUTO_STATE = { active: 'ON', standby: 'STBY', cruiseOff: 'STBY', notThreshing: 'STBY', noCrop: 'STBY', ai: 'AI', off: 'OFF' };
  const cmd = (name, value = 0) => el => send(name, value, 0, el);

  // app: the Menu application a key belongs to (the Layout Manager's library groups)
  const KEYS = [
    { id: 'engine', app: 'Tractor', label: 'ENGINE', icon: 'engine', help: 'Starts or stops the engine.',
      avail: d => !!v(d), state: d => ({ on: v(d).motorOn, txt: onOff(v(d).motorOn) }), tap: cmd('motorToggle') },
    { id: 'cruise', app: 'Tractor', label: 'CRUISE', icon: 'cruise', help: 'Turns cruise control on or off. Set the speed on the Tractor page.',
      avail: d => !!v(d), state: d => ({ on: v(d).ccState > 0, txt: onOff(v(d).ccState > 0) }), tap: cmd('cruiseToggle') },
    { id: 'hitch', app: 'Tractor', label: 'LOWER/RAISE', icon: 'hitch', help: 'Lowers or raises every implement.',
      avail: d => imps(d).length > 0, state: d => { const l = imps(d).some(i => i.lowered); return { on: l, txt: l ? 'LOWERED' : 'RAISED' }; }, tap: cmd('lowerAll') },
    { id: 'turnon', app: 'Tractor', label: 'TURN ON', icon: 'pto', help: 'Turns every implement on or off.',
      avail: d => imps(d).length > 0, state: d => { const o = imps(d).some(i => i.turnedOn); return { on: o, txt: onOff(o) }; }, tap: cmd('turnOnAll') },
    { id: 'pipe', app: 'Tractor', label: 'AUGER', icon: 'auger', help: 'Swings the unloading auger out or in.',
      avail: d => !!ctl(d).pipe, state: d => ({ on: ctl(d).pipe.open, txt: ctl(d).pipe.open ? 'OUT' : 'IN' }), tap: cmd('pipeToggle') },
    { id: 'fold', app: 'Tractor', label: 'FOLD', icon: 'fold', help: 'Folds or unfolds the implement.',
      avail: d => !!ctl(d).fold, state: d => { const f = ctl(d).fold; return { on: f.unfolded, amber: f.moving, txt: f.moving ? 'MOVING' : f.unfolded ? 'UNFOLDED' : 'FOLDED' }; },
      tap: cmd('foldToggle') },
    { id: 'worklights', app: 'Tractor', label: 'WORK LIGHTS', icon: 'worklight', help: 'Work lights on or off.',
      avail: d => ctl(d).workFront !== undefined, state: d => { const o = ctl(d).workFront || ctl(d).workBack; return { on: o, txt: onOff(o) }; }, tap: cmd('workLightsToggle') },
    { id: 'beacon', app: 'Tractor', label: 'BEACON', icon: 'beacon', help: 'Beacon lights on or off.',
      avail: d => ctl(d).beacon !== undefined, state: d => ({ on: ctl(d).beacon, txt: onOff(ctl(d).beacon) }), tap: cmd('beaconToggle') },
    { id: 'hazard', app: 'Tractor', label: 'HAZARD', icon: 'hazard', help: 'Hazard lights on or off.',
      avail: d => ctl(d).hazard !== undefined, state: d => ({ amber: ctl(d).hazard, txt: onOff(ctl(d).hazard) }), tap: cmd('hazardToggle') },
    { id: 'lights', app: 'Tractor', label: 'LIGHTS', icon: 'headlight', help: 'Road lights on or off.',
      avail: d => ctl(d).lights !== undefined, state: d => ({ on: ctl(d).lights, txt: onOff(ctl(d).lights) }), tap: cmd('lightsToggle') },

    { id: 'setup', app: 'Work', label: 'SETUP', icon: 'setup', nostrip: true, help: 'Work Setup: client, farm, field, crop and variety.',
      avail: () => true, state: d => window.G5WorkSetup ? G5WorkSetup.keyState(d) : { txt: '--' }, tap: () => window.G5WorkSetup && G5WorkSetup.open() },
    { id: 'work', app: 'Work', label: 'WORK', icon: 'work', help: 'Opens the Work Monitor. AUTO: recording starts and stops with the implement.',
      avail: () => true, state: d => { const r = !!(d.work && d.work.recording); return { on: r, txt: onOff(r), led: r ? 'on' : 'off' }; },
      tap: () => showPage('Work Monitor') },

    { id: 'autotrac', app: 'Guidance', label: 'AUTOTRAC', pie: true, help: 'AutoTrac settings: Steer ON, diagnostics, sensitivity. The pie shows the stage; press Resume to engage.',
      avail: d => !!d.autotrac, auto: d => !!d.autotrac && !(d.autotrac.state === 'notReady' && d.autotrac.reason === 'noTrack'),
      state: d => { const at = d.autotrac; return { on: atOn(at), amber: at.state === 'turning', txt: atOn(at) ? 'ON' : 'OFF', pie: window.G5AutoTrac ? G5AutoTrac.stageOf(at) : 0, pieState: at.state }; },
      tap: () => window.G5AutoTrac && G5AutoTrac.open() },
    { id: 'resume', app: 'Guidance', label: 'RESUME', icon: 'wheel', help: 'Engages AutoTrac (or disengages it), like the Resume button on the armrest.',
      avail: d => !!d.autotrac, state: d => ({ on: atOn(d.autotrac), txt: atOn(d.autotrac) ? 'ENGAGED' : (window.G5AutoTrac ? G5AutoTrac.shortText(d.autotrac) : '--').toUpperCase() }),
      tap: el => window.G5AutoTrac && G5AutoTrac.resume(el) },
    { id: 'guidance', app: 'Guidance', label: 'GUIDANCE', icon: 'guidance', nostrip: true, help: 'Opens the Guidance run page.',
      avail: () => true, state: () => { const t = window.G5Guidance && G5Guidance.track(); return { txt: t ? 'TRACK SET' : 'NO TRACK' }; }, tap: () => showPage('Guidance') },
    { id: 'swaptrack', app: 'Guidance', label: 'SWAP TRACK', icon: 'swap', nostrip: true, help: 'Steps to the next guidance track in this field.',
      avail: () => !!(window.G5Guidance && G5Guidance.tracks().length > 1),
      state: d => ({ txt: atOn(d.autotrac) ? 'LOCKED' : `${window.G5Guidance ? G5Guidance.tracks().length : 0} TRACKS` }), tap: () => window.G5Guidance && G5Guidance.swap() },
    { id: 'quickline', app: 'Guidance', label: 'QUICK LINE', icon: 'quickline', nostrip: true,
      help: 'Makes a straight track from where the machine is, along its heading (the G5 Quick Line).',
      avail: () => true, state: () => ({}), tap: () => window.G5Guidance && G5Guidance.quickLine() },
    { id: 'autoturn', app: 'Guidance', label: 'AUTO TURN', icon: 'autoturn', nostrip: true,
      help: 'Turn Automation on or off: AutoTrac turns onto the next pass at the headland. The LED lights when on.',
      avail: d => !!d.autotrac, state: () => { const t = window.G5Guidance && G5Guidance.turn(); return { led: t && t.on ? 'on' : 'off' }; },
      tap: () => { if (!window.G5Guidance) return; const on = !G5Guidance.turn().on; G5Guidance.setTurn({ on }); shade(`Turn Automation: ${on ? 'on' : 'off'}.`, 'info', 2000); } },
    { id: 'headland', app: 'Guidance', label: 'HEADLAND', icon: 'headland', help: 'Arms or disarms headland automation (raise, lower, speed). AUTO lights when armed.',
      avail: d => imps(d).some(i => i.canLower),
      state: d => { const hl = d.headland;
        return { on: !!(hl && hl.armed && hl.state === 'work'), amber: !!(hl && hl.armed && hl.state !== 'work'), led: hl && hl.armed ? 'on' : 'off',
          txt: !hl || !hl.armed ? 'OFF' : hl.state === 'headland' ? 'RAISED' : hl.state === 'manual' ? 'MANUAL' : hl.state === 'noSignal' ? 'NEEDS SF2' : 'ARMED' }; },
      tap: () => window.G5Headland && G5Headland.toggle() },

    { id: 'autospeed', app: 'Harvest', label: 'AUTO SPEED', icon: 'autospeed', help: 'Harvest automation: speed from the crop load (Realistic Harvesting).',
      avail: d => !!(d.combine && d.harvestAuto),
      state: d => { const a = d.harvestAuto; return { on: a.on && a.state === 'active', amber: a.on && a.state !== 'active', led: a.on ? 'on' : 'off', txt: a.on ? (AUTO_STATE[a.state] || 'STBY') : 'OFF' }; },
      tap: cmd('harvestAuto', -1) },
    { id: 'graincart', app: 'Harvest', label: 'GRAIN CART', icon: 'graincart', nostrip: true, help: 'Grain Cart remote (Courseplay add-on).',
      avail: d => !!(d.grainCart && (d.grainCart.carts > 0 || d.grainCart.inCart)),
      state: d => { const g = d.grainCart; return { on: !!(g.name && !g.paused && !g.released && (g.kind === 'unloading' || g.kind === 'driving')), amber: !!(g.paused || g.released),
        txt: window.G5GrainCart ? G5GrainCart.shortText(g) : '--' }; },
      tap: () => window.G5GrainCart && G5GrainCart.open() },

    { id: 'rate', app: 'Application', label: 'RATE', value: true, nostrip: true, help: 'Rate Controller: Auto, manual rate and prescriptions. The key shows the rate.',
      avail: d => !!d.rate,
      state: d => { const r = d.rate; const val = r.rxActive && r.rxRate !== undefined ? fmt(r.rxRate, 2) + '×' : r.system === 'sf' ? fmt(r.value, 2) + '×' : fmt(r.value, 0);
        return { on: !!r.rxActive, led: r.auto ? 'on' : 'off', value: val, txt: r.rxActive ? 'RX' : r.auto ? 'AUTO' : 'MANUAL' }; },
      tap: () => window.G5Rate && G5Rate.open() },

    { id: 'starfire', app: 'System', label: 'STARFIRE', icon: 'receiver', nostrip: true, help: 'StarFire receiver, corrections and the RTK package.',
      avail: d => !!d.gnss, state: d => ({ on: !!(d.gnss && d.gnss.level && d.gnss.level !== 'NONE'), txt: d.gnss && d.gnss.level ? String(d.gnss.level).toUpperCase() : '---' }),
      tap: () => $('appStarfire').click() },
    { id: 'display', app: 'System', label: 'DISPLAY', icon: 'display', help: 'Display settings: brightness, day/night, run pages.', nostrip: true,
      avail: () => true, state: () => ({}), tap: () => { openWin('menu'); selectTab('display'); } },
    { id: 'layout', app: 'System', label: 'LAYOUT', icon: 'layout', help: 'Layout Manager: shortcut bars.', nostrip: true,
      avail: () => true, state: () => ({}), tap: () => openManager() },
    { id: 'help', app: 'System', label: 'HELP', icon: 'help', help: 'What each key on this bar does.', nostrip: true,
      avail: () => true, state: () => ({}), tap: () => openHelp() },
  ];
  const BY_ID = Object.fromEntries(KEYS.map(k => [k.id, k]));
  const APPS = ['Tractor', 'Work', 'Guidance', 'Harvest', 'Application', 'System'];
  const FIXED = ['engine', 'cruise', 'hitch', 'turnon', 'work', 'setup'];
  const EXTRA = ['autotrac', 'rate', 'headland', 'autospeed', 'graincart', 'pipe', 'fold', 'worklights', 'beacon', 'hazard', 'lights'];
  const EXTRA_SLOTS = 4;

  // ---------------------------------------------------------------- bars (settings.skBars)
  const B = Object.assign({ bars: [], byType: { tractor: 'auto', combine: 'auto' } }, settings.skBars || {});
  B.byType = Object.assign({ tractor: 'auto', combine: 'auto' }, B.byType);
  settings.skBars = B;
  const saveBars = () => { settings.skBars = B; saveSettings(); };
  const machineType = d => d.combine ? 'combine' : 'tractor';
  const barById = id => B.bars.find(b => b.id === id) || null;
  const activeBar = d => barById(B.byType[machineType(d)]) || null;      // null = Automatic
  const safe = (fn, d, fb) => { try { return fn(d); } catch (e) { return fb; } };
  function autoKeys(d) {
    if (d.state !== 'vehicle') return [...FIXED, 'display'];
    const extra = EXTRA.filter(id => safe(BY_ID[id].auto || BY_ID[id].avail, d, false)).slice(0, EXTRA_SLOTS);
    return [...FIXED, ...extra, ...Array(EXTRA_SLOTS - extra.length).fill(null), 'display'];
  }
  const keysFor = d => { const b = activeBar(d); return b ? b.keys.filter(id => BY_ID[id]) : autoKeys(d); };

  // ---------------------------------------------------------------- key look
  function keyHtml(k, extraCls = '') {
    if (!k) return '<div class="sk empty"></div>';
    const top = k.pie ? '<i class="sk-pie"></i>' : k.value ? '<i class="sk-value">--</i>' : `<svg><use href="#i-${k.icon}"/></svg>`;
    return `<button class="sk ${extraCls}" data-key="${k.id}">${top}<i class="sk-auto" hidden><i></i>AUTO</i><b>${k.label}</b>` +
      `<span class="${k.nostrip ? 'nostrip' : ''}">${k.nostrip ? '' : '--'}</span></button>`;
  }
  function paintKey(el, k, d) {
    const ok = d.state === 'vehicle' ? safe(k.avail, d, false) : !!k.nostrip || k.id === 'setup' || k.id === 'work' || k.id === 'guidance';
    const st = ok ? safe(k.state, d, {}) || {} : {};
    el.classList.toggle('dis', !ok);
    el.classList.toggle('on', !!st.on);
    el.classList.toggle('amber', !!st.amber && !st.on);
    const strip = el.lastElementChild;
    if (!k.nostrip) strip.textContent = ok ? (st.txt ?? '--') : '---';
    const led = el.querySelector('.sk-auto');
    led.hidden = !ok || !st.led;
    led.classList.toggle('lit', st.led === 'on');
    el.classList.toggle('has-led', ok && !!st.led);
    if (k.pie) {
      const html = window.G5AutoTrac ? G5AutoTrac.pie(ok ? st.pie || 0 : 0) : '';
      const pe = el.querySelector('.sk-pie');
      if (pe.dataset.k !== html) { pe.dataset.k = html; pe.innerHTML = html; }
    }
    if (k.value) el.querySelector('.sk-value').textContent = ok ? st.value ?? '--' : '--';
  }

  let layoutKey = '';
  function render(d) {
    const ids = keysFor(d);
    const key = ids.join(',');
    const box = $('skBar');
    if (key !== layoutKey) {   // rebuild only when the set of keys changes, so a tap is never lost mid-render
      layoutKey = key;
      box.innerHTML = ids.map(id => keyHtml(id && BY_ID[id])).join('');
    }
    box.querySelectorAll('[data-key]').forEach(el => paintKey(el, BY_ID[el.dataset.key], d));
  }
  $('skBar').addEventListener('click', e => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    const k = BY_ID[el.dataset.key];
    if (el.classList.contains('dis')) return shade(`${k.label}: not available on this machine.`, 'info', 2500);
    k.tap(el, data);
  });

  // ---------------------------------------------------------------- HELP
  let kmMode = null;                       // 'help' or 'manager': what the keysWin window shows
  function openHelp() {
    kmMode = 'help';
    const ids = keysFor(data).filter(Boolean);
    setHtml($('kmBody'), `<div class="km-help">${ids.map(id => { const k = BY_ID[id];
      return `<div class="km-help-row">${keyHtml(k, 'mini')}<p><b>${esc(k.label)}</b> ${esc(k.help)}</p></div>`; }).join('')}</div>
      <p class="hint">Keys with a status strip switch something on or off; keys without one open an app. Gray keys can't be
        used on this machine. Change the bar in Menu > Layout Manager.</p>`);
    $('kmBody').querySelectorAll('[data-key]').forEach(el => paintKey(el, BY_ID[el.dataset.key], data));
    $('kmTitle').textContent = 'Shortcut Keys Help';
    openWin('keysWin');
  }

  // ---------------------------------------------------------------- Layout Manager > Shortcut Bars
  // Laid out like the G5's Layout Manager (G5 Field Guide pp. 10, 15, 16): list rows with a bold name and a count,
  // the selected row yellow with small yellow edit / duplicate / delete buttons, "+ Add New" under the list; the
  // bar editor has a yellow Add, Move left / right, and a Remove button with a trash can.
  const M = { sel: 'auto', key: null, adding: false, app: 'Tractor' };
  function openManager() {
    closeWin('menu');
    kmMode = 'manager';
    M.sel = B.byType[machineType(data)] || 'auto'; M.key = null; M.adding = false;
    if (M.sel !== 'auto' && !barById(M.sel)) M.sel = 'auto';
    $('kmTitle').textContent = 'Layout Manager: Shortcut Bars';
    openWin('keysWin'); renderManager();
  }
  const newId = () => 'b' + Date.now().toString(36);
  const ysq = (act, icon, label, dis) => `<button class="ysq" data-kmact="${act}" aria-label="${label}" ${dis ? 'disabled' : ''}><svg><use href="#i-${icon}"/></svg></button>`;
  function renderManager() {
    if ($('keysWin').hidden || kmMode !== 'manager') return;
    const bar = barById(M.sel), keys = bar ? bar.keys : autoKeys(data).filter(Boolean);
    const used = t => Object.entries(B.byType).filter(([, id]) => id === t).map(([m]) => m === 'combine' ? 'Combine' : 'Tractor');
    const usedTxt = id => { const u = used(id); return u.length ? 'In use: ' + u.join(', ') : ''; };
    const barRow = (id, name, sub) => `<div class="km-bar ${M.sel === id ? 'on' : ''}" data-bar="${id}">
        <svg class="km-bar-ico"><use href="#i-layout"/></svg><span class="km-bar-txt"><b>${esc(name)}</b><span>${sub}</span></span>
        ${M.sel === id ? `<span class="km-bar-act">${id === 'auto' ? '' : ysq('rename', 'pencil', 'Rename')}${ysq('dup', 'dup', 'Duplicate')}${id === 'auto' ? '' : ysq('delete', 'trash', 'Delete')}</span>` : ''}
      </div>`;
    const list = barRow('auto', 'Automatic', usedTxt('auto') || 'Picks keys for the machine') +
      B.bars.map(b => barRow(b.id, b.name, usedTxt(b.id) || `${b.keys.length} shortcut${b.keys.length === 1 ? '' : 's'}`)).join('');
    const use = (m, label) => `<button class="g5btn km-use ${B.byType[m] === M.sel ? 'on' : ''}" data-assign="${m}">${label}</button>`;
    const lib = M.adding ? `<div class="km-lib">
        <div class="seg km-apps">${APPS.map(a => `<button data-app="${a}" class="${M.app === a ? 'on' : ''}">${a}</button>`).join('')}</div>
        <div class="km-lib-keys">${KEYS.filter(k => k.app === M.app).map(k =>
          keyHtml(k, 'mini' + (keys.includes(k.id) ? ' used' : ''))).join('')}</div>
        <p class="hint">Tap a shortcut to add it. Each shortcut can be on a bar once. ${keys.length}/${MAX_KEYS} shortcuts.</p></div>` : '';
    const i = keys.indexOf(M.key);
    setHtml($('kmBody'), `<div class="km-cols">
      <div class="km-side">
        <div class="km-list">${list}</div>
        <button class="km-addnew" data-kmact="new"><i class="ysq"><svg><use href="#i-plus"/></svg></i><b>Add New</b></button>
        <h5>Use this bar on</h5><div class="km-uses">${use('tractor', 'Tractors')}${use('combine', 'Combines')}</div>
      </div>
      <div class="km-edit">
        <h4>${esc(bar ? bar.name : 'Automatic')}${bar ? '' : ' <em>(not editable: duplicate it to make your own)</em>'}</h4>
        <div class="km-keys">${keys.map(id => keyHtml(BY_ID[id], 'mini' + (M.key === id ? ' sel' : ''))).join('')}<div class="sk menu mini"><svg><use href="#i-menu"/></svg><b>MENU</b><span class="nostrip"></span></div></div>
        ${bar ? `<div class="km-tools">
          <button class="km-tool ${M.adding ? 'on' : ''}" data-km="add" ${keys.length >= MAX_KEYS && !M.adding ? 'disabled' : ''}><i class="ysq"><svg><use href="#i-plus"/></svg></i><b>Add Shortcut</b></button>
          <span class="km-move"><button class="km-round" data-km="left" aria-label="Move left" ${i > 0 ? '' : 'disabled'}><svg viewBox="0 0 48 48"><path d="M30 10L14 24l16 14z" fill="currentColor"/></svg></button><b>Move</b>
            <button class="km-round" data-km="right" aria-label="Move right" ${i >= 0 && i < keys.length - 1 ? '' : 'disabled'}><svg viewBox="0 0 48 48"><path d="M18 10l16 14-16 14z" fill="currentColor"/></svg></button></span>
          <button class="g5btn km-remove" data-km="remove" ${M.key ? '' : 'disabled'}><svg><use href="#i-trash"/></svg>Remove</button></div>
          <p class="hint km-tip">${M.key ? `${esc(BY_ID[M.key].label)} selected: move it or remove it.` : 'Tap a shortcut on the bar to select it.'}</p>` : ''}
        ${lib}
      </div></div>`);
    $('kmBody').querySelectorAll('[data-key]').forEach(el => paintKey(el, BY_ID[el.dataset.key], data));
  }
  const commit = () => { saveBars(); layoutKey = ''; render(data); renderManager(); };
  $('kmBody').onclick = e => {
    if (kmMode !== 'manager') return;
    const t = e.target;
    const act = t.closest('[data-kmact]');
    if (act) return barAction(act.dataset.kmact);
    const barBtn = t.closest('[data-bar]');
    if (barBtn) { M.sel = barBtn.dataset.bar; M.key = null; M.adding = false; return renderManager(); }
    const as = t.closest('[data-assign]');
    if (as) { const m = as.dataset.assign; B.byType[m] = B.byType[m] === M.sel ? 'auto' : M.sel; return commit(); }
    const app = t.closest('[data-app]');
    if (app) { M.app = app.dataset.app; return renderManager(); }
    const bar = barById(M.sel);
    const kb = t.closest('[data-key]');
    if (kb && bar) {
      const id = kb.dataset.key;
      if (kb.closest('.km-lib')) {
        if (bar.keys.includes(id)) return shade('Layout Manager: that shortcut is already on this bar.', 'info', 2000);
        if (bar.keys.length >= MAX_KEYS) return shade(`Layout Manager: a bar holds ${MAX_KEYS} shortcuts and MENU.`, 'info', 2500);
        bar.keys.push(id); M.key = id;
      } else M.key = M.key === id ? null : id;
      return commit();
    }
    const tool = t.closest('[data-km]');
    if (!tool || !bar || tool.disabled) return;
    const i = bar.keys.indexOf(M.key);
    if (tool.dataset.km === 'add') M.adding = !M.adding;
    else if (tool.dataset.km === 'remove' && i >= 0) { bar.keys.splice(i, 1); M.key = null; }
    else if (tool.dataset.km === 'left' && i > 0) [bar.keys[i - 1], bar.keys[i]] = [bar.keys[i], bar.keys[i - 1]];
    else if (tool.dataset.km === 'right' && i >= 0 && i < bar.keys.length - 1) [bar.keys[i + 1], bar.keys[i]] = [bar.keys[i], bar.keys[i + 1]];
    commit();
  };
  function addBar(name, keys) {
    const b = { id: newId(), name, keys };
    B.bars.push(b); M.sel = b.id; M.key = null; M.adding = !keys.length; saveBars(); renderManager();
  }
  const askName = (title, cur) => { const n = window.prompt(title, cur); return n && n.trim() ? n.trim().slice(0, 24) : null; };
  function barAction(a) {
    const bar = barById(M.sel);
    if (a === 'new') { const n = askName('Name of the new shortcut bar', `Bar ${B.bars.length + 1}`); if (n) addBar(n, []); }
    else if (a === 'dup') {
      const keys = bar ? [...bar.keys] : autoKeys(data).filter(Boolean);
      const n = askName('Name of the copy', `${bar ? bar.name : 'Automatic'} copy`); if (n) addBar(n, keys.slice(0, MAX_KEYS));
    } else if (a === 'rename' && bar) { const n = askName('Rename shortcut bar', bar.name); if (n) { bar.name = n; saveBars(); renderManager(); } }
    else if (a === 'delete' && bar) {
      confirmBox('Layout Manager', `Delete the shortcut bar ${bar.name}?`, () => {
        B.bars = B.bars.filter(b => b !== bar);
        for (const m of Object.keys(B.byType)) if (B.byType[m] === bar.id) B.byType[m] = 'auto';
        M.sel = 'auto'; commit();
      });
    }
  }

  window.G5Keys = { render, openManager, openHelp, keys: KEYS };
  $('appLayout').onclick = openManager;
  $('appHelp').onclick = () => { closeWin('menu'); openHelp(); };
})();

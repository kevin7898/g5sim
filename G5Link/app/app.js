'use strict';
// G5Link display: renders telemetry streamed by the bridge (/api/events) and posts commands (/api/cmd).

const $ = id => document.getElementById(id);
const display = $('display');
const W = 1280, H = 720;
// Fill Screen: keep the 1280-wide G5 layout and let the height (taller screens, e.g. a 4:3 iPad) or the width
// (wider screens) grow, so there are no black bars. The pages are grids, so the extra room goes to the map,
// tiles and windows.
const FILL = { minW: 1280, maxW: 1706, minH: 720, maxH: 1024 };


// ------------------------------------------------------------ fit the 16:9 canvas to the screen
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = W, h = H;
  if (typeof settings !== 'undefined' && settings.fit === 'fill' && vw > 0 && vh > 0) {
    const aspect = vw / vh;
    if (aspect < W / H) h = Math.round(Math.min(FILL.maxH, Math.max(FILL.minH, W / aspect)));
    else w = Math.round(Math.min(FILL.maxW, Math.max(FILL.minW, H * aspect)));
  }
  display.style.width = w + 'px';
  display.style.height = h + 'px';
  const s = Math.min(vw / w, vh / h);
  display.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

function setHtml(el, html) { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } }
function tile(title, value, unit = '', opts = {}) {
  const cls = ['tile', opts.on ? 'on' : '', opts.alert ? 'alert' : ''].join(' ');
  const meter = opts.pct === undefined || opts.pct === null ? '' :
    `<div class="meter"><i class="${opts.pct < 10 ? 'low' : ''}" style="width:${Math.max(0, Math.min(100, opts.pct)).toFixed(0)}%"></i></div>`;
  return `<div class="${cls}"><div class="t-title">${title}</div><div class="t-big"><span>${value}</span>${unit ? `<small>${unit}</small>` : ''}</div>${opts.sub ? `<div class="t-sub">${opts.sub}</div>` : ''}${meter}</div>`;
}

// ------------------------------------------------------------ pages
// Run pages are offered only when the machine in use supports them (like the G5, which only
// shows the run pages and applications of the detected machine and implements).
const pages = [...document.querySelectorAll('.page')];
const pageNames = pages.map(p => p.dataset.name);
const hasSeeder = d => (d.implements || []).some(i => i.seeder);
const PAGE_RULES = {
  'Guidance': () => true,
  'Tractor': d => !d.combine,
  'Harvesting': d => !!d.combine,
  'Harvest Automation': d => !!d.combine,
  'Tillage': d => (d.implements || []).some(i => i.tillage),
  'Planter': d => hasSeeder(d),
  'Work Monitor': d => (d.implements || []).length > 0 || !!d.combine,
  'Implement Details': d => (d.implements || []).length > 0,
  'Machine Monitor': () => true,
  'Field': d => { const p = d.providers || {}; return !!(p['soil-fertilizer'] || p['mud-system-physics'] || p.courseplay || p.autodrive); },
};
let available = pageNames.slice();                     // all pages until the first vehicle frame
if (typeof settings.page === 'number') { settings.pageName = pageNames[settings.page]; delete settings.page; }
const curIndex = () => Math.max(0, available.indexOf(settings.pageName));
function showPage(target) {
  // target: a page name, or an index into the available pages (wraps)
  let name = typeof target === 'string' ? target : available[((target % available.length) + available.length) % available.length];
  if (!available.includes(name)) name = available[0];
  settings.pageName = name;
  pages.forEach(p => p.classList.toggle('active', p.dataset.name === name));
  $('pageName').textContent = name;
  setHtml($('menuPages'), available.map((n, k) =>
    `<button class="app ${n === name ? 'on' : ''}" data-page="${esc(n)}"><span class="app-ico num">${k + 1}</span><b>${esc(n)}</b></button>`).join(''));
  document.querySelectorAll('#tab-apps [data-goto]').forEach(b => { b.hidden = !available.includes(b.dataset.goto); });
  saveSettings();
}
function updateAvailablePages(d) {
  if (d.state !== 'vehicle' || !d.vehicle) return;      // keep the last machine's pages while on foot or paused
  const next = pageNames.filter(n => (PAGE_RULES[n] || (() => true))(d));
  if (next.join('|') === available.join('|')) return;
  available = next;
  showPage(available.includes(settings.pageName) ? settings.pageName : available[0]);
}
$('prevPage').onclick = () => showPage(curIndex() - 1);
$('nextPage').onclick = () => showPage(curIndex() + 1);
$('menuPages').onclick = e => { const b = e.target.closest('[data-page]'); if (b) { showPage(b.dataset.page); closeWin('menu'); } };

let touchX = null;
$('pages').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('pages').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 80) showPage(curIndex() + (dx < 0 ? 1 : -1));
});

// ------------------------------------------------------------ windows
function openWin(id) { $(id).hidden = false; }
function closeWin(id) { $(id).hidden = true; }
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) { closeWin(c.dataset.close); return; }
  if (e.target.classList && e.target.classList.contains('window-wrap')) closeWin(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') ['menu', 'scPanel', 'confirm', 'numpad', 'trackWin', 'unitsWin', 'layerWin'].forEach(closeWin);
  if (e.key === 'ArrowRight') showPage(curIndex() + 1);
  if (e.key === 'ArrowLeft') showPage(curIndex() - 1);
});
$('menuBtn').onclick = () => { selectTab('pages'); openWin('menu'); };
$('tab-apps').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) { showPage(b.dataset.goto); closeWin('menu'); } };
$('appStatus').onclick = () => { closeWin('menu'); openWin('scPanel'); };
$('appReset').onclick = () => { closeWin('menu'); $('resetWork').onclick(); };
$('skPageSet').onclick = () => { openWin('menu'); selectTab('display'); };
$('statusCenter').onclick = () => openWin('scPanel');
function selectTab(name) {
  document.querySelectorAll('#menuTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  ['pages', 'apps', 'display'].forEach(t => { $('tab-' + t).hidden = t !== name; });
}
$('menuTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); };

function bindSeg(id, key, after) {
  const seg = $(id);
  const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings[key]));
  seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; settings[key] = b.dataset.v; saveSettings(); paint(); if (after) after(); render(); };
  paint();
}
function paintUnits() {
  const preset = unitPreset();
  $('unitSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === preset));
  $('unitCustom').hidden = preset !== 'custom';
  setHtml($('unitRows'), UNIT_KINDS.map(([k, label, m, us]) => `
    <div class="set-row"><span>${label}</span><div class="seg" data-unit="${k}">
      <button data-v="metric" class="${metric(k) ? 'on' : ''}">${m}</button><button data-v="imperial" class="${metric(k) ? '' : 'on'}">${us}</button>
    </div></div>`).join(''));
}
$('unitSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  UNIT_KINDS.forEach(([k]) => { settings.units[k] = b.dataset.v; });
  saveSettings(); paintUnits(); render();
};
$('unitRows').onclick = e => {
  const b = e.target.closest('button'), seg = e.target.closest('[data-unit]'); if (!b || !seg) return;
  settings.units[seg.dataset.unit] = b.dataset.v;
  saveSettings(); paintUnits(); render();
};
$('unitsBtn').onclick = () => { paintUnits(); openWin('unitsWin'); };
paintUnits();
bindSeg('modeSeg', 'mode', applyMode);
bindSeg('soundSeg', 'sound');
if (!settings.fit) settings.fit = 'fixed';
bindSeg('fitSeg', 'fit', fit);
fit();

// Full screen: the Fullscreen API where the browser has it (desktop, iPadOS Safari); otherwise, and on
// iPhone, the Home Screen app (manifest display: fullscreen) is the way to lose the browser bars.
const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: fullscreen)').matches
  || matchMedia('(display-mode: standalone)').matches;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function paintFs() {
  $('fsBtn').textContent = standalone() ? 'Home Screen App' : fsElement() ? 'Exit Full Screen' : 'Enter Full Screen';
}
$('fsBtn').onclick = async () => {
  if (standalone()) { shade('Already full screen: G5Link is running from the Home Screen.', 'info', 4000); return; }
  try {
    if (fsElement()) {
      await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
    } else {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) throw new Error('unsupported');
      await req.call(el);
    }
  } catch (e) {
    shade('This browser cannot go full screen from a page. On an iPad: tap Share, then Add to Home Screen, and open G5Link from the Home Screen.', 'info', 8000);
  }
  setTimeout(paintFs, 300);
};
document.addEventListener('fullscreenchange', () => { paintFs(); fit(); });
document.addEventListener('webkitfullscreenchange', () => { paintFs(); fit(); });
paintFs();
function applyMode() { display.classList.toggle('night', settings.mode === 'night'); }
applyMode();

function confirmBox(title, text, yes) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  openWin('confirm');
  $('confirmYes').onclick = () => { closeWin('confirm'); yes(); };
  $('confirmNo').onclick = () => closeWin('confirm');
}

// Numeric keypad (G5 style) for the cruise set speed
let numValue = '';
setHtml($('numKeys'), ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '', '0', '.', '', '']
  .map(k => k ? `<button class="g5btn" data-k="${k}">${k}</button>` : '<span></span>').join(''));
$('numKeys').onclick = e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const k = b.dataset.k;
  if (k === '⌫') numValue = numValue.slice(0, -1);
  else if (k === 'C') numValue = '';
  else if (k === '.' && numValue.includes('.')) return;
  else if (numValue.length < 5) numValue += k;
  $('numDisplay').textContent = numValue || '0';
};
let numCb = null;
function openNumpad(title, cb) {
  numValue = '';
  numCb = cb;
  $('numDisplay').textContent = '0';
  $('numTitle').textContent = title;
  openWin('numpad');
}
$('numOk').onclick = () => {
  const v = Number(numValue);
  closeWin('numpad');
  if (!numValue || Number.isNaN(v) || !numCb) return;
  numCb(v);
};
$('ccSetBtn').onclick = () => openNumpad(`Cruise Set Speed (${U.speedUnit()})`, v => send('cruiseSet', metric('speed') ? v : v / 0.621371));

// ------------------------------------------------------------ sound + window shade
let audio = null;
document.addEventListener('pointerdown', () => { if (!audio && window.AudioContext) audio = new AudioContext(); }, { once: true });
function beep(times = 1) {
  if (settings.sound !== 'on' || !audio) return;
  for (let i = 0; i < times; i++) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 2300; o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime + i * 0.22;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.start(t); o.stop(t + 0.16);
  }
}
let shadeTimer = null;
function shade(text, level = 'info', ms = 5000) {
  const el = $('shade');
  el.className = 'shade show ' + level;
  $('shadeIcon').textContent = level === 'info' ? 'i' : '!';
  $('shadeText').textContent = text;
  beep(level === 'stop' ? 3 : level === 'warn' ? 2 : 1);
  clearTimeout(shadeTimer);
  shadeTimer = setTimeout(() => { el.className = 'shade ' + level; }, ms);
}
$('shade').onclick = () => $('shade').classList.remove('show');

// ------------------------------------------------------------ commands
const pendingCmds = new Map();
async function send(name, value = 0, index = 0, el = null, arg = '') {
  try {
    const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value, index, arg }) });
    const j = await r.json();
    if (!j.ok) {
      // the bridge answered but refused it: say why (an older bridge doesn't know newer commands)
      shade(/unknown command/.test(j.error || '') ? `Command not sent: the bridge doesn't know "${name}". Update the G5Link bridge on the PC.`
        : `Command not sent: ${j.error || 'refused'}`, 'warn', 5000);
      return null;
    }
    if (el) {
      el.classList.add('pending'); pendingCmds.set(j.id, el);
      setTimeout(() => { el.classList.remove('pending'); pendingCmds.delete(j.id); }, 3000);
    }
    return j.id;
  } catch (e) {
    shade('Command not sent: G5Link bridge unreachable', 'warn', 3000);
    return null;
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  send(b.dataset.cmd, Number(b.dataset.value || 0), Number(b.dataset.index || 0), b);
});
$('resetWork').onclick = () => confirmBox('Work Monitor', 'Reset all work counters to zero?', () => send('resetWork'));
$('skWork').onclick = () => showPage('Work Monitor');

// ------------------------------------------------------------ derived rates
const samples = [];
function rates(work) {
  const now = Date.now();
  samples.push({ t: now, fuel: work.totalFuel || 0 });
  while (samples.length > 2 && now - samples[0].t > 60000) samples.shift();
  const a = samples[0], b = samples[samples.length - 1];
  // Need ~10 s of history: fuel is reported to 0.01 L, so shorter windows are noise.
  if (b.t - a.t < 10000 || b.fuel < a.fuel) return { fuelPerHour: null };
  return { fuelPerHour: (b.fuel - a.fuel) / ((b.t - a.t) / 3600000) };
}

// ------------------------------------------------------------ alerts (edge-triggered)
const alertState = {};
function edge(key, cond, text, level) {
  if (cond && !alertState[key]) shade(text, level);
  alertState[key] = !!cond;
}

// ------------------------------------------------------------ render
let data = { link: 'waiting' };

function render() {
  const d = data, v = d.vehicle || null, w = d.work || {}, imps = d.implements || [];
  const inVehicle = d.state === 'vehicle' && v;
  updateAvailablePages(d);

  // Title bar status center
  const link = d.link === 'live' && d.state !== 'unloaded' ? 'live' : d.link === 'down' ? 'down' : d.link === 'stale' || d.state === 'unloaded' ? 'stale' : 'wait';
  $('scLinkTxt').textContent = { live: 'LIVE', stale: 'PAUSED', down: 'OFFLINE', wait: 'WAIT' }[link];
  $('scLinkBadge').classList.toggle('show', link !== 'live');
  const barsOn = { live: 5, stale: 2, down: 0, wait: 1 }[link];
  document.querySelectorAll('#scBars i').forEach((b, i) => b.classList.toggle('on', i < barsOn));
  const g = d.game || {};
  $('scClock').textContent = g.hour !== undefined ? `${g.hour}:${String(g.minute || 0).padStart(2, '0')}` : '--:--';
  const pst = d.providerStatus || {};
  const modState = id => pst[id] ? (pst[id].available ? 'Found' : pst[id].mode === 'incompatible' ? 'Incompatible' : 'Not installed') : '---';
  setHtml($('scPanelGrid'), [
    ['Bridge Link', $('scLinkTxt').textContent], ['Game State', d.state || '---'], ['Game Day', g.day ?? '---'],
    ['Vehicle', inVehicle ? v.name : '---'], ['Work Recording', w.recording ? 'On' : 'Off'], ['Units', { metric: 'Metric', imperial: 'US', custom: 'Custom' }[unitPreset()]],
    ['Mod Version', d.version || '---'], ['Last Command', d.lastCmd ?? '---'],
    ['Realistic Harvesting', d.rh ? 'Found' : d.combine ? 'Not found' : '---'], ['Soil & Fertilizer', modState('soil-fertilizer')],
    ['Courseplay', modState('courseplay')], ['AutoDrive', modState('autodrive')],
  ].map(([k, val]) => `<div><small>${k}</small><b>${esc(val)}</b></div>`).join(''));

  for (const [id, el] of pendingCmds) if ((d.lastCmd || 0) >= id) { el.classList.remove('pending'); pendingCmds.delete(id); }

  // Alerts
  const fuelPct = v && v.fuelCap ? v.fuel / v.fuelCap * 100 : null;
  const defPct = v && v.defCap ? v.def / v.defCap * 100 : null;
  edge('down', d.link === 'down', 'Connection to G5Link bridge lost.', 'stop');
  edge('stale', d.link === 'stale', 'No data from the game. Game paused or in a menu.', 'info');
  edge('onfoot', d.link === 'live' && d.state === 'onfoot', 'Enter a vehicle to display machine data.', 'info');
  edge('fuel', fuelPct !== null && fuelPct < 10, 'Fuel level low.', 'warn');
  edge('def', defPct !== null && defPct < 10, 'DEF level low.', 'warn');
  edge('damage', v && v.damage > 80, 'Machine condition critical. Service required.', 'stop');

  // ---- Run page 1: Tractor overview
  $('vehicleTitle').textContent = inVehicle ? `${v.name} - Overview` : 'Tractor - Overview';
  $('speed').textContent = v ? fmt(U.speed(v.speed || 0), 1) : '---';
  $('speedUnit').textContent = U.speedUnit();
  $('dirTxt').textContent = !v ? ' ' : v.dir > 0 ? 'Forward' : v.dir < 0 ? 'Reverse' : 'Stopped';
  $('tSpeed').classList.toggle('on', !!(v && v.speed > 0.5));
  $('rpm').textContent = v ? fmt(v.rpm, 0) : '---';
  $('rpmBar').style.width = (v && v.maxRpm ? Math.min(100, v.rpm / v.maxRpm * 100) : 0) + '%';
  $('tRpm').classList.toggle('on', !!(v && v.motorOn));
  $('gear').textContent = v ? (v.gear || 'N') : '---';
  $('gearSub').textContent = v ? (v.cvt ? 'Variable' : 'Gear') : ' ';
  $('loadTxt').textContent = v ? fmt(v.load, 0) : '---';
  $('loadBar').style.width = (v ? Math.min(100, v.load || 0) : 0) + '%';
  $('fuelLbl').textContent = v && v.fuelType === 'ELECTRICCHARGE' ? 'Battery' : v && v.fuelType === 'METHANE' ? 'Methane' : 'Fuel';
  $('fuelPct').textContent = fuelPct === null ? '---' : fmt(fuelPct, 0);
  $('fuelBar').style.width = (fuelPct ?? 0) + '%';
  $('fuelBar').classList.toggle('low', fuelPct !== null && fuelPct < 10);
  $('tFuel').classList.toggle('alert', fuelPct !== null && fuelPct < 10);
  $('defPct').textContent = defPct === null ? '---' : fmt(defPct, 0);
  $('defBar').style.width = (defPct ?? 0) + '%';
  $('defBar').classList.toggle('low', defPct !== null && defPct < 10);
  $('tDef').classList.toggle('alert', defPct !== null && defPct < 10);

  const ccOn = !!(v && v.ccState > 0);
  $('ccSet').textContent = v && v.ccSpeed !== undefined ? fmt(U.speed(v.ccSpeed), 1) : '---';
  $('ccUnit').textContent = U.speedUnit();
  $('ccOn').classList.toggle('on', ccOn);
  $('ccOff').classList.toggle('on', !ccOn);

  const imp = imps[0];
  $('implName').textContent = imp ? imp.name : 'No implement';
  $('implLowered').classList.toggle('on', !!(imp && imp.lowered));
  $('implLowered').lastChild.textContent = imp && !imp.canLower ? 'Fixed' : imp && imp.lowered ? 'Lowered' : 'Raised';
  $('implOn').classList.toggle('on', !!(imp && imp.turnedOn));
  $('implOn').lastChild.textContent = imp && !imp.canTurnOn ? 'No Drive' : imp && imp.turnedOn ? 'Turned On' : 'Off';
  $('implWidth').textContent = imp && imp.width ? U.width(imp.width) : '---';
  setHtml($('homeSections'), sectionBar(imp));

  const workHours = (w.time || 0) / 3600;
  $('homeArea').textContent = fmt(U.area(w.area || 0), 2) + ' ' + U.areaUnit();
  $('homeTime').textContent = hms(w.time);
  $('homeRate').textContent = workHours > 0.005 ? fmt(U.area(w.area) / workHours, 1) + ' ' + U.areaUnit() + '/h' : '---';

  const hdg = v ? v.heading : null;
  $('compassRose').style.transform = hdg === null || hdg === undefined ? '' : `rotate(${-hdg}deg)`;
  $('headingTxt').textContent = hdg === null || hdg === undefined ? '---°' : fmt(hdg, 0) + '°';

  // ---- Shortcut bar
  const sk = (id, on, txt) => { $(id).classList.toggle('on', !!on); $(id + 'State').textContent = txt; };
  sk('skMotor', v && v.motorOn, v ? (v.motorOn ? 'ON' : 'OFF') : '---');
  sk('skCruise', ccOn, v ? (ccOn ? 'ON' : 'OFF') : '---');
  const anyLowered = imps.some(i => i.lowered), anyOn = imps.some(i => i.turnedOn);
  sk('skLower', anyLowered, imps.length ? (anyLowered ? 'LOWERED' : 'RAISED') : '---');
  sk('skTurnOn', anyOn, imps.length ? (anyOn ? 'ON' : 'OFF') : '---');
  sk('skWork', w.recording, w.recording ? 'ON' : 'OFF');
  renderContextKeys(d);
  if (window.G5GrainCart) G5GrainCart.render();
  if (window.G5Rate) G5Rate.render();

  const r = rates(w);
  renderWorkMonitor(v, w, imps, r);
  renderImplements(imps);
  renderMachine(v, fuelPct, defPct, r);
  renderHarvest(d, v);
  renderHarvestAuto(d, v);
  renderTillage(d, v, w, r);
  renderField(d);
  renderPlanter(d);
  if (window.onTelemetry) window.onTelemetry(d);
}

// Context shortcut keys: the four free slots show the keys this machine supports, in priority order.
const CTX_SLOTS = 4;
const AUTO_STATE = { active: 'ON', standby: 'STBY', cruiseOff: 'STBY', notThreshing: 'STBY', noCrop: 'STBY', ai: 'AI', off: 'OFF' };
function contextKeys(d) {
  const c = d.controls || {}, keys = [], auto = d.harvestAuto;
  const at = d.autotrac;
  if (at && !(at.state === 'notReady' && at.reason === 'noTrack')) keys.push({ id: 'autotrac', cmd: 'autotrac', value: -1, icon: 'wheel', label: 'AUTOTRAC',
    on: at.state === 'engaged', amber: at.state === 'turning', txt: { engaged: 'ENGAGED', turning: 'TURNING', ready: 'READY' }[at.state] || 'NOT READY' });
  if (d.rate) keys.push({ id: 'rate', act: 'rate', icon: 'rate', label: 'RATE', on: !!d.rate.rxActive, amber: false,
    txt: window.G5Rate ? G5Rate.shortTxt(d.rate) : '--' });
  const hl = d.headland;
  if ((d.implements || []).some(i => i.canLower)) keys.push({ id: 'headland', act: 'headland', icon: 'headland', label: 'HEADLAND',
    on: !!(hl && hl.armed && hl.state === 'work'), amber: !!(hl && hl.armed && hl.state !== 'work'),
    txt: !hl || !hl.armed ? 'OFF' : hl.state === 'headland' ? 'RAISED' : hl.state === 'manual' ? 'MANUAL' : hl.state === 'noSignal' ? 'NEEDS SF2' : 'ARMED' });
  if (d.combine && auto) keys.push({ id: 'auto', cmd: 'harvestAuto', value: -1, icon: 'autospeed', label: 'AUTO SPEED',
    on: auto.on && auto.state === 'active', amber: auto.on && auto.state !== 'active', txt: auto.on ? (AUTO_STATE[auto.state] || 'STBY') : 'OFF' });
  const g = d.grainCart;
  if (g && (g.carts > 0 || g.inCart)) keys.push({ id: 'graincart', act: 'graincart', icon: 'graincart', label: 'GRAIN CART',
    on: !!(g.name && !g.paused && !g.released && (g.kind === 'unloading' || g.kind === 'driving')), amber: !!(g.paused || g.released),
    txt: window.G5GrainCart ? G5GrainCart.shortText(g) : '--' });
  if (c.pipe) keys.push({ id: 'pipe', cmd: 'pipeToggle', icon: 'auger', label: 'AUGER', on: c.pipe.open, txt: c.pipe.open ? 'OUT' : 'IN' });
  if (c.fold) keys.push({ id: 'fold', cmd: 'foldToggle', icon: 'fold', label: 'FOLD', on: c.fold.unfolded,
    amber: c.fold.moving, txt: c.fold.moving ? 'MOVING' : c.fold.unfolded ? 'UNFOLDED' : 'FOLDED' });
  if (c.workFront !== undefined) keys.push({ id: 'work', cmd: 'workLightsToggle', icon: 'worklight', label: 'WORK LIGHTS',
    on: c.workFront || c.workBack, txt: c.workFront || c.workBack ? 'ON' : 'OFF' });
  if (c.beacon !== undefined) keys.push({ id: 'beacon', cmd: 'beaconToggle', icon: 'beacon', label: 'BEACON', on: c.beacon, txt: c.beacon ? 'ON' : 'OFF' });
  if (c.hazard !== undefined) keys.push({ id: 'hazard', cmd: 'hazardToggle', icon: 'hazard', label: 'HAZARD', on: false, amber: c.hazard, txt: c.hazard ? 'ON' : 'OFF' });
  if (c.lights !== undefined) keys.push({ id: 'lights', cmd: 'lightsToggle', icon: 'headlight', label: 'LIGHTS', on: c.lights, txt: c.lights ? 'ON' : 'OFF' });
  return keys.slice(0, CTX_SLOTS);
}
let ctxLayout = '';
$('skCtx').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && b.dataset.act === 'headland' && window.G5Headland) G5Headland.toggle();
  if (b && b.dataset.act === 'graincart' && window.G5GrainCart) G5GrainCart.open();
  if (b && b.dataset.act === 'rate' && window.G5Rate) G5Rate.open();
});
function renderContextKeys(d) {
  const keys = d.state === 'vehicle' ? contextKeys(d) : [];
  const layout = keys.map(k => k.id).join(',');
  const box = $('skCtx');
  if (layout !== ctxLayout) {   // rebuild only when the set of keys changes, so a tap is never lost mid-render
    ctxLayout = layout;
    box.innerHTML = keys.map(k => `<button class="sk" ${k.cmd ? `data-cmd="${k.cmd}" data-value="${k.value ?? 0}"` : `data-act="${k.act}"`} id="skc-${k.id}">` +
      `<svg><use href="#i-${k.icon}"/></svg><b>${k.label}</b><span>--</span></button>`).join('') +
      '<div class="sk empty"></div>'.repeat(Math.max(1, CTX_SLOTS - keys.length));
  }
  for (const k of keys) {
    const el = $('skc-' + k.id);
    el.classList.toggle('on', !!k.on);
    el.classList.toggle('amber', !!k.amber);
    el.lastChild.textContent = k.txt;
  }
}

function sectionBar(imp) {
  if (!imp || !imp.areas || !imp.areas.length) return '<span class="none">No section data</span>';
  return imp.areas.map(on => `<i class="${on ? 'on' : ''}"></i>`).join('');
}

function renderWorkMonitor(v, w, imps, r) {
  const hours = (w.time || 0) / 3600;
  const ha = (w.area || 0) / 10000;
  const width = imps.reduce((m, i) => Math.max(m, i.width || 0), 0);
  const instHa = v && w.recording ? (v.speed || 0) * width / 10 : 0;
  setHtml($('wmTiles'), [
    tile('Area Worked', fmt(U.area(w.area || 0), 2), U.areaUnit(), { on: w.recording }),
    tile('Time Worked', hms(w.time), 'h:mm', { on: w.recording }),
    tile('Productivity', fmt(U.areaFromHa(instHa), 1), U.areaUnit() + '/h', { on: w.recording, sub: 'Instant' }),
    tile('Productivity', hours > 0.005 ? fmt(U.area(w.area) / hours, 1) : '---', U.areaUnit() + '/h', { sub: 'Average' }),
    tile('Working Speed', hours > 0.005 ? fmt(U.speed((w.distance / 1000) / hours), 1) : '---', U.speedUnit(), { sub: 'Average' }),
    tile('Distance', U.dist(w.distance || 0), '', { sub: 'While working' }),
    tile('Fuel Used', fmt(U.vol(w.fuelUsed || 0), 1), U.volUnit(), { sub: 'While working' }),
    tile('Fuel per Area', ha > 0.01 ? fmt(U.vol(w.fuelUsed) / U.areaFromHa(ha), 2) : '---', U.volUnit() + '/' + U.areaUnit()),
    tile('Fuel per Hour', r.fuelPerHour !== null ? fmt(U.vol(r.fuelPerHour), 1) : '---', U.volUnit() + '/h'),
  ].join(''));
  $('wmRec').classList.toggle('on', !!w.recording);
  $('wmRec').querySelector('b').textContent = w.recording ? 'ON' : 'OFF';
  $('wmTotalDist').textContent = U.dist(w.totalDistance || 0);
  $('wmTotalFuel').textContent = fmt(U.vol(w.totalFuel || 0), 1) + ' ' + U.volUnit();
}

function renderImplements(imps) {
  const list = $('implList');
  list.classList.toggle('two', imps.length > 1);
  if (!imps.length) {
    setHtml(list, '<div class="empty-page"><div class="module"><div class="mod-title">Implement Details</div><p>No implement attached</p></div></div>');
    return;
  }
  setHtml(list, imps.map((i, n) => `
    <div class="module impl-mod">
      <div class="mod-title">${esc(i.name)} - Overview</div>
      <div class="tiles">
        ${tile('Position', i.canLower ? (i.lowered ? 'Down' : 'Up') : 'Fixed', '', { on: i.lowered })}
        ${tile('Drive', i.canTurnOn ? (i.turnedOn ? 'On' : 'Off') : '---', '', { on: i.turnedOn })}
        ${tile('Working Width', i.width ? U.width(i.width) : '---')}
      </div>
      <div class="impl-body">
        <div class="lower-head"><span>Section Status</span><span>${(i.areas || []).filter(Boolean).length} / ${(i.areas || []).length}</span></div>
        <div class="sectionbar">${sectionBar(i)}</div>
        ${(i.fills || []).map(f => {
          const pct = f.cap ? f.level / f.cap * 100 : 0;
          return `<div class="fill-row"><span>${esc(f.title || 'Fill')}</span>
            <div class="meter"><i class="${pct < 10 ? 'low' : ''}" style="width:${pct.toFixed(0)}%"></i></div>
            <b>${pct.toFixed(0)}% · ${fmt(U.vol(f.level), 0)} ${U.volUnit()}</b></div>`;
        }).join('')}
        <div class="impl-actions">${i.canTurnOn ? `<button class="g5btn" data-cmd="implTurnOn" data-index="${n}">${i.turnedOn ? 'Turn Off' : 'Turn On'}</button>` : ''}</div>
      </div>
    </div>`).join(''));
}

function renderMachine(v, fuelPct, defPct, r) {
  const tte = v && r.fuelPerHour > 0.1 ? v.fuel / r.fuelPerHour : null;
  setHtml($('mmTiles'), [
    tile('Engine Speed', v ? fmt(v.rpm, 0) : '---', 'rpm', { on: v && v.motorOn, pct: v && v.maxRpm ? v.rpm / v.maxRpm * 100 : null }),
    tile('Engine Load', v ? fmt(v.load, 0) : '---', '%', { on: v && v.motorOn, pct: v ? v.load : null }),
    tile('Ground Speed', v ? fmt(U.speed(v.speed || 0), 1) : '---', U.speedUnit(), { on: v && v.speed > 0.5 }),
    tile('Transmission', v ? esc(v.gear || 'N') : '---', '', { sub: v ? (v.cvt ? 'Variable' : 'Gear') : '' }),
    tile('Fuel Level', v && v.fuel !== undefined ? fmt(U.vol(v.fuel), 0) : '---', U.volUnit(), { pct: fuelPct, alert: fuelPct !== null && fuelPct < 10 }),
    tile('DEF Level', v && v.def !== undefined ? fmt(U.vol(v.def), 0) : '---', U.volUnit(), { pct: defPct, alert: defPct !== null && defPct < 10 }),
    tile('Fuel per Hour', r.fuelPerHour !== null ? fmt(U.vol(r.fuelPerHour), 1) : '---', U.volUnit() + '/h'),
    tile('Time to Empty', tte !== null ? hms(tte * 3600) : '---', 'h:mm'),
    tile('Engine Hours', v ? fmt(v.hours, 1) : '---', 'h'),
    tile('Condition', v && v.damage !== undefined ? fmt(100 - v.damage, 0) : '---', '%', { pct: v && v.damage !== undefined ? 100 - v.damage : null, alert: v && v.damage > 80 }),
    tile('Farmland', v && v.farmland ? v.farmland : '---', '', { on: v && v.onField, sub: v && v.onField ? 'On field' : '' }),
    tile('AI Worker', v ? (v.ai ? 'On' : 'Off') : '---', '', { on: v && v.ai }),
  ].join(''));
}

// ------------------------------------------------------------ Harvesting page
// RH setting names -> the labels the G5 Harvest Settings window uses
const SETTING_LABEL = { concave: 'Threshing Clearance', rotor: 'Threshing Speed', fan: 'Cleaning Fan Speed',
  upperSieve: 'Chaffer Clearance', lowerSieve: 'Sieve Clearance', feeder: 'Feeder House' };
const SETTING_ORDER = ['concave', 'rotor', 'fan', 'upperSieve', 'lowerSieve', 'feeder'];

function renderHarvest(d, v) {
  const c = d.state === 'vehicle' ? d.combine : null, rh = c ? d.rh : null;
  $('hvPage').hidden = !c; $('hvEmpty').hidden = !!c;
  const tankPct = c && c.tankCap ? c.tank / c.tankCap * 100 : null;
  edge('tankFull', tankPct !== null && tankPct >= 99.5, 'Grain tank full.', 'warn');
  edge('rhMoist', !!(rh && rh.moistureHigh && rh.harvesting), 'Crop moisture above limit. Grain loss increases.', 'info');
  edge('rhLoss', !!(rh && rh.loss > 3), 'High grain loss. Check speed and harvest settings.', 'warn');
  if (!c) return;

  const crop = (rh && rh.crop && rh.crop !== '--') ? rh.crop : c.crop;
  const cropTitle = c.cropTitle || (crop ? crop[0] + crop.slice(1).toLowerCase() : '');
  $('hvTitle').textContent = `${c.name || 'Combine'}${cropTitle ? ' - ' + cropTitle : ''}`;
  const on = !!(rh && rh.harvesting);
  const val = (x, f, dg) => rh && typeof x === 'number' ? fmt(f(x), dg) : '---';
  const loadOver = rh && rh.load > (rh.targetLoad || 100);
  setHtml($('hvTiles'), [
    tile('Yield', val(rh && rh.yield, x => HU.yield(x, crop), metric('grain') ? 2 : 1), HU.yieldUnit(), { on }),
    tile('Moisture', val(rh && rh.moisture, x => x, 1), '%', { on, alert: !!(rh && rh.moistureHigh),
      sub: rh && rh.moistureLimit ? 'Limit ' + fmt(rh.moistureLimit, 1) + ' %' : '' }),
    tile('Throughput', val(rh && rh.tph, x => HU.flow(x, crop), 0), HU.flowUnit(), { on }),
    tile('Productivity', val(rh && rh.haph, x => U.areaFromHa(x), 1), U.areaUnit() + '/h', { on,
      sub: rh && rh.avgHaph ? 'Avg ' + fmt(U.areaFromHa(rh.avgHaph), 1) : '' }),
    tile('Grain Loss', val(rh && rh.loss, x => x, 1), '%', { on, alert: !!(rh && rh.loss > 3) }),
    tile('Engine Load', rh ? fmt(rh.load, 0) : v ? fmt(v.load, 0) : '---', '%', { on: v && v.motorOn, alert: loadOver,
      sub: rh && rh.targetLoad ? 'Target ' + fmt(rh.targetLoad, 0) + ' %' : '' }),
    tile('Target Speed', val(rh && rh.recSpeed, x => U.speed(x), 1), U.speedUnit(), { on,
      sub: v ? 'Now ' + fmt(U.speed(v.speed || 0), 1) : '' }),
    tile('Fuel Rate', rh && rh.lph ? fmt(U.vol(rh.lph), 1) : '---', U.volUnit() + '/h'),
  ].join(''));

  // Harvest Settings: G5-style boxed values on a 0-100 % scale with RH's optimum band
  const mode = rh ? (rh.mode || 'MANUAL') : '---';
  $('hvMode').textContent = mode === 'AUTO' ? 'AUTO' : mode === 'MANUAL' ? 'MANUAL' : '---';
  $('hvMode').classList.toggle('auto', mode === 'AUTO');
  const sets = (rh && rh.settings || []).slice().sort((a, b) => {
    const ia = SETTING_ORDER.indexOf(a.name), ib = SETTING_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  setHtml($('hvSettings'), !rh
    ? '<p class="hv-note">Realistic Harvesting not detected.<br>Settings and losses need that mod.</p>'
    : !sets.length ? '<p class="hv-note">No settings reported.</p>'
    : sets.map(s => {
      const has = typeof s.opt === 'number', tol = s.tol || 5;
      const off = has && Math.abs(s.value - s.opt) > tol;
      const pos = x => Math.max(0, Math.min(100, x)).toFixed(1) + '%';
      return `<div class="hv-row"><span>${esc(SETTING_LABEL[s.name] || s.name)}</span>
        <b class="hv-val ${off ? 'off' : ''}">${fmt(s.value, 0)}</b>
        <div class="hv-scale">${has ? `<i class="band" style="left:${pos(s.opt - tol)};width:${(2 * tol).toFixed(1)}%"></i><i class="opt" style="left:${pos(s.opt)}"></i>` : ''}
        <i class="cur" style="left:${pos(s.value)}"></i></div></div>`;
    }).join(''));

  // Grain loss breakdown (RH computes each cause separately)
  const rank = rh && rh.rank ? String(rh.rank) : '-';
  $('hvRank').textContent = rank; $('hvRank').className = 'hv-rank ' + rank;
  const causes = rh ? [['Total', rh.loss], ['Overload', rh.lossOverload], ['Moisture', rh.lossMoisture],
    ['Settings', rh.lossSettings], ['Slope', rh.lossSlope], ['Wear', rh.lossWear]] : [];
  setHtml($('hvLoss'), !rh ? '<p class="hv-note">---</p>' : causes.map(([k, x]) => {
    const n = typeof x === 'number' ? x : null;
    return `<div class="hv-row"><span>${k}</span><div class="hv-bar"><i class="${n > 3 ? 'hi' : ''}" style="width:${n === null ? 0 : Math.min(100, n / 10 * 100).toFixed(0)}%"></i></div>
      <b class="hv-val">${n === null ? '---' : fmt(n, 1) + '%'}</b></div>`;
  }).join(''));

  // Grain tank and field totals
  $('hvTankBar').style.height = (tankPct ?? 0).toFixed(0) + '%';
  $('hvTankBar').classList.toggle('full', tankPct !== null && tankPct >= 95);
  $('hvTankPct').textContent = tankPct === null ? '--%' : fmt(tankPct, 0) + '%';
  $('hvTankVol').textContent = c.tank !== undefined ? HU.tank(c.tank) : '---';
  const trip = rh && rh.trip;
  $('hvTripArea').textContent = trip && trip.areaHa !== undefined ? fmt(U.areaFromHa(trip.areaHa), 2) + ' ' + U.areaUnit() : '---';
  $('hvTripMass').textContent = trip && trip.massKg !== undefined ? HU.mass(trip.massKg, crop) : '---';
  const lostKg = trip && trip.lostLiters !== undefined && trip.liters ? trip.lostLiters * (trip.massKg / trip.liters) : null;
  $('hvTripLost').textContent = lostKg !== null ? HU.mass(lostKg, crop) : '---';
}

// ------------------------------------------------------------ Harvest Automation page
// Speed automation runs in the mod (Controls.lua): it steps cruise speed toward Realistic Harvesting's
// recommended speed (or holds an engine-load target without RH). This page shows it and its trends.
const HA = { hist: [], span: 15, lastAt: 0, autoMs: 0, harvestMs: 0, tphSum: 0, lossSum: 0, n: 0, field: null };
const HA_MSG = {
  active: src => src === 'rh' ? 'Following the Realistic Harvesting target speed.' : 'Holding the engine-load target.',
  standby: () => 'Waiting for the combine.', cruiseOff: () => 'Standby: turn cruise control on to automate speed.',
  notThreshing: () => 'Standby: turn the threshing system on.', noCrop: () => 'Standby: not in crop (headland or raised header).',
  ai: () => 'Standby: an AI worker is driving.', noCombine: () => 'No combine in use.', noData: () => 'No engine data.',
  noCruise: () => 'Cruise control unavailable.', off: () => 'Off. Cruise speed is set by the operator.',
};
function haSample(d, v) {
  const rh = d.rh || {}, a = d.harvestAuto || {}, now = Date.now();
  if (now - HA.lastAt < 2000) return;
  const dt = HA.lastAt ? Math.min(10000, now - HA.lastAt) : 0;
  HA.lastAt = now;
  const field = v && v.field !== undefined ? v.field : null;
  if (field !== HA.field) { Object.assign(HA, { field, autoMs: 0, harvestMs: 0, tphSum: 0, lossSum: 0, n: 0 }); }
  if (rh.harvesting) {
    HA.harvestMs += dt; if (a.on && a.state === 'active') HA.autoMs += dt;
    if (typeof rh.tph === 'number') { HA.tphSum += rh.tph; HA.lossSum += rh.loss || 0; HA.n++; }
  }
  HA.hist.push({ t: now, speed: v ? v.speed || 0 : 0, target: a.on && a.target !== undefined ? a.target : rh.recSpeed,
    load: typeof rh.load === 'number' ? rh.load : v ? v.load : null, targetLoad: rh.targetLoad,
    tph: rh.tph, loss: rh.loss, auto: !!(a.on && a.state === 'active') });
  while (HA.hist.length && now - HA.hist[0].t > 30 * 60000) HA.hist.shift();
}
// One trend chart: value line, dashed reference line, green band where automation was active.
function haChart(title, now, unit, pts, key, refKey, conv) {
  const W = 400, H = 100, span = HA.span * 60000, t0 = Date.now() - span;
  const vals = pts.flatMap(p => [p[key], refKey ? p[refKey] : null]).filter(x => typeof x === 'number').map(conv);
  let hi = vals.length ? Math.max(...vals) : 1, lo = vals.length ? Math.min(0, ...vals) : 0;
  if (hi - lo < 1e-6) hi = lo + 1;
  hi += (hi - lo) * 0.12;
  const X = t => ((t - t0) / span * W).toFixed(1), Y = x => (H - (conv(x) - lo) / (hi - lo) * H).toFixed(1);
  const line = k => {
    let dpath = '', pen = false;
    for (const p of pts) {
      if (typeof p[k] !== 'number') { pen = false; continue; }
      dpath += `${pen ? 'L' : 'M'}${X(p.t)},${Y(p[k])}`; pen = true;
    }
    return dpath;
  };
  let bands = '', start = null;
  pts.forEach((p, i) => {
    if (p.auto && start === null) start = p.t;
    if ((!p.auto || i === pts.length - 1) && start !== null) { bands += `<rect class="auto" x="${X(start)}" y="0" width="${Math.max(1, X(p.t) - X(start))}" height="${H}"/>`; start = null; }
  });
  const grid = [0.25, 0.5, 0.75].map(f => `<line class="grid" x1="0" x2="${W}" y1="${H * f}" y2="${H * f}"/>`).join('');
  return `<div class="ha-chart"><header><span>${title}</span><b>${now}<small> ${unit}</small></b></header>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bands}${grid}
    ${refKey ? `<path class="ref" d="${line(refKey)}"/>` : ''}<path class="line" d="${line(key)}"/>
    <text class="axis" x="4" y="12">${fmt(hi, hi < 10 ? 1 : 0)}</text></svg></div>`;
}
const haDur = min => min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
function renderHarvestAuto(d, v) {
  const c = d.state === 'vehicle' ? d.combine : null, rh = c ? d.rh : null, a = d.harvestAuto || { on: false, state: 'off' };
  $('haPage').hidden = !c; $('haEmpty').hidden = !!c;
  if (!c) return;
  haSample(d, v);
  if (!document.querySelector('.page.active[data-name="Harvest Automation"]')) return;
  const crop = (rh && rh.crop && rh.crop !== '--') ? rh.crop : c.crop;
  $('haTitle').textContent = `Harvest Automation - ${c.name || 'Combine'}`;
  const active = a.on && a.state === 'active';
  $('haState').textContent = !a.on ? 'OFF' : active ? 'ACTIVE' : 'STANDBY';
  $('haState').className = 'ha-state ' + (!a.on ? '' : active ? 'on' : 'stby');
  $('haToggle').classList.toggle('on', !!a.on);
  $('haToggle').lastChild.textContent = a.on ? 'On' : 'Off';
  const tgt = a.on && a.target !== undefined ? a.target : rh && rh.recSpeed;
  $('haTarget').textContent = typeof tgt === 'number' ? `${fmt(U.speed(tgt), 1)} ${U.speedUnit()}` : '---';
  $('haSpeed').textContent = v ? `${fmt(U.speed(v.speed || 0), 1)} ${U.speedUnit()}` : '---';
  $('haMax').textContent = a.max !== undefined ? `${fmt(U.speed(a.max), 1)} ${U.speedUnit()}` : '---';
  $('haMsg').textContent = (HA_MSG[a.on ? a.state : 'off'] || HA_MSG.standby)(a.source);
  const mode = rh ? (rh.mode || 'MANUAL') : null;
  $('haMode').textContent = mode || '---';
  $('haMode').classList.toggle('auto', mode === 'AUTO');
  $('haEff').textContent = rh && typeof rh.efficiency === 'number' ? fmt(rh.efficiency * 100, 0) + ' %' : '---';
  $('haLoad').textContent = rh && typeof rh.load === 'number' ? `${fmt(rh.load, 0)} / ${fmt(rh.targetLoad || 100, 0)} %` : v ? fmt(v.load, 0) + ' %' : '---';
  $('haRank').textContent = rh && rh.rank ? rh.rank : '-';
  $('haModeMsg').textContent = !rh ? 'Realistic Harvesting not detected. Automation holds a 95 % engine load.'
    : mode === 'AUTO' ? 'Realistic Harvesting adjusts the threshing settings.' : 'Settings are manual. Set them in Realistic Harvesting.';

  const pts = HA.hist.filter(p => p.t >= Date.now() - HA.span * 60000);
  const last = pts[pts.length - 1] || {};
  const n = (x, f, dg) => typeof x === 'number' ? fmt(f(x), dg) : '---';
  setHtml($('haTrends'), [
    haChart('Ground Speed', n(last.speed, U.speed, 1), U.speedUnit(), pts, 'speed', 'target', U.speed),
    haChart('Engine Load', n(last.load, x => x, 0), '%', pts, 'load', 'targetLoad', x => x),
    haChart('Throughput', n(last.tph, x => HU.flow(x, crop), 0), HU.flowUnit(), pts, 'tph', null, x => HU.flow(x, crop)),
    haChart('Grain Loss', n(last.loss, x => x, 1), '%', pts, 'loss', null, x => x),
  ].join(''));

  const tankPct = c.tankCap ? c.tank / c.tankCap * 100 : null;
  $('haTankBar').style.height = (tankPct ?? 0).toFixed(0) + '%';
  $('haTankBar').classList.toggle('full', tankPct !== null && tankPct >= 95);
  $('haTankPct').textContent = tankPct === null ? '--%' : fmt(tankPct, 0) + '%';
  const trip = rh && rh.trip, kgPerL = trip && trip.liters ? trip.massKg / trip.liters : 0.78;
  const lph = rh && rh.tph > 0 ? rh.tph * 1000 / kgPerL : 0;              // tank litres per hour
  const pipe = d.controls && d.controls.pipe;
  $('haFull').textContent = pipe && pipe.open ? 'Unloading' : tankPct >= 99.5 ? 'Tank full'
    : lph > 0 && c.tankCap ? `Full in ${haDur((c.tankCap - c.tank) / lph * 60)}` : HU.tank(c.tank || 0);
  $('haAuger').hidden = !pipe;
  $('haAuger').classList.toggle('on', !!(pipe && pipe.open));
  $('haAuger').lastChild.textContent = pipe && pipe.open ? 'Auger Out' : 'Auger In';
  const gcart = d.grainCart;
  $('haCart').hidden = !(gcart && gcart.name);
  $('haCartTxt').hidden = !(gcart && gcart.name);
  if (gcart && gcart.name && window.G5GrainCart) $('haCartTxt').textContent = `${gcart.name}: ${G5GrainCart.stateText(gcart)}`;
  $('haAvgTph').textContent = HA.n ? `${fmt(HU.flow(HA.tphSum / HA.n, crop), 0)} ${HU.flowUnit()}` : '---';
  $('haAvgLoss').textContent = HA.n ? fmt(HA.lossSum / HA.n, 1) + ' %' : '---';
  $('haAutoPct').textContent = HA.harvestMs > 0 ? fmt(HA.autoMs / HA.harvestMs * 100, 0) + ' %' : '---';
}
$('haCart').onclick = () => window.G5GrainCart && G5GrainCart.call($('haCart'));
$('haMax').onclick = () => openNumpad(`Max Automation Speed (${U.speedUnit()})`, v => send('harvestAutoMax', metric('speed') ? v : v / 0.621371));
$('haSpan').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  HA.span = Number(b.dataset.v);
  $('haSpan').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
};

// ------------------------------------------------------------ Tillage page (TruSet-style depth)
// One depth set point for the hitch. Realistic Tillage tools take it in cm; cultivators with Cultivator
// Settings or game work modes take the matching level (up to 10 cm shallow, up to 22 cm normal, else deep).
// The mod applies both (Controls.lua runTillage).
const TL_NAMES = { plow: 'Plow', cultivator: 'Field Cultivator', disc: 'Disc', subsoiler: 'Ripper', ripper: 'Ripper',
  powerHarrow: 'Power Harrow', harrow: 'Harrow', spader: 'Spader', mulcher: 'Mulcher', roller: 'Roller', weeder: 'Weeder' };
const TL_LEVEL = { shallow: 'Shallow', normal: 'Normal', deep: 'Deep' };
const TL_LEVEL_NUM = { shallow: 2, normal: 3, deep: 4 };
const TL = Object.assign({ presets: [{ name: 'Seedbed', cm: 8 }, { name: 'Secondary', cm: 15 }, { name: 'Primary', cm: 28 }], setpoint: null }, settings.truset || {});
settings.truset = TL;
let tlEditing = false;
const tlUnit = () => metric('distance') ? 'cm' : 'in';
const tlConv = cm => metric('distance') ? cm : cm / 2.54;
const tlTxt = cm => typeof cm === 'number' ? `${fmt(tlConv(cm), metric('distance') ? 0 : 1)} ${tlUnit()}` : '---';
const tlLevelOf = cm => cm <= 10 ? 2 : cm <= 22 ? 3 : 4;
function tlSend(cm) {
  cm = Math.max(2, Math.min(38, Math.round(cm * 2) / 2));
  TL.setpoint = cm; saveSettings();
  send('tillageDepth', cm);
}
function renderTillage(d, v, w, r) {
  const tools = d.state === 'vehicle' ? (d.implements || []).filter(i => i.tillage) : [];
  if (!tools.length) return;
  const page = document.querySelector('.page.active[data-name="Tillage"]');
  const main = tools[0], t = main.tillage;
  const rt = tools.find(i => i.tillage.depth !== undefined);
  const leveled = tools.filter(i => i.tillage.levels);
  // the set point follows the tool when it was changed in the game (or on first sight)
  if (rt && typeof rt.tillage.target === 'number') TL.setpoint = rt.tillage.target;
  else if (TL.setpoint === null && t.level) TL.setpoint = { shallow: 8, normal: 15, deep: 28 }[t.level];
  const working = !!(w && w.recording);
  edge('tlLimited', !!(rt && rt.tillage.limited && working), 'Tractor cannot pull this depth. Slow down or raise the set point.', 'warn');
  if (!page) return;

  $('tlTitle').textContent = `Tillage - ${main.name}`;
  const ha = v && main.width ? main.width * (v.speed || 0) / 10 : 0;
  const hours = (w.time || 0) / 3600;
  const perArea = w.area > 0 && w.fuelUsed > 0 ? U.vol(w.fuelUsed) / U.area(w.area) : null;
  const depthNow = rt ? rt.tillage.depth : null;
  setHtml($('tlTiles'), [
    tile('Ground Speed', v ? fmt(U.speed(v.speed || 0), 1) : '---', U.speedUnit(), { on: working }),
    tile('Work Rate', working ? fmt(U.areaFromHa(ha), 1) : '---', U.areaUnit() + '/h', { on: working,
      sub: hours > 0.005 ? 'Avg ' + fmt(U.area(w.area) / hours, 1) : '' }),
    tile('Area Worked', fmt(U.area(w.area || 0), 2), U.areaUnit()),
    tile('Engine Load', v ? fmt(v.load, 0) : '---', '%', { on: v && v.motorOn, alert: !!(rt && rt.tillage.limited) }),
    tile('Working Depth', depthNow !== null ? fmt(tlConv(depthNow), metric('distance') ? 0 : 1) : t.level ? TL_LEVEL[t.level] : '---',
      depthNow !== null ? tlUnit() : '', { on: working, sub: rt ? 'Target ' + tlTxt(rt.tillage.target) : t.subsoil ? 'Subsoiling' : '' }),
    tile('Fuel Rate', r.fuelPerHour !== null ? fmt(U.vol(r.fuelPerHour), 1) : '---', U.volUnit() + '/h'),
    tile('Fuel per Area', perArea !== null ? fmt(perArea, 2) : '---', `${U.volUnit()}/${U.areaUnit()}`),
    tile('Tool Width', main.width ? U.width(main.width) : '---', '', { sub: TL_NAMES[t.type] || t.type }),
  ].join(''));

  // TruSet set point, presets and levels
  const sp = TL.setpoint;
  $('tlSetVal').textContent = tlTxt(sp);
  const src = rt ? 'DEPTH' : leveled.length ? 'LEVELS' : 'FIXED';
  $('tlSrc').textContent = src; $('tlSrc').classList.toggle('auto', src !== 'FIXED');
  const canSet = !!rt || leveled.some(i => !i.tillage.locked);
  ['tlMinus', 'tlPlus', 'tlSetpoint'].forEach(id => { $(id).disabled = !canSet; });
  $('tlPresets').classList.toggle('editing', tlEditing);
  setHtml($('tlPresets'), TL.presets.map((p, k) =>
    `<button class="g5btn ${!tlEditing && sp === p.cm ? 'on' : ''}" data-preset="${k}" ${canSet || tlEditing ? '' : 'disabled'}>${esc(p.name)}<small>${tlTxt(p.cm)}</small></button>`).join(''));
  $('tlEdit').textContent = tlEditing ? 'Done' : 'Edit Presets';
  const avail = new Set(leveled.flatMap(i => i.tillage.locked ? [] : i.tillage.levels.split(',')));
  const curLevel = (leveled[0] || main).tillage.level;
  $('tlLevels').querySelectorAll('button').forEach(b => {
    const name = { 2: 'shallow', 3: 'normal', 4: 'deep' }[b.dataset.l];
    b.disabled = !avail.has(name) && !(name === 'deep' && avail.has('normal'));
    b.classList.toggle('on', curLevel === name);
  });
  const lockedTool = leveled.find(i => i.tillage.locked);
  $('tlMsg').textContent = rt ? `Realistic Tillage sets ${tools.filter(i => i.tillage.canSet).length > 1 ? 'each tool' : 'the tool'} to the set point.`
    + (leveled.length ? ` Level follows: ${TL_LEVEL[{ 2: 'shallow', 3: 'normal', 4: 'deep' }[tlLevelOf(sp || 15)]]}.` : '')
    : leveled.length ? (lockedTool ? `${lockedTool.name}: level fixed by its shop configuration.` : `Set point picks the level: up to ${tlTxt(10)} shallow, up to ${tlTxt(22)} normal, deeper is deep.`)
    : 'This tool has no depth control. Install Cultivator Settings or Realistic Tillage.';

  setHtml($('tlTools'), tools.map(i => {
    const k = i.tillage, lvl = k.level ? TL_LEVEL[k.level] : null;
    const depth = k.depth !== undefined ? `${tlTxt(k.depth)} / ${tlTxt(k.target)}` : '';
    return `<div class="tl-tool"><b>${esc(i.name)}</b><span class="lvl ${i.lowered ? 'on' : ''} ${k.limited ? 'warn' : ''}">${i.lowered ? 'IN GROUND' : 'RAISED'}</span>
      <span style="text-align:left">${esc(TL_NAMES[k.type] || k.type)}${lvl ? ' · ' + lvl : ''}${k.locked ? ' (fixed)' : ''}</span><span>${depth}</span></div>`;
  }).join(''));

  // depth gauge, 0 to 38 cm
  const pctOf = cm => Math.max(0, Math.min(100, cm / 38 * 100)).toFixed(1) + '%';
  const shown = depthNow ?? (t.level ? { shallow: 8, normal: 15, deep: 28 }[t.level] : 0);
  $('tlGaugeAct').style.height = pctOf(shown);
  $('tlGaugeTgt').style.top = pctOf(sp ?? shown);
  $('tlGaugeTxt').textContent = depthNow !== null ? tlTxt(depthNow) : t.level ? TL_LEVEL[t.level] : '---';
  $('tlHasCs').textContent = tools.some(i => i.tillage.modeSource === 'cultivatorSettings') ? 'Found' : leveled.length ? 'Game modes' : 'Not found';
  $('tlHasRt').textContent = rt ? 'Found' : 'Not found';
}
$('tlMinus').onclick = () => tlSend((TL.setpoint ?? 15) - (metric('distance') ? 1 : 1.27));
$('tlPlus').onclick = () => tlSend((TL.setpoint ?? 15) + (metric('distance') ? 1 : 1.27));
$('tlSetpoint').onclick = () => openNumpad(`Depth Set Point (${tlUnit()})`, v => tlSend(metric('distance') ? v : v * 2.54));
$('tlEdit').onclick = () => { tlEditing = !tlEditing; renderTillage(data, data.vehicle, data.work || {}, { fuelPerHour: null }); };
$('tlPresets').onclick = e => {
  const b = e.target.closest('[data-preset]'); if (!b) return;
  const p = TL.presets[Number(b.dataset.preset)];
  if (tlEditing) {
    openNumpad(`${p.name} Depth (${tlUnit()})`, v => { p.cm = Math.max(2, Math.min(38, metric('distance') ? v : v * 2.54)); saveSettings(); });
    return;
  }
  tlSend(p.cm);
};
$('tlLevels').onclick = e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  send('tillageLevel', Number(b.dataset.l));
  TL.setpoint = { 2: 8, 3: 15, 4: 28 }[b.dataset.l]; saveSettings();
};

// ------------------------------------------------------------ Planter page (Realistic Seeder Placement API)
const SR = {
  // the seeder reports per acre: seeds/acre on planters, lb/acre on drills
  unit: sd => sd.unit === 'poundsPerAcre' ? (metric('rate') ? 'kg/ha' : 'lb/ac') : (metric('rate') ? 'seeds/ha' : 'seeds/ac'),
  conv: (sd, v) => typeof v !== 'number' ? null : sd.unit === 'poundsPerAcre' ? (metric('rate') ? v * 1.12085 : v) : (metric('rate') ? v * 2.47105 : v),
};
function renderPlanter(d) {
  const imp = (d.implements || []).find(i => i.seeder);
  const sd = imp && imp.seeder;
  const sing = sd && typeof sd.skips === 'number' && typeof sd.doubles === 'number' ? 100 - sd.skips - sd.doubles : null;
  edge('plSing', sing !== null && sd.fresh && sing < 92, 'Singulation below 92%.', 'warn');
  if (!sd) return;
  const drill = sd.kind === 'drill';
  const CROPS = { MAIZE: 'Corn', SOYBEAN: 'Soybeans', WV_SPRINGWHEAT: 'Spring Wheat', WV_WINTERWHEAT: 'Winter Wheat' };
  const cropName = sd.crop ? CROPS[String(sd.crop).toUpperCase()] || String(sd.crop).toLowerCase().replace(/(^|_)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()) : '';
  $('plTitle').textContent = `${imp.name}${cropName ? ' - ' + cropName : ''}`;
  const unit = SR.unit(sd);
  const rateTxt = v => { const x = SR.conv(sd, v); return x === null ? '---' : fmt(x, drill ? 1 : 0); };
  const pctTile = (t, v, opts = {}) => tile(t, typeof v === 'number' ? fmt(v, opts.d ?? 1) : '---', typeof v === 'number' ? '%' : '', opts);
  const live = !!sd.fresh;
  setHtml($('plTiles'), [
    tile('Target Rate', rateTxt(sd.rate), unit, { on: live }),
    tile('Actual Rate', sd.monitor ? rateTxt(sd.actual) : '---', sd.monitor ? unit : '', { on: live && sd.monitor, sub: sd.monitor ? '' : 'No seed monitor' }),
    pctTile('Singulation', sing, { on: live, alert: sing !== null && sing < 92 }),
    pctTile('Skips', sd.skips, { on: live, d: 2, alert: sd.skips > 4 }),
    drill ? pctTile('Distribution CV', sd.cv, { on: live }) : pctTile('Doubles', sd.doubles, { on: live, d: 2, alert: sd.doubles > 4 }),
    tile('Seed Depth', typeof (sd.depth ?? sd.depthSet) === 'number' ? (metric('distance') ? fmt(sd.depth ?? sd.depthSet, 0) : fmt((sd.depth ?? sd.depthSet) / 25.4, 2)) : '---',
      metric('distance') ? 'mm' : 'in', { sub: typeof sd.depth === 'number' ? 'Measured' : 'Set' }),
    tile('Population', typeof sd.popEstablished === 'number' ? rateTxt(sd.popEstablished) : '---', typeof sd.popEstablished === 'number' ? unit : '', { sub: 'Established (est.)' }),
    pctTile('Yield Potential', sd.yieldPotential, { sub: 'Placement model' }),
  ].join(''));

  const rows = sd.rows || [];
  setHtml($('plRows'), !rows.length
    ? `<p class="pl-none">${sd.monitor ? 'No row drive fitted: row readings are not available.' : 'Row readings need a seed monitor and row drive.'}</p>`
    : rows.map(r => {
      const ratio = r.on && r.target ? (r.actual || 0) / r.target : 0;
      const dev = Math.abs(ratio - 1), cls = !r.on ? 'off' : dev <= 0.05 ? 'ok' : dev <= 0.1 ? 'mid' : 'bad';
      const h = r.on ? Math.min(100, ratio * 80) : 6;
      return `<div class="pl-row"><div class="pl-bar"><i class="${cls}" style="height:${h.toFixed(0)}%"></i></div><b>${fmt(r.r, 0)}</b><span>${r.on && typeof r.actual === 'number' ? rateTxt(r.actual) : 'off'}</span></div>`;
    }).join(''));

  const kv = (k, val) => `<div class="kv"><span>${k}</span><b>${val}</b></div>`;
  setHtml($('plMonitor'), [
    kv('Seed Monitor', sd.monitor ? (live ? 'Live' : 'No recent sample') : 'Not fitted'),
    kv('Downforce', typeof sd.pressure === 'number' ? fmt(sd.pressure, 0) + ' %' : '---'),
    kv('Closing', typeof sd.closing === 'number' ? fmt(sd.closing, 0) + ' %' : '---'),
  ].join(''));
  const src = { sensor: 'Soil sensor', SeasonalCropStress: 'Seasonal Crop Stress', model: 'Placement model' }[sd.soilSource] || (sd.soilSource || '---');
  setHtml($('plSoil'), [
    kv('Soil Moisture', typeof sd.moisture === 'number' ? fmt(sd.moisture * 100, 0) + ' %' : '---'),
    kv('Compaction', typeof sd.compaction === 'number' ? fmt(sd.compaction * 100, 0) + ' %' : '---'),
    kv('Source', esc(src)),
  ].join(''));
}

// ------------------------------------------------------------ Field page (other mods)
const STATUS_TAG = { Good: 'on', Fair: '', Poor: 'alert' };
function renderField(d) {
  const pv = d.providers || {}, soil = pv['soil-fertilizer'], sv = soil && soil.values;
  const mud = pv['mud-system-physics'], cp = pv.courseplay, ad = pv.autodrive;
  const field = d.field ?? (sv && sv.fieldId);
  $('fdTitle').textContent = field ? `Field ${field} - Soil` : 'Soil';
  const pct = x => typeof x === 'number' ? fmt(x, 0) : '---';
  const nut = (title, n) => n && typeof n === 'object'
    ? tile(title, fmt(n.value, 0), '', { on: n.status === 'Good', alert: n.status === 'Poor', sub: esc(n.status || '') })
    : tile(title, '---');
  const crop = c => c ? esc(String(c)[0] + String(c).slice(1).toLowerCase()) : '---';
  setHtml($('fdSoil'), !sv
    ? `<div class="fd-note">${pv && d.providerStatus && d.providerStatus['soil-fertilizer'] && !d.providerStatus['soil-fertilizer'].available
        ? 'Realistic Soil &amp; Fertilizer not installed.' : field ? 'No soil data for this field.' : 'Drive onto a field to see soil data.'}</div>`
    : [
      nut('Nitrogen', sv.nitrogen), nut('Phosphorus', sv.phosphorus), nut('Potassium', sv.potassium),
      tile('pH', typeof sv.pH === 'number' ? fmt(sv.pH, 1) : '---', '', { alert: typeof sv.pH === 'number' && sv.pH < 5.5,
        sub: typeof sv.pH === 'number' ? (sv.pHStatus === 'LOCAL' ? 'Here' : 'Field') : (typeof sv.pHLastKnown === 'number' ? 'Last ' + fmt(sv.pHLastKnown, 1) : '') }),
      tile('Organic Matter', typeof sv.organicMatter === 'number' ? fmt(sv.organicMatter, 1) : '---', '%'),
      tile('Compaction', pct(sv.compaction), '%', { alert: sv.compaction > 60 }),
      tile('Yield Potential', typeof sv.yieldEfficiency === 'number' ? fmt(sv.yieldEfficiency * 100, 0) : '---', '%'),
      tile('Last Crop', crop(sv.lastCrop), '', { sub: sv.daysSinceHarvest ? sv.daysSinceHarvest + ' days ago' : '' }),
      tile('Weed Pressure', pct(sv.weedPressure), '%', { alert: sv.weedPressure > 50, sub: sv.herbicideActive ? 'Herbicide active' : '' }),
      tile('Pest Pressure', pct(sv.pestPressure), '%', { alert: sv.pestPressure > 50, sub: sv.insecticideActive ? 'Insecticide active' : '' }),
      tile('Disease', sv.shownDiseasePressure === null || sv.shownDiseasePressure === undefined ? 'Unscouted' : pct(sv.shownDiseasePressure),
        sv.shownDiseasePressure === null || sv.shownDiseasePressure === undefined ? '' : '%', { sub: sv.fungicideActive ? 'Fungicide active' : '' }),
      tile('Rotation', esc(sv.rotationStatus || '---')),
    ].join(''));

  const kv = (k, val) => `<div class="kv"><span>${k}</span><b>${val}</b></div>`;
  setHtml($('fdGround'), !mud ? '<p class="fd-side-note">Mud System Physics not active.</p>' : [
    kv('Wheel Slip', typeof mud.slip === 'number' ? fmt(mud.slip * 100, 0) + ' %' : '---'),
    kv('Mud', typeof mud.fieldMudFactor === 'number' ? fmt(mud.fieldMudFactor * 100, 0) + ' %' : typeof mud.effectiveWetness === 'number' ? fmt(mud.effectiveWetness * 100, 0) + ' % wet' : '---'),
    kv('Tire Pressure', typeof mud.tirePressure === 'number' ? (metric('pressure') ? fmt(mud.tirePressure, 2) + ' bar' : fmt(mud.tirePressure * 14.504, 1) + ' psi') : '---'),
  ].join(''));

  let ai;
  if (cp && cp.active) {
    const c = cp.course || {};
    ai = [kv('Courseplay', cp.waitingForUnload ? 'Waiting to unload' : cp.maneuvering ? 'Turning' : cp.drivingToFieldwork ? 'To field' : cp.fieldworkActive ? 'Field work' : 'Active'),
      kv('Progress', typeof cp.progress === 'number' ? fmt(cp.progress * 100, 0) + ' %' : '---'),
      kv('Remaining', typeof c.remainingDistance === 'number' ? U.dist(c.remainingDistance) + (typeof c.remainingTurns === 'number' ? ` · ${c.remainingTurns} turns` : '') : '---')];
  } else if (ad && ad.active) {
    ai = [kv('AutoDrive', esc(ad.destination || ad.task || 'Driving')),
      kv('Time Left', ad.remainingDriveTime > 0 ? hms(ad.remainingDriveTime) : '---'),
      kv('Speed Limit', ad.speedLimit ? fmt(U.speed(ad.speedLimit), 0) + ' ' + U.speedUnit() : '---')];
  } else {
    ai = [`<p class="fd-side-note">${cp || ad ? 'No AI driver active.' : 'Courseplay and AutoDrive not active.'}</p>`];
  }
  setHtml($('fdAi'), ai.join(''));
}

// ------------------------------------------------------------ live stream
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = e => { try { data = JSON.parse(e.data); render(); } catch (err) { /* ignore bad frame */ } };
  es.onerror = () => { data = { ...data, link: 'down' }; render(); };
}

$('aboutTxt').textContent = 'G5Link display. Live data from the FS25_G5Link mod through the G5Link bridge on your PC.';
showPage(settings.pageName || 0);
render();
connect();

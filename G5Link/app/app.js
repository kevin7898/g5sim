'use strict';
// G5Link display: renders telemetry streamed by the bridge (/api/events) and posts commands (/api/cmd).

const $ = id => document.getElementById(id);
const display = $('display');
const W = 1280, H = 720;

// ------------------------------------------------------------ settings (per device)
const settings = { units: 'metric', mode: 'day', sound: 'on', page: 0 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('g5link') || '{}')); } catch (e) { /* private mode */ }
function saveSettings() { try { localStorage.setItem('g5link', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ------------------------------------------------------------ fit the 16:9 canvas to the screen
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  display.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// ------------------------------------------------------------ units
const metric = () => settings.units === 'metric';
const U = {
  speed: v => metric() ? v : v * 0.621371,
  speedUnit: () => metric() ? 'km/h' : 'mph',
  area: m2 => metric() ? m2 / 10000 : m2 / 4046.856,
  areaFromHa: ha => metric() ? ha : ha * 2.47105,
  areaUnit: () => metric() ? 'ha' : 'ac',
  vol: l => metric() ? l : l * 0.264172,
  volUnit: () => metric() ? 'L' : 'gal',
  dist: m => metric() ? (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m')
                      : (m >= 1609 ? (m / 1609.34).toFixed(2) + ' mi' : Math.round(m * 3.28084) + ' ft'),
  width: m => metric() ? m.toFixed(1) + ' m' : (m * 3.28084).toFixed(1) + ' ft',
};
const fmt = (v, d = 0) => (v === undefined || v === null || Number.isNaN(Number(v))) ? '---' : Number(v).toFixed(d);
function hms(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function setHtml(el, html) { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } }
function tile(title, value, unit = '', opts = {}) {
  const cls = ['tile', opts.on ? 'on' : '', opts.alert ? 'alert' : ''].join(' ');
  const meter = opts.pct === undefined || opts.pct === null ? '' :
    `<div class="meter"><i class="${opts.pct < 10 ? 'low' : ''}" style="width:${Math.max(0, Math.min(100, opts.pct)).toFixed(0)}%"></i></div>`;
  return `<div class="${cls}"><div class="t-title">${title}</div><div class="t-big"><span>${value}</span>${unit ? `<small>${unit}</small>` : ''}</div>${opts.sub ? `<div class="t-sub">${opts.sub}</div>` : ''}${meter}</div>`;
}

// ------------------------------------------------------------ pages
const pages = [...document.querySelectorAll('.page')];
const pageNames = pages.map(p => p.dataset.name);
function showPage(i) {
  settings.page = (i + pages.length) % pages.length;
  pages.forEach((p, n) => p.classList.toggle('active', n === settings.page));
  $('pageName').textContent = pageNames[settings.page];
  setHtml($('menuPages'), pageNames.map((n, k) =>
    `<button class="app ${k === settings.page ? 'on' : ''}" data-page="${k}"><span class="app-ico num">${k + 1}</span><b>${esc(n)}</b></button>`).join(''));
  saveSettings();
}
$('prevPage').onclick = () => showPage(settings.page - 1);
$('nextPage').onclick = () => showPage(settings.page + 1);
$('menuPages').onclick = e => { const b = e.target.closest('[data-page]'); if (b) { showPage(+b.dataset.page); closeWin('menu'); } };

let touchX = null;
$('pages').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('pages').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 80) showPage(settings.page + (dx < 0 ? 1 : -1));
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
  if (e.key === 'Escape') ['menu', 'scPanel', 'confirm', 'numpad', 'trackWin'].forEach(closeWin);
  if (e.key === 'ArrowRight') showPage(settings.page + 1);
  if (e.key === 'ArrowLeft') showPage(settings.page - 1);
});
$('menuBtn').onclick = () => { selectTab('pages'); openWin('menu'); };
$('tab-apps').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) { showPage(+b.dataset.goto); closeWin('menu'); } };
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
bindSeg('unitSeg', 'units');
bindSeg('modeSeg', 'mode', applyMode);
bindSeg('soundSeg', 'sound');
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
$('ccSetBtn').onclick = () => openNumpad(`Cruise Set Speed (${U.speedUnit()})`, v => send('cruiseSet', metric() ? v : v / 0.621371));

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
async function send(name, value = 0, index = 0, el = null) {
  try {
    const r = await fetch('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value, index }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    if (el) {
      el.classList.add('pending'); pendingCmds.set(j.id, el);
      setTimeout(() => { el.classList.remove('pending'); pendingCmds.delete(j.id); }, 3000);
    }
  } catch (e) {
    shade('Command not sent: G5Link bridge unreachable', 'warn', 3000);
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  send(b.dataset.cmd, Number(b.dataset.value || 0), Number(b.dataset.index || 0), b);
});
$('resetWork').onclick = () => confirmBox('Work Monitor', 'Reset all work counters to zero?', () => send('resetWork'));
$('skWork').onclick = () => showPage(2);

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
    ['Vehicle', inVehicle ? v.name : '---'], ['Work Recording', w.recording ? 'On' : 'Off'], ['Units', metric() ? 'Metric' : 'US'],
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

  const r = rates(w);
  renderWorkMonitor(v, w, imps, r);
  renderImplements(imps);
  renderMachine(v, fuelPct, defPct, r);
  renderHarvest(d, v);
  renderField(d);
  if (window.onTelemetry) window.onTelemetry(d);
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
            <b>${pct.toFixed(0)}%  ${fmt(U.vol(f.level), 0)}</b></div>`;
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
// Bushel weights (lb/bu) by FS25 fill type name, for US yield units. Unknown crops fall back to 56.
const LB_PER_BU = { WHEAT: 60, SOYBEAN: 60, BARLEY: 48, OAT: 32, CANOLA: 50, MAIZE: 56, SORGHUM: 56, SUNFLOWER: 28,
  RYE: 56, TRITICALE: 50, PEA: 60, BEANS: 60, LENTILS: 60, CHICKPEAS: 60, RICELONGGRAIN: 45, RICE: 45, SPELT: 40 };
const HU = {
  lbPerBu: crop => LB_PER_BU[String(crop || '').toUpperCase()] || 56,
  yield: (tha, crop) => metric() ? tha : tha * 892.18 / HU.lbPerBu(crop),       // t/ha -> bu/ac
  yieldUnit: () => metric() ? 't/ha' : 'bu/ac',
  flow: (tph, crop) => metric() ? tph : tph * 2204.62 / HU.lbPerBu(crop),       // t/h -> bu/h
  flowUnit: () => metric() ? 't/h' : 'bu/h',
  mass: (kg, crop) => metric() ? (kg >= 1000 ? fmt(kg / 1000, 1) + ' t' : fmt(kg, 0) + ' kg') : fmt(kg * 2.20462 / HU.lbPerBu(crop), 0) + ' bu',
  tank: l => metric() ? fmt(l, 0) + ' L' : fmt(l / 35.239, 0) + ' bu',
};
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
    tile('Yield', val(rh && rh.yield, x => HU.yield(x, crop), metric() ? 2 : 1), HU.yieldUnit(), { on }),
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
    kv('Tire Pressure', typeof mud.tirePressure === 'number' ? (metric() ? fmt(mud.tirePressure, 2) + ' bar' : fmt(mud.tirePressure * 14.504, 1) + ' psi') : '---'),
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
showPage(settings.page || 0);
render();
connect();

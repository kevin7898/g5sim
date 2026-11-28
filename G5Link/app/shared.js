'use strict';
// Shared by the G5 display (index.html) and the Ops Center (ops/index.html): per-device settings,
// units (each quantity Metric or US) and formatting helpers. Same localStorage key, so both agree.

// ------------------------------------------------------------ settings (per device)
const settings = { units: {}, mode: 'day', sound: 'on', pageName: null };
try { Object.assign(settings, JSON.parse(localStorage.getItem('g5link') || '{}')); } catch (e) { /* private mode */ }
function saveSettings() { try { localStorage.setItem('g5link', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ------------------------------------------------------------ units
// Each quantity has its own unit setting (Menu > System > Units); the Metric / US key sets them all.
const UNIT_KINDS = [
  ['speed', 'Speed', 'km/h', 'mph'],
  ['distance', 'Distance', 'm · cm · km', 'ft · in · mi'],
  ['area', 'Area', 'ha', 'ac'],
  ['volume', 'Volume (liquids)', 'L', 'gal'],
  ['grain', 'Yield and Grain', 't/ha · t/h · t', 'bu/ac · bu/h · bu'],
  ['rate', 'Seeding Rate', 'seeds/ha · kg/ha', 'seeds/ac · lb/ac'],
  ['pressure', 'Pressure', 'bar', 'psi'],
  ['temperature', 'Temperature', '°C', '°F'],
];
if (typeof settings.units === 'string') {           // older settings: one value for everything
  const all = settings.units; settings.units = {}; UNIT_KINDS.forEach(([k]) => { settings.units[k] = all; });
}
if (!settings.units || typeof settings.units !== 'object') settings.units = {};
UNIT_KINDS.forEach(([k]) => { if (settings.units[k] !== 'imperial') settings.units[k] = 'metric'; });
const metric = kind => settings.units[kind] !== 'imperial';
function unitPreset() {
  const vals = UNIT_KINDS.map(([k]) => settings.units[k]);
  return vals.every(v => v === 'metric') ? 'metric' : vals.every(v => v === 'imperial') ? 'imperial' : 'custom';
}
const U = {
  speed: v => metric('speed') ? v : v * 0.621371,
  speedUnit: () => metric('speed') ? 'km/h' : 'mph',
  area: m2 => metric('area') ? m2 / 10000 : m2 / 4046.856,
  areaFromHa: ha => metric('area') ? ha : ha * 2.47105,
  areaUnit: () => metric('area') ? 'ha' : 'ac',
  vol: l => metric('volume') ? l : l * 0.264172,
  volUnit: () => metric('volume') ? 'L' : 'gal',
  dist: m => metric('distance') ? (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m')
                      : (m >= 1609 ? (m / 1609.34).toFixed(2) + ' mi' : Math.round(m * 3.28084) + ' ft'),
  width: m => metric('distance') ? m.toFixed(1) + ' m' : (m * 3.28084).toFixed(1) + ' ft',
};
const fmt = (v, d = 0) => (v === undefined || v === null || Number.isNaN(Number(v))) ? '---' : Number(v).toFixed(d);
function hms(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Bushel weights (lb/bu) by FS25 fill type name, for US yield units. Unknown crops fall back to 56.
const LB_PER_BU = { WHEAT: 60, SOYBEAN: 60, BARLEY: 48, OAT: 32, CANOLA: 50, MAIZE: 56, SORGHUM: 56, SUNFLOWER: 28,
  RYE: 56, TRITICALE: 50, PEA: 60, BEANS: 60, LENTILS: 60, CHICKPEAS: 60, RICELONGGRAIN: 45, RICE: 45, SPELT: 40,
  WV_SPRINGWHEAT: 60, WV_WINTERWHEAT: 60 };                                     // Wheat Varieties mod
const HU = {
  lbPerBu: crop => LB_PER_BU[String(crop || '').toUpperCase()] || 56,
  yield: (tha, crop) => metric('grain') ? tha : tha * 892.18 / HU.lbPerBu(crop),       // t/ha -> bu/ac
  yieldUnit: () => metric('grain') ? 't/ha' : 'bu/ac',
  flow: (tph, crop) => metric('grain') ? tph : tph * 2204.62 / HU.lbPerBu(crop),       // t/h -> bu/h
  flowUnit: () => metric('grain') ? 't/h' : 'bu/h',
  mass: (kg, crop) => metric('grain') ? (kg >= 1000 ? fmt(kg / 1000, 1) + ' t' : fmt(kg, 0) + ' kg') : fmt(kg * 2.20462 / HU.lbPerBu(crop), 0) + ' bu',
  tank: l => metric('grain') ? fmt(l, 0) + ' L' : fmt(l / 35.239, 0) + ' bu',
};

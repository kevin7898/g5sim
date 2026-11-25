'use strict';
// Reads what tests/mod_smoke.lua made the mod write, using the real bridge parser.
//   node G5Link/tests/check_output.js <output folder>
const fs = require('fs');
const path = require('path');
const { telemetryFromXml } = require('../bridge/g5link-bridge.js');

const OUT = process.argv[2];
if (!OUT) { console.error('usage: check_output.js <output folder>'); process.exit(2); }
let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
function eq(a, b, label) { check(a === b, `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const dirOf = s => path.join(OUT, s, 'modSettings', 'FS25_G5Link');
const read = (s, f) => fs.readFileSync(path.join(dirOf(s), f), 'utf8');

// Scenario 1: vanilla tractor (the last telemetry is the "unloaded" idle file)
{
  const t = telemetryFromXml(read('vanilla_tractor', 'telemetry.xml'));
  eq(t.state, 'unloaded', 'vanilla: final state');
  const p = JSON.parse(read('vanilla_tractor', 'providers.json'));
  eq(p.source, 'g5link', 'vanilla: providers source');
  eq(typeof p.seq, 'number', 'vanilla: providers seq');
  for (const id of ['soil-fertilizer', 'courseplay', 'autodrive', 'mud-system-physics']) {
    check(p.status && p.status[id] && p.status[id].available === false, `vanilla: ${id} reported unavailable`);
  }
  const c = JSON.parse(read('vanilla_tractor', 'course.json'));
  eq(c.key, undefined, 'vanilla: empty course has no key');
  check(Array.isArray(c.waypoints) && c.waypoints.length === 0, 'vanilla: empty waypoint list is an array');
}

// Scenario 2: combine with all mods; telemetry was overwritten by deleteMap, so check JSON files
{
  const p = JSON.parse(read('combine_all_mods', 'providers.json'));
  eq(p.fieldId, 12, 'combine: frame field id');
  const soil = p.providers['soil-fertilizer'];
  check(soil && soil.values && soil.values.nitrogen.value === 46, 'combine: soil nitrogen');
  eq(soil && soil.values.note, 'quote " and \\ back\nslash', 'combine: string escaping survives');
  const cp = p.providers.courseplay;
  check(cp && cp.active === true && Math.abs(cp.progress - 0.42) < 1e-9, 'combine: courseplay progress');
  eq(cp && cp.course && cp.course.waypoints, undefined, 'combine: no waypoints in providers.json');
  eq(cp && cp.hasFieldPolygon, true, 'combine: field polygon flagged');
  eq(cp && cp.course && cp.course.remainingTurns, 3, 'combine: remaining turns');
  const ad = p.providers.autodrive;
  check(ad && ad.active === true && ad.destination === 'Grain Bins', 'combine: autodrive state');
  check(ad && ad.activePath.length <= 64, 'combine: autodrive path trimmed to 64');
  eq(p.courseKey, 'hash-1|Field 12 course|50|500', 'combine: course key');
  const c = JSON.parse(read('combine_all_mods', 'course.json'));
  eq(c.key, p.courseKey, 'combine: course.json key matches');
  eq(c.waypoints.length, 50, 'combine: 50 waypoints');
  eq(c.field.length, 4, 'combine: field boundary points');
  const w1 = c.waypoints[0], w10 = c.waypoints[9], w47 = c.waypoints[46];
  eq(w1[2] & 1, 1, 'combine: waypoint 1 is a row start');
  eq(w10[2] & 2, 2, 'combine: waypoint 10 is a row end');
  eq(w47[2] & 8, 8, 'combine: waypoint 47 is a connecting path');
}

// Telemetry with a combine and RH: re-run of the parser on a saved mid-run copy is not available,
// so the Lua side checks those keys. Here: the broken-vehicle telemetry must still parse.
{
  const t = telemetryFromXml(read('broken_vehicle', 'telemetry.xml'));
  eq(t.state, 'unloaded', 'broken: final state parses');
}

// Scenario 3: external API
{
  const p = JSON.parse(read('external_api', 'providers.json'));
  eq(p.source, 'fieldPathPrivateAPI', 'external: source');
  eq(p.providers['soil-fertilizer'].values.pH, 6.1, 'external: pH passed through');
}

// JSON encoder samples
{
  const lines = fs.readFileSync(path.join(OUT, 'json_samples.txt'), 'utf8').trim().split('\n');
  const parsed = lines.map((l, i) => { try { return JSON.parse(l); } catch (e) { check(false, `json sample ${i + 1} parses: ${e.message} in ${l}`); return null; } });
  const [a, empty, nested, str, nums, gap] = parsed;
  check(a && a.a === 1 && a.b === 'two' && a.c === true && JSON.stringify(a.d) === '[1,2,3]', 'json: basic object');
  check(Array.isArray(empty) && empty.length === 0, 'json: empty table is []');
  check(nested && nested.nested.deep.deeper[0] === 1.5 && nested.nested.deep.deeper[1] === -2.25 && Math.abs(nested.nested.deep.deeper[2] - 1e-7) < 1e-12, 'json: nested numbers');
  eq(str && str.s, 'quote " back \\ newline \n tab \t ctrl \u0001 é', 'json: string escapes');
  check(nums && nums.nan === null && nums.inf === null && nums.big === 123456789012, 'json: NaN/inf to null, big integers kept');
  check(gap && !Array.isArray(gap) && gap['1'] === 'x' && gap['3'] === 'gap', 'json: sparse table becomes an object');
}

// Full telemetry round trip: the mod writes, the bridge parses (fresh files written mid-run)
for (const s of ['vanilla_tractor', 'combine_all_mods', 'external_api', 'broken_vehicle']) {
  const f = path.join(OUT, s, 'telemetry_live.xml');
  if (fs.existsSync(f)) {
    try { telemetryFromXml(fs.readFileSync(f, 'utf8')); } catch (e) { check(false, `${s}: live telemetry parses: ${e.message}`); }
  }
}
const live = path.join(OUT, 'combine_all_mods', 'telemetry_live.xml');
if (fs.existsSync(live)) {
  const t = telemetryFromXml(fs.readFileSync(live, 'utf8'));
  eq(t.vehicle.field, 12, 'live: vehicle field');
  eq(t.combine.tank, 5200, 'live: combine tank');
  eq(t.rh.crop, 'WHEAT', 'live: rh crop');
  eq(t.rh.yield, undefined, 'live: NaN yield absent');
  eq(t.rh.settings.length, 6, 'live: six settings');
  eq(t.rh.settings[0].name, 'concave', 'live: first setting');
  eq(t.rh.settings[0].opt, 24, 'live: concave optimum');
  eq(t.rh.trip.areaHa, 3.2, 'live: trip area');
  eq(t.implements.length, 1, 'live: header listed');
} else {
  check(false, 'combine live telemetry copy exists');
}

console.log(`node checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

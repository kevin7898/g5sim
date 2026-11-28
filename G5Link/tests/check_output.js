'use strict';
// Reads what tests/mod_smoke.lua made the mod write, using the real bridge parser.
//   node G5Link/tests/check_output.js <output folder>
const fs = require('fs');
const path = require('path');
const { telemetryFromXml, fleetFromXml } = require('../bridge/g5link-bridge.js');

const OUT = process.argv[2];
if (!OUT) { console.error('usage: check_output.js <output folder>'); process.exit(2); }
let checks = 0, failures = 0;
function check(cond, label) { checks++; if (!cond) { failures++; console.log('  FAIL ' + label); } }
function eq(a, b, label) { check(a === b, `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const dirOf = s => path.join(OUT, s, 'modSettings', 'FS25_G5Link');
const read = (s, f) => fs.readFileSync(path.join(dirOf(s), f), 'utf8');

{
  const impl = '<implement areas="0010" processing="0?10"><section lanes="4" rows="0010"/><area/><area/><area i="2" sx="1" sz="1" wx="2" wz="1"/></implement>';
  const frame = telemetryFromXml(`<g5 session="test-load" seq="1"><implements>${impl}</implements></g5>`);
  const tool = frame.implements[0];
  eq(frame.session, 'test-load', 'telemetry has a stable load identity');
  eq(tool.areas.join(','), 'false,false,true,false', 'work-area leading zeroes preserve positions');
  eq(JSON.stringify(tool.processing), '[false,null,true,false]', 'processing retains known and unknown observations');
  eq(tool.section.states.join(''), '0010', 'section states preserve leading inactive lanes');
  eq(JSON.stringify(tool.geometry.map(g => g.i)), '[2]', 'sparse geometry keeps its index and omits FS25 XML placeholders');
  const fleet = fleetFromXml(`<fleet session="test-load" seq="1" time="500" save="savegame3"><vehicle id="worker"><implements>${impl}</implements></vehicle></fleet>`);
  eq(fleet.session, frame.session, 'fleet and driven source share the load identity');
  eq(fleet.time, 500, 'fleet supplies a source time');
  eq(fleet.save, 'savegame3', 'fleet supplies a save key');
  eq(fleet.vehicles[0].implements[0].areas.join(','), tool.areas.join(','), 'fleet uses the same positional masks');
  const legacyPipe = telemetryFromXml('<g5><controls><pipe state="2" open="true"/></controls></g5>').controls.pipe;
  eq(legacyPipe.open, true, 'legacy pipe still reports its position');
  eq(legacyPipe.unloading, undefined, 'legacy pipe reports no grain transfer evidence');
}

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
{
  const f = path.join(OUT, 'vanilla_tractor', 'telemetry_live.xml');
  const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
  const imp = t.implements[0];
  eq(t.game.save, 'savegame9', 'live: savegame key');
  eq(imp.geometry.length, 16, 'live: 16 work-area geometries');
  eq(imp.geometry[0].sx, 92.5, 'live: geometry start x');
  eq(imp.areas.length, 16, 'live: section bits exclude auxiliary areas');
  eq(imp.fills[0].type, 'SEEDS', 'live: fill type');
  eq(imp.seeder && imp.seeder.unit, 'seedsPerAcre', 'live: seeder unit');
  eq(imp.seeder && imp.seeder.rows.length, 2, 'live: seeder rows');
  eq(imp.seeder && imp.seeder.rows[0].actual, 34210, 'live: seeder row actual');
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

{
  const f = path.join(OUT, 'combine_controls', 'telemetry_live.xml');
  check(fs.existsSync(f), 'controls live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.controls && t.controls.beacon, true, 'live: beacon on');
    eq(t.controls && t.controls.workFront, true, 'live: front work lights');
    eq(t.controls && t.controls.pipe && t.controls.pipe.open, true, 'live: pipe open');
    eq(t.controls.pipe.unloading, true, 'live: native grain discharge');
    eq(t.controls && t.controls.fold && t.controls.fold.unfolded, true, 'live: header unfolded');
    eq(t.harvestAuto && t.harvestAuto.state, 'active', 'live: automation state');
    eq(t.harvestAuto && t.harvestAuto.target, 5.8, 'live: automation target');
  }
}

{
  const f = path.join(OUT, 'tillage', 'telemetry_live.xml');
  check(fs.existsSync(f), 'tillage live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.implements[0].tillage && t.implements[0].tillage.type, 'disc', 'live: disc tillage type');
    eq(t.implements[1].tillage && t.implements[1].tillage.depth, 6, 'live: plow depth');
    eq(t.implements[4].tillage && t.implements[4].tillage.levels, 'shallow,normal,deep', 'live: Cultivator Settings levels');
    eq(t.implements[1].tillage && t.implements[1].tillage.canSet, true, 'live: plow depth settable');
  }
}

{
  const f = path.join(OUT, 'headland', 'telemetry_live.xml');
  check(fs.existsSync(f), 'headland live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.headland && t.headland.armed, true, 'live: headland armed');
    eq(t.headland && t.headland.steer, 'base', 'live: steering helper');
    check(t.headland && t.headland.events >= 4, 'live: headland events counted');
  }
}

{
  const f = path.join(OUT, 'grain_cart', 'telemetry_live.xml');
  check(fs.existsSync(f), 'grain cart live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.grainCart && t.grainCart.name, 'Far Cart', 'live: grain cart name');
    eq(t.grainCart && t.grainCart.nudgeX, -0.5, 'live: grain cart side nudge');
  }
}

{
  const f = path.join(OUT, 'rtk', 'telemetry_live.xml');
  check(fs.existsSync(f), 'rtk live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.gnss && t.gnss.level, 'RTK', 'live: gnss level');
    eq(t.gnss && t.gnss.gates, true, 'live: gates switched on');
    eq(t.gnss && t.gnss.gate && t.gnss.gate.headland, true, 'live: headland gate');
    eq(t.gnss && t.gnss.base, 'John Deere RTK Station', 'live: base name');
  }
}

{
  const f = path.join(OUT, 'gps_options', 'telemetry_live.xml');
  check(fs.existsSync(f), 'gps options live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.gnss && t.gnss.receiver, 'SF3000', 'live: receiver from shop option');
    eq(t.gnss && t.gnss.hwSource, 'shop', 'live: hardware source');
  }
}

{
  const f = path.join(OUT, 'autotrac', 'telemetry_live.xml');
  check(fs.existsSync(f), 'autotrac live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.autotrac && t.autotrac.state, 'engaged', 'live: AutoTrac engaged');
    eq(t.autotrac && t.autotrac.turns, 1, 'live: one turn counted');
    eq(t.autotrac && t.autotrac.turnOn, true, 'live: Turn Automation on');
    eq(t.autotrac && t.autotrac.stage, 4, 'live: AutoTrac stage 4/4');
    eq(t.autotrac && t.autotrac.steerOn, true, 'live: Steer ON');
    check(/^activation=1;.*onTrack=\d$/.test(t.autotrac && t.autotrac.diag || ''), 'live: AutoTrac diagnostics string');
  }
}

{
  const f = path.join(OUT, 'fleet', 'fleet_live.xml');
  check(fs.existsSync(f), 'fleet live copy exists');
  if (fs.existsSync(f)) {
    const fl = fleetFromXml(fs.readFileSync(f, 'utf8'));
    eq(fl.vehicles.length, 1, 'fleet: one working machine');
    eq(fl.vehicles[0] && fl.vehicles[0].id, 'vehAI', 'fleet: machine id');
    eq(fl.vehicles[0] && fl.vehicles[0].implements[0].geometry.length, 1, 'fleet: header geometry');
    check(fl.vehicles[0] && fl.vehicles[0].combine && fl.vehicles[0].combine.tankCap > 0, 'fleet: combine tank');
    check(fl.vehicles[0] && fl.vehicles[0].rh && fl.vehicles[0].rh.crop === 'WHEAT', 'fleet: rh crop');
  }
}

{
  const f = path.join(OUT, 'rate_sf', 'telemetry_live.xml');
  check(fs.existsSync(f), 'rate live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    eq(t.rate && t.rate.system, 'sf', 'live: rate system');
    eq(t.rate && t.rate.rxActive, true, 'live: prescription active');
    eq(t.rate && t.rate.applied, 1.25, 'live: applied step');
  }
}

{
  const f = path.join(OUT, 'section_control', 'telemetry_live.xml');
  check(fs.existsSync(f), 'section control live telemetry copy exists');
  if (fs.existsSync(f)) {
    const t = telemetryFromXml(fs.readFileSync(f, 'utf8'));
    const imp = t.implements[0] || {};
    eq(t.section && t.section.allowed, true, 'live: section control allowed');
    eq(t.section && t.section.overlap, 2, 'live: overlap');
    eq(imp.section && imp.section.states.join(''), '1a10', 'live: lane states');
    eq(imp.section && imp.section.controller, 'G5Link', 'live: controller');
    eq(imp.areas && imp.areas.map(Number).join(''), '1010', 'live: lanes as sections');
    eq(imp.geometry && imp.geometry.length, 4, 'live: lane geometry');
  }
}

console.log(`node checks: ${checks}, failures: ${failures}`);
process.exit(failures ? 1 : 0);

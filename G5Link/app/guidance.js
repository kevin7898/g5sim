'use strict';
// G5Link Guidance run page: straight AB tracks, off-track error, lightbar, perspective map.
// Guidance is computed on the display from the vehicle position the mod streams (x, z, heading).
// World convention (matches the mod): north = -Z, heading 0 = north, 90 = east.

(function () {
  const G = Object.assign({ tracks: [], current: -1, currentId: null, lastByField: {}, migrated: false, spacing: null, shift: 0, incr: 0.0254, zoom: 1, view: '3d',
    turn: { on: false, skip: 0, dir: 'auto', radius: 0 }, steerOn: true, sens: 70, spacingMode: 'distance', rows: 24, rowWidth: 0.762,
    shiftMaster: true }, settings.guid || {});
  settings.guid = G;
  const save = () => { settings.guid = G; saveSettings(); };

  const rad = d => d * Math.PI / 180;
  const fwdOf = h => ({ x: Math.sin(rad(h)), z: -Math.cos(rad(h)) });   // unit vector of heading
  const rightOf = h => ({ x: Math.cos(rad(h)), z: Math.sin(rad(h)) });
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinal = h => CARD[Math.round(((h % 360) + 360) % 360 / 45) % 8];

  // ---------------------------------------------------------------- live pose (dead-reckoned between 4 Hz frames)
  const pose = { ok: false, x: 0, z: 0, h: 0, speed: 0, dir: 1, t: 0, width: 0, recording: false, farmland: null, onField: false };
  const CHEV_STEP = 60;        // metres between pass-direction chevrons
  const VIEW_R = 640;          // the G5 shows map data within 0.64 km of the machine

  // AutoTrac chip on the map: the four-quarter status pie (tap = the AutoTrac window)
  function renderAutoTrac(d) {
    const at = d.autotrac, el = $('mapAt');
    el.hidden = !at || d.state !== 'vehicle';
    if (el.hidden || !window.G5AutoTrac) return;
    const st = G5AutoTrac.stageOf(at);
    el.className = 'map-at ' + (at.state === 'notReady' ? '' : at.state === 'ready' && st < 3 ? 'off' : at.state);
    setHtml($('mapAtPie'), G5AutoTrac.pie(st));
    $('mapAtTxt').textContent = G5AutoTrac.shortText(at);
  }
  $('mapAt').onclick = () => window.G5AutoTrac && G5AutoTrac.open();

  window.onTelemetry = d => {
    renderAutoTrac(d);
    if (window.G5Layers) { G5Layers.onTelemetry(d); G5Layers.renderLegend(); }
    if (window.G5Bounds) G5Bounds.onTelemetry(d);
    if (window.G5WorkSetup) G5WorkSetup.onTelemetry(d);
    if (window.G5Headland) G5Headland.onTelemetry(d);
    if (window.G5StarFire) G5StarFire.onTelemetry(d);
    if (window.G5AutoTrac) G5AutoTrac.onTelemetry(d);
    if (d.ops && d.ops.fields !== T.version) loadTracks();
    const v = d.vehicle;
    if (d.state !== 'vehicle' || !v || v.x === undefined) { pose.ok = false; return; }
    const imps = d.implements || [];
    pose.ok = true;
    pose.x = v.x; pose.z = v.z; pose.h = v.heading || 0;
    pose.speed = v.speed || 0; pose.dir = v.dir < 0 ? -1 : 1;
    pose.t = performance.now();
    pose.width = imps.reduce((m, i) => Math.max(m, i.width || 0), 0);
    pose.recording = !!(d.work && d.work.recording);
    pose.farmland = v.farmland; pose.onField = !!v.onField;
    pose.implName = imps[0] ? imps[0].name : null;
    // implement bars in vehicle-local metres (r = right, f = forward) from the real work-area corners
    const fw = fwdOf(pose.h), rw = rightOf(pose.h);
    pose.bars = imps.map(i => {
      const pts = (i.geometry || []).flatMap(g => [[g.sx, g.sz], [g.wx, g.wz]]).filter(q => typeof q[0] === 'number');
      if (!pts.length) return null;
      const loc = pts.map(([x, z]) => ({ r: (x - v.x) * rw.x + (z - v.z) * rw.z, f: (x - v.x) * fw.x + (z - v.z) * fw.z }));
      const r0 = Math.min(...loc.map(q => q.r)), r1 = Math.max(...loc.map(q => q.r));
      const f = loc.reduce((a, q) => a + q.f, 0) / loc.length;
      return { r0, r1, f };
    }).filter(Boolean);
    pose.field = d.field ?? v.field ?? null;
    onFieldChange(workField());
    const pv = d.providers || {};
    pose.cp = pv.courseplay || null;
    pose.ad = pv.autodrive || null;
    if ((d.courseKey ?? null) !== courseKey) loadCourse(d.courseKey ?? null);
    renderSide();
  };

  // Courseplay course and field boundary (course.json via /api/course), refetched when the key changes
  let courseKey = null, course = null;
  function loadCourse(key) {
    courseKey = key;
    if (!key) { course = null; return; }
    fetch('/api/course').then(r => r.json()).then(c => { if (courseKey === key) course = c; }).catch(() => { courseKey = null; });
  }

  function livePose() {
    if (!pose.ok) return null;
    const dt = Math.min(0.5, (performance.now() - pose.t) / 1000);
    const f = fwdOf(pose.h), m = pose.speed / 3.6 * dt * pose.dir;
    return { x: pose.x + f.x * m, z: pose.z + f.z * m, h: pose.h };
  }

  // ---------------------------------------------------------------- guidance math
  const spacing = () => G.spacingMode === 'rows' && G.rows > 0 && G.rowWidth > 0 ? G.rows * G.rowWidth : G.spacing || pose.width || 12;
  // While AutoTrac steers, the G5 keeps the track: no track change and no shift over 0.3 m (12 in)
  const engaged = () => !!(data.autotrac && (data.autotrac.state === 'engaged' || data.autotrac.state === 'turning'));
  const MAX_SHIFT_ENGAGED = 0.3;
  // Tracks live in the bridge (Data Sync), shared with every display and the Ops Center.
  const T = { list: [], version: -1, loading: false, field: undefined };
  const currentTrack = () => T.list.find(t => t.id === G.currentId) || null;
  const workField = () => {
    const ws = data.workSetup || {};
    return ws.fieldMode === 'fixed' && ws.fieldId ? String(ws.fieldId) : pose.field !== null && pose.field !== undefined ? String(pose.field) : null;
  };
  async function trackApi(body) {
    const r = await fetch('/api/ops/tracks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'not saved');
    return j;
  }
  async function loadTracks() {
    if (T.loading) return;
    T.loading = true;
    try {
      const r = await (await fetch('/api/ops/tracks')).json();
      T.list = r.tracks || [];
      T.version = r.version;
      // one-time move of tracks made before Data Sync (kept only in this browser)
      if (!G.migrated) {
        G.migrated = true;
        const local = (G.tracks || []).filter(t => typeof t.ax === 'number');
        if (local.length && !T.list.length) {
          const oldCurrent = G.tracks[G.current];
          for (const t of local) {
            const res = await trackApi({ action: 'add', track: { name: t.name, ax: t.ax, az: t.az, h: t.h, how: /A\+B/.test(t.name || '') ? 'A+B' : 'A+Heading', fieldId: null } });
            T.list.push(res.track);
            if (t === oldCurrent) G.currentId = res.track.id;
          }
          shade(`${local.length} guidance track${local.length > 1 ? 's' : ''} moved to the bridge (shared with every display).`, 'info', 4000);
        }
        G.tracks = []; save();
      }
      if (!currentTrack() && T.field !== undefined) { const f = T.field; T.field = undefined; onFieldChange(f); }
      renderTrackList(); renderSide();
    } catch (e) { /* bridge offline: keep the last list */ } finally { T.loading = false; }
  }
  // When the field changes, pick up the track last used in that field (as the G5 does).
  function onFieldChange(field) {
    if (field === T.field || engaged()) return;
    if (T.field !== undefined && G.currentId) G.lastByField[T.field ?? ''] = G.currentId;
    T.field = field;
    const last = G.lastByField[field ?? ''];
    const cur = currentTrack();
    if (last && T.list.some(t => t.id === last) && (!cur || (cur.fieldId ?? null) !== field)) { G.currentId = last; G.shift = 0; }
    else if (!cur || (cur.fieldId !== null && cur.fieldId !== field)) {
      const first = T.list.find(t => t.fieldId === field);
      if (first) { G.currentId = first.id; G.shift = 0; }
    }
    save(); renderSide();
  }
  function solve(p) {
    const t = currentTrack();
    if (!t || !p) return null;
    const n = rightOf(t.h);
    const off = (p.x - t.ax) * n.x + (p.z - t.az) * n.z - G.shift;   // lateral distance from shifted track 0
    const k = Math.round(off / spacing());
    const err = off - k * spacing();                                  // + = right of the nearest track
    let hdgErr = ((p.h - t.h + 540) % 360) - 180;                     // driving the track either way round
    if (Math.abs(hdgErr) > 90) hdgErr = hdgErr > 0 ? hdgErr - 180 : hdgErr + 180;
    return { k, err, hdgErr, n };
  }

  // ---------------------------------------------------------------- lightbar
  const SEGS = 13;                       // per side
  const SEG_M = 0.0508;                  // 2 in per light
  $('lightbar').innerHTML =
    Array.from({ length: SEGS }, (_, i) => `<i data-l="${SEGS - i}"></i>`).join('') +
    '<b id="lbCenter">---</b>' +
    Array.from({ length: SEGS }, (_, i) => `<i data-r="${i + 1}"></i>`).join('');
  const lbLeft = [...$('lightbar').querySelectorAll('[data-l]')];
  const lbRight = [...$('lightbar').querySelectorAll('[data-r]')];
  function errText(m) {
    const a = Math.abs(m);
    if (metric('distance')) return a < 1 ? `${Math.round(a * 100)}<small>cm</small>` : `${a.toFixed(1)}<small>m</small>`;
    const inch = a / 0.0254;
    return inch < 100 ? `${Math.round(inch)}<small>in</small>` : `${(a * 3.28084).toFixed(0)}<small>ft</small>`;
  }
  function renderLightbar(s) {
    const lit = s ? Math.min(SEGS, Math.floor(Math.abs(s.err) / SEG_M)) : 0;
    // "Steer towards": vehicle right of the line lights the left side.
    const steerLeft = s && s.err > 0;
    lbLeft.forEach(el => el.classList.toggle('on', steerLeft && +el.dataset.l <= lit));
    lbRight.forEach(el => el.classList.toggle('on', !steerLeft && s && +el.dataset.r <= lit));
    $('lbCenter').innerHTML = s ? errText(s.err) : '---';
    $('lbCenter').classList.toggle('ok', !!s && lit === 0);
  }

  // ---------------------------------------------------------------- side modules
  // as the G5 writes it: three decimals, no space ("60.000ft")
  const lenText = m => metric('distance') ? `${m.toFixed(3)}m` : `${(m * 3.28084).toFixed(3)}ft`;
  // AutoTrac in the mod steers to what this display shows: send the selected track, spacing, shift and the
  // Turn Automation settings to the bridge (guidance.xml) whenever they change.
  let sentKey = '';
  function sendGuidance() {
    const t = currentTrack();
    const body = { track: t ? { id: t.id, name: t.name, ax: t.ax, az: t.az, h: t.h } : null, spacing: spacing(), shift: G.shift || 0, turn: G.turn,
      steerOn: G.steerOn !== false, sens: G.sens || 70 };
    const key = JSON.stringify(body);
    if (key === sentKey) return;
    sentKey = key;
    fetch('/api/guidance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key }).catch(() => { sentKey = ''; });
  }
  // Swap Track: the next track in this field (or every track when the field has none), as the G5's SWAP TRACK key
  function swapTrack() {
    if (engaged()) return shade('The track can not change while AutoTrac is engaged.', 'info', 3000), false;
    const field = workField();
    const here = T.list.filter(t => (t.fieldId ?? null) === field);
    const list = here.length ? here : T.list;
    if (!list.length) return shade('No guidance tracks yet: Set Track > New Track.', 'info', 3000), false;
    const i = list.findIndex(t => t.id === G.currentId);
    const next = list[(i + 1) % list.length];
    if (next.id === G.currentId) return shade('This field has only one track.', 'info', 2500), false;
    G.currentId = next.id; G.shift = 0; save(); renderTrackList(); renderSide();
    shade(`Track: ${next.name}`, 'info', 2000);
    return true;
  }
  window.G5Guidance = {
    turn: () => G.turn, setTurn: patch => { G.turn = { ...G.turn, ...patch }; save(); sendGuidance(); }, send: sendGuidance,
    get: () => G, set: patch => { Object.assign(G, patch); save(); renderSide(); }, spacing, lenText, track: currentTrack, swap: swapTrack,
    tracks: () => T.list, engaged, quickLine,
  };
  // Quick Line (the G5's shortcut for A + Auto B): a straight track from here along the current heading
  function quickLine() {
    if (engaged()) return shade('AutoTrac: the track can not change while AutoTrac is engaged.', 'info', 3000);
    const p = livePose();
    if (!p) return shade('Quick Line: no machine position. Enter a machine first.', 'info', 3000);
    addTrack(p.x, p.z, p.h, 'Quick Line');
    shade(`Quick Line: new track along ${cardinal(p.h)} ${Math.round(p.h)}°.`, 'info', 2500);
  }
  function renderSide() {
    sendGuidance();
    const t = currentTrack();
    $('trkName').textContent = t ? t.name : '---';
    $('trkSpacing').textContent = lenText(spacing());
    $('trkIncr').textContent = metric('distance') ? `${(G.incr * 100).toFixed(1)} cm` : `${(G.incr / 0.0254).toFixed(1)} in`;
    const wf = workField(), ws = data.workSetup || {};
    const fb = wf && window.G5Bounds ? G5Bounds.fields().find(x => String(x.id) === wf) : null;
    $('locName').textContent = wf ? (fb ? fb.name : `Field ${wf}`) : pose.farmland ? `Farmland ${pose.farmland}` : '---';
    const who = [ws.client, ws.farm].filter(Boolean).join(' · ');
    $('locSub').textContent = who || (wf && pose.farmland ? `Farmland ${pose.farmland}` : 'Field');
    renderAi();
  }

  $('setTrackBtn').onclick = () => { renderTrackList(); openWin('trackWin'); };
  $('spacingBtn').onclick = () => G.spacingMode === 'rows'
    ? openNumpad('Track Spacing: number of rows', v => { G.rows = Math.max(1, Math.min(96, Math.round(v))); save(); renderSide(); })
    : openNumpad(`Track Spacing (${metric('distance') ? 'm' : 'ft'})`, v => { G.spacing = metric('distance') ? v : v / 3.28084; save(); renderSide(); });
  const INCRS = [0.0254, 0.0508, 0.1016, 0.3048, 0.01, 0.05, 0.1];
  $('incrBtn').onclick = () => { G.incr = INCRS[(INCRS.indexOf(G.incr) + 1) % INCRS.length]; save(); renderSide(); };
  document.querySelectorAll('[data-shift]').forEach(b => {
    b.onclick = () => {
      const dirn = +b.dataset.shift;
      if (G.shiftMaster === false) return shade('Shift Track is off (Shift Master in AutoTrac settings).', 'info', 3000);
      let d = 0;
      if (dirn === 0) {                            // center the nearest track on the vehicle
        const s = solve(livePose());
        if (s) d = s.err;
      } else d = dirn * G.incr;
      if (engaged() && Math.abs(d) > MAX_SHIFT_ENGAGED) {
        return shade(`No shift over ${metric('distance') ? '0.3 m' : '12 in'} while AutoTrac is engaged.`, 'info', 3500);
      }
      G.shift += d;
      save();
    };
  });

  // ---------------------------------------------------------------- track list window
  let pointA = null;
  async function addTrack(ax, az, h, how) {
    try {
      const r = await trackApi({ action: 'add', track: { ax, az, h, how, fieldId: workField() } });
      T.list.push(r.track);
      G.currentId = r.track.id; G.shift = 0; save(); renderTrackList(); renderSide();
    } catch (e) { shade('Track not saved: G5Link bridge unreachable', 'warn', 3000); }
  }
  function renderTrackList() {
    const field = workField();
    const row = t => `<button class="trk-row ${t.id === G.currentId ? 'on' : ''}" data-trk="${esc(t.id)}"><b>${esc(t.name)}</b><span>${cardinal(t.h)} ${t.h.toFixed(1)}°</span></button>`;
    const here = T.list.filter(t => (t.fieldId ?? null) === field), other = T.list.filter(t => (t.fieldId ?? null) !== field);
    setHtml($('trackList'), T.list.length
      ? (here.length ? `<div class="trk-group">${field ? 'Field ' + esc(field) : 'No field'}</div>${here.map(row).join('')}` : `<p class="hint">No tracks in ${field ? 'field ' + esc(field) : 'this area'} yet.</p>`)
        + (other.length ? `<div class="trk-group">Other fields</div>${other.map(t => row(t).replace('</b>', `</b><em>${t.fieldId ? 'Field ' + esc(t.fieldId) : 'No field'}</em>`)).join('')}` : '')
      : '<p class="hint">No guidance tracks yet. Create one on the right.</p>');
    $('abStatus').textContent = pointA ? 'Point A set. Drive at least 3 m along the line, then tap Set B.'
      : 'Drive to point A, tap Set A, then drive at least 3 m and tap Set B.';
  }
  $('trackList').onclick = e => { const b = e.target.closest('[data-trk]'); if (b && b.dataset.trk !== G.currentId && engaged()) return shade('The track can not change while AutoTrac is engaged.', 'info', 3000);
    if (b) { G.currentId = b.dataset.trk; G.shift = 0; save(); renderTrackList(); renderSide(); } };
  $('newHeading').onclick = () => { const p = livePose(); if (!p) return shade('No vehicle position. Enter a vehicle first.', 'info', 3000); addTrack(p.x, p.z, p.h, 'A+Heading'); };
  $('setA').onclick = () => { const p = livePose(); if (!p) return shade('No vehicle position. Enter a vehicle first.', 'info', 3000); pointA = p; renderTrackList(); };
  $('setB').onclick = () => {
    const p = livePose();
    if (!p || !pointA) return;
    const dx = p.x - pointA.x, dz = p.z - pointA.z;
    if (Math.hypot(dx, dz) < 3) return shade('Drive at least 3 m before setting B.', 'info', 3000);
    const h = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    const a = pointA; pointA = null;
    addTrack(a.x, a.z, h, 'A+B');
  };
  $('trkDelete').onclick = () => {
    const t = currentTrack();
    if (!t) return;
    confirmBox('Guidance Tracks', `Delete ${t.name}? It is removed from every display and the Ops Center.`, async () => {
      try { await trackApi({ action: 'delete', id: t.id }); T.list = T.list.filter(x => x.id !== t.id); G.currentId = null; G.shift = 0; save(); renderTrackList(); renderSide(); }
      catch (e) { shade('Track not deleted: ' + e.message, 'warn', 3000); }
    });
  };

  // ---------------------------------------------------------------- map
  const canvas = $('map'), ctx = canvas.getContext('2d');
  // ---------------------------------------------------------------- view: zoom, pan, pinch, whole field, orientation
  // Overhead zooms out far enough for the whole field (up to ~7 km across); perspective stays near the machine.
  const ZOOM = { '2d': [0.3, 80], '3d': [0.5, 4] };
  const V = { free: false, cx: 0, cz: 0, h: 0, zoomBack: null };    // free = panned away from the machine
  const clampZoom = z => { const [lo, hi] = ZOOM[G.view] || ZOOM['3d']; return Math.min(hi, Math.max(lo, z)); };
  function zoomBy(k) { G.zoom = clampZoom(G.zoom * k); save(); }
  document.querySelectorAll('[data-zoom]').forEach(b => {
    b.onclick = () => zoomBy(+b.dataset.zoom > 0 ? 1.4 : 1 / 1.4);
  });
  const frameHeading = p => G.northUp ? 0 : V.free ? V.h : p.h;
  function goFree(p) {
    if (V.free || !p) return;
    V.free = true; V.cx = p.x; V.cz = p.z; V.h = frameHeading(p); V.zoomBack = G.zoom;
    if (G.view === '3d') { G.view = '2d'; paintView(); }
    paintFree();
  }
  function recenter() {
    V.free = false;
    G.zoom = clampZoom(V.zoomBack !== null ? V.zoomBack : Math.min(G.zoom, 1.5)); V.zoomBack = null;
    save(); paintFree();
  }
  function paintFree() { $('mapCenter').hidden = !V.free; }
  // Whole field: overhead, north up, the field (or the recorded work) filling the map
  function wholeField() {
    const wf = workField();
    const fb = wf && window.G5Bounds ? G5Bounds.fields().find(x => String(x.id) === wf) : null;
    let pts = fb && fb.polygon && fb.polygon.length ? fb.polygon : course && course.field && course.field.length ? course.field : null;
    if (!pts && window.G5Layers) {
      const runs = [...G5Layers.coverageRuns().values()].flat();
      if (runs.length) pts = runs.flatMap(([x0, x1, z0]) => [[x0, z0], [x1, z0]]);
    }
    if (!pts) return shade('Whole field: no field boundary or recorded work here yet.', 'info', 3000);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    if (!V.free) V.zoomBack = G.zoom;
    V.free = true; V.cx = (x0 + x1) / 2; V.cz = (z0 + z1) / 2; V.h = 0;
    G.northUp = true; G.view = '2d'; paintView();
    const { W, H } = size();
    G.zoom = clampZoom(Math.max(z1 - z0, (x1 - x0) * H / W) * 1.12 / 90);
    save(); paintFree(); paintNorth();
  }
  function paintNorth() { $('mapArrow').classList.toggle('north', !!G.northUp); }
  $('mapArrow').onclick = () => {
    G.northUp = !G.northUp;
    if (G.northUp && G.view === '3d') { G.view = '2d'; paintView(); }
    if (V.free && !G.northUp) { const p = livePose(); V.h = p ? p.h : 0; }
    save(); paintNorth();
    shade(`Map: ${G.northUp ? 'north up' : 'heading up'}.`, 'info', 1500);
  };
  $('mapFit').onclick = wholeField;
  $('mapCenter').onclick = recenter;

  // touch and mouse: one finger drags (pan), two fingers pinch (zoom), wheel zooms, double tap zooms in
  const touches = new Map();
  let pinch = null, lastTap = 0, dragged = false;
  canvas.style.touchAction = 'none';
  function screenToWorld(dxPx, dyPx) {
    // a drag of (dx, dy) canvas pixels moves the view centre the other way, in the map frame
    const { H } = size();
    const ppm = H / (90 * G.zoom);
    const r = -dxPx * 2 / ppm, f = dyPx * 2 / ppm;          // canvas is drawn at 2x
    const fw = fwdOf(V.h), rt = rightOf(V.h);
    return { x: r * rt.x + f * fw.x, z: r * rt.z + f * fw.z };
  }
  canvas.addEventListener('pointerdown', e => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    dragged = false;
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: G.zoom };
    }
  });
  canvas.addEventListener('pointermove', e => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const scale = canvas.getBoundingClientRect().width / canvas.clientWidth || 1;   // the display is scaled to fit
    const dx = (e.clientX - t.x) / scale, dy = (e.clientY - t.y) / scale;
    if (touches.size === 2 && pinch) {
      t.x = e.clientX; t.y = e.clientY;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) { G.zoom = clampZoom(pinch.zoom * pinch.d / d); }
      dragged = true;
      return;
    }
    if (!dragged && Math.hypot(dx, dy) < 8) return;
    if (!dragged) { dragged = true; goFree(livePose()); }
    t.x = e.clientX; t.y = e.clientY;
    if (!V.free) return;
    const m = screenToWorld(dx, dy);
    V.cx += m.x; V.cz += m.z;
  });
  const up = e => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!dragged && touches.size === 0) {
      const now = performance.now();
      if (now - lastTap < 320) { zoomBy(1 / 1.6); lastTap = 0; } else lastTap = now;
    }
    if (touches.size === 0) save();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  window.G5Map = { recenter, wholeField, isFree: () => V.free };
  // the button shows the view it switches to: overhead (flat grid) or perspective
  const paintView = () => { setHtml($('mapView'), `<svg><use href="#i-${G.view === '3d' ? 'overhead' : 'persp'}"/></svg>`);
    $('mapView').setAttribute('aria-label', G.view === '3d' ? 'Overhead view' : 'Perspective view'); };
  $('mapView').onclick = () => {
    G.view = G.view === '3d' ? '2d' : '3d';
    if (G.view === '3d') { if (V.free) recenter(); G.northUp = false; paintNorth(); }
    G.zoom = clampZoom(G.zoom); save(); paintView();
  };
  paintView(); paintNorth(); paintFree();

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * 2 || canvas.height !== h * 2) { canvas.width = w * 2; canvas.height = h * 2; }
    return { W: canvas.width, H: canvas.height };
  }

  // camera: returns a projector from vehicle-local (r = right, f = forward, metres) to canvas px
  function camera(W, H) {
    if (G.view === '2d') {
      const ppm = H / (90 * G.zoom);                       // pixels per metre
      const cy = V.free ? H * 0.5 : H * 0.62;              // panned: the view centre mid-screen; else the machine low
      const fn = (r, f) => ({ x: W / 2 + r * ppm, y: cy - f * ppm, s: 1 });
      fn.ppm = ppm;
      return fn;
    }
    // Scale matches the G5: ~27 px per metre at the vehicle on a 1280 px wide display.
    const back = 34 * G.zoom, height = 17 * G.zoom, horizon = H * -0.06;
    const F = (H * 0.5 - horizon) * back / height;         // vehicle lands at 50% height
    return (r, f) => {
      const z = f + back;
      if (z < 1) return null;
      return { x: W / 2 + r * F / z, y: horizon + height * F / z, s: F / z };
    };
  }

  let lastDraw = 0;
  function draw(ts) {
    requestAnimationFrame(draw);
    if (!$('map').offsetParent) return;                   // page not visible
    if (ts - lastDraw < 33) return;                       // ~30 fps is plenty and saves the iPad battery
    lastDraw = ts;
    const { W, H } = size();
    const proj = camera(W, H);
    const p = livePose();
    const s = solve(p);
    renderLightbar(s);

    // ground
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6e6a57'); g.addColorStop(0.35, '#5b5642'); g.addColorStop(1, '#3f3a2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (G.view === '3d') {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.06);
      sky.addColorStop(0, '#9aa7ad'); sky.addColorStop(1, 'rgba(110,106,87,0)');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.06);
    }

    if (!p) {
      $('mapHdg').textContent = '---'; $('mapTrk').textContent = '---';
      $('mapNote').hidden = false; $('mapNote').textContent = 'Waiting for vehicle position';
      return;
    }
    // the view: centred on the machine (heading up or north up), or panned (V.free) to any point
    const hf = frameHeading(p), C = V.free ? { x: V.cx, z: V.cz } : p;
    const f = fwdOf(hf), rt = rightOf(hf);
    const local = (x, z) => { const dx = x - C.x, dz = z - C.z; return { r: dx * rt.x + dz * rt.z, f: dx * f.x + dz * f.z }; };
    const P = (x, z) => { const l = local(x, z); return proj(l.r, l.f); };
    // machine-local (r right, f forward of the machine) to the screen, wherever the view is
    const vf = fwdOf(p.h), vr = rightOf(p.h);
    const projV = (r, fo) => P(p.x + vr.x * r + vf.x * fo, p.z + vr.z * r + vf.z * fo);
    // how far to draw: the part of the world on screen (at least the G5's 0.64 km)
    const viewR = proj.ppm ? Math.max(VIEW_R, Math.hypot(W, H) / proj.ppm * 0.6) : VIEW_R;

    function polyline(pts, style, width, dash) {
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath(); let pen = false;
      for (const q of pts) {
        if (!q) { pen = false; continue; }
        if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // ground grid for a sense of motion (every 20 m, world aligned)
    ctx.globalAlpha = 0.18;
    const gs = viewR > 1500 ? 200 : viewR > 700 ? 100 : 20, gn = Math.min(40, Math.ceil(viewR * 2 / gs));
    const gx0 = Math.floor((C.x - gs * gn / 2) / gs) * gs, gz0 = Math.floor((C.z - gs * gn / 2) / gs) * gs;
    for (let i = 0; i <= gn; i++) {
      const xs = [], zs = [];
      for (let j = 0; j <= gn; j++) { xs.push(P(gx0 + i * gs, gz0 + j * gs)); zs.push(P(gx0 + j * gs, gz0 + i * gs)); }
      polyline(xs, '#d8d2b8', 2); polyline(zs, '#d8d2b8', 2);
    }
    ctx.globalAlpha = 1;

    // coverage and the selected layer, recorded by the bridge (layers.js), batched by color
    const frames = window.G5Layers ? G5Layers.frames() : [];
    const near = (x, z) => Math.abs(x - C.x) < viewR && Math.abs(z - C.z) < viewR;
    // overhead: coverage as tile images under one affine transform; perspective: runs near the machine
    const flat = G.view === '2d' && window.G5Layers && G5Layers.tileImages;
    const byColor = window.G5Layers && !flat ? G5Layers.coverageRuns() : new Map();
    const quadPath = (q) => {
      const a = P(q[0], q[1]), b = P(q[2], q[3]), c = P(q[4], q[5]), e = P(q[6], q[7]);
      if (!a || !b || !c || !e) return;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.closePath();
    };
    ctx.globalAlpha = 0.88;
    if (flat) {
      const o = P(0, 0), ex = P(1, 0), ez = P(0, 1), T = G5Layers.TILE * G5Layers.CELL;
      ctx.save();
      ctx.setTransform(ex.x - o.x, ex.y - o.y, ez.x - o.x, ez.y - o.y, o.x, o.y);   // world metres -> canvas pixels
      ctx.imageSmoothingEnabled = false;
      for (const t of G5Layers.tileImages()) {
        const x = t.tx * T, z = t.tz * T;
        if (!near(x + T / 2, z + T / 2)) continue;
        ctx.drawImage(t.img, x, z, T, T);
      }
      ctx.restore();
    }
    const cellM = (window.G5Layers && G5Layers.CELL) || 1;
    for (const [color, list] of byColor) {
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [x0, x1, z0] of list) {
        if (!near(x0, z0) && !near(x1, z0)) continue;
        quadPath([x0, z0, x1, z0, x1, z0 + cellM, x0, z0 + cellM]);
      }
      ctx.fill(); ctx.stroke();   // stroke closes hairline seams
    }
    ctx.globalAlpha = 1;
    // overlap (more than one pass) in dark blue on the coverage layer
    if (G5Layers.layer().id === 'coverage') {
      const ov = G5Layers.overlap(), cell = ov.cell || 1;
      ctx.fillStyle = G5Layers.OVER; ctx.beginPath();
      for (const [x0, x1, z0] of ov.runs) {
        if (!near(x0, z0)) continue;
        quadPath([x0, z0, x1, z0, x1, z0 + cell, x0, z0 + cell]);
      }
      ctx.fill();
    }

    // pass-direction chevrons on the coverage (as on the G5): one every CHEV_STEP metres of each pass
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.38)'; ctx.lineJoin = 'miter';
    for (const c of (proj.ppm && proj.ppm < 0.6 ? [] : chevrons(frames))) {
      if (!near(c.x, c.z)) continue;
      const cf = fwdOf(c.h), cr = rightOf(c.h), s5 = Math.min(c.w * 0.3, 6);
      const W2 = (fo, ro) => P(c.x + cf.x * fo + cr.x * ro, c.z + cf.z * fo + cr.z * ro);
      const k = [W2(s5 * 1.1, 0), W2(-s5, s5), W2(-s5 * 0.35, 0), W2(-s5, -s5)];   // tip, right tail, notch, left tail
      if (k.some(v => !v)) continue;
      ctx.lineWidth = Math.max(1, k[0].s * 0.08);
      ctx.beginPath(); ctx.moveTo(k[0].x, k[0].y); k.slice(1).forEach(v => ctx.lineTo(v.x, v.y)); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // Ops Center field boundaries (yellow) and a boundary being recorded (red)
    if (window.G5Bounds) {
      for (const fb of G5Bounds.fields()) {
        const visible = (fb.center && near(fb.center.x, fb.center.z)) || fb.polygon.some(q => near(q[0], q[1]));
        if (!visible) continue;
        const pts = fb.polygon.map(q => P(q[0], q[1]));
        pts.push(pts[0]);
        polyline(pts, 'rgba(255, 238, 63, .9)', 3);
      }
      // headland line (dashed orange) while headland automation is armed
      const inner = window.G5Headland && G5Headland.innerLine();
      if (inner) {
        const pts = inner.map(q => P(q[0], q[1]));
        pts.push(pts[0]);
        polyline(pts, 'rgba(255, 160, 30, .95)', 3, [12, 8]);
      }
      // Courseplay Grain Cart position (Machine Sync style marker)
      const gcart = data.grainCart;
      if (gcart && typeof gcart.x === 'number' && near(gcart.x, gcart.z)) {
        const q = P(gcart.x, gcart.z);
        if (q) {
          const r = Math.max(10, Math.min(18, q.s * 2.2));
          ctx.setLineDash([]);
          ctx.fillStyle = '#f2a900'; ctx.strokeStyle = '#1e1e1b'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#1e1e1b'; ctx.font = `700 ${Math.round(r * 1.1)}px "Noto Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('GC', q.x, q.y + 0.5);
        }
      }
      const rp = G5Bounds.path();
      if (rp.length > 1) { polyline(rp.map(q => P(q[0], q[1])), '#ff3b30', 4); }
    }

    // Courseplay field boundary and course (only points near the machine)
    if (course) {
      const lim = Math.max(450, viewR), near = (x, z) => Math.abs(x - C.x) < lim && Math.abs(z - C.z) < lim;
      const fieldPts = (course.field || []).map(q => near(q[0], q[1]) ? P(q[0], q[1]) : null);
      if (fieldPts.length > 1) { fieldPts.push(fieldPts[0]); polyline(fieldPts, 'rgba(255, 238, 63, .9)', 3); }
      const wps = course.waypoints || [];
      const rows = [], links = [];
      for (let i = 1; i < wps.length; i++) {
        const a = wps[i - 1], b = wps[i];
        if (!near(a[0], a[1]) || Math.hypot(b[0] - a[0], b[1] - a[1]) > 60) { rows.push(null); links.push(null); continue; }
        const target = (b[2] & 8) ? links : rows, other = target === rows ? links : rows;
        target.push(P(a[0], a[1]), P(b[0], b[1]), null); other.push(null);
      }
      polyline(rows, 'rgba(110, 220, 235, .8)', 2);
      polyline(links, 'rgba(110, 220, 235, .8)', 2, [10, 8]);
    }

    // guidance tracks
    const t = currentTrack();
    if (t && s) {
      const td = fwdOf(t.h), tn = rightOf(t.h);
      const along = (C.x - t.ax) * td.x + (C.z - t.az) * td.z;
      const kc = V.free ? Math.round(((C.x - t.ax) * tn.x + (C.z - t.az) * tn.z - G.shift) / spacing()) : s.k;
      // zoomed far out the passes would blur into stripes: then only the current track
      const dense = proj.ppm && spacing() * proj.ppm < 8;
      const kn = dense ? 0 : Math.min(150, Math.max(8, Math.ceil(viewR / spacing())));
      const reach = Math.max(900, viewR * 1.5), step = Math.max(20, reach / 60);
      for (let k = dense ? s.k : kc - kn; k <= (dense ? s.k : kc + kn); k++) {
        const o = k * spacing() + G.shift;
        const pts = [];
        for (let a = V.free ? -reach : -60; a <= reach; a += (a > -60 && a < 60 ? 4 : step)) {
          const L = along + a, x = t.ax + td.x * L + tn.x * o, z = t.az + td.z * L + tn.z * o;
          pts.push(P(x, z));
        }
        if (k === s.k) {
          polyline(pts, '#1b1b1b', 7); polyline(pts, '#ffffff', 4);
        } else if (Math.abs(k - s.k) === 1) {
          polyline(pts, '#ffffff', 3, [24, 14]); polyline(pts, 'rgba(0,0,0,.55)', 3, [0, 24, 14, 0]);
        } else {
          polyline(pts, 'rgba(150, 205, 255, .75)', 2);
        }
      }
      $('mapNote').hidden = true;
    } else {
      $('mapNote').hidden = false;
      $('mapNote').textContent = 'No guidance track. Tap Set Track to create one.';
    }

    // implement (green T) and tractor: from the work-area corners when the mod sends them
    const w = pose.width || 0;
    const bars = pose.bars && pose.bars.length ? pose.bars : (w > 0 ? [{ r0: -w / 2, r1: w / 2, f: -7.5 }] : []);
    ctx.strokeStyle = '#2ee82e'; ctx.lineCap = 'butt';
    for (const b of bars) {
      const mid = (b.r0 + b.r1) / 2, hitch = projV(mid * 0.2, b.f < 0 ? -2.2 : 2.6), bar = projV(mid, b.f);
      const l = projV(b.r0, b.f), r = projV(b.r1, b.f);
      if (!hitch || !bar || !l || !r) continue;
      ctx.lineWidth = Math.max(6, 0.45 * bar.s); ctx.beginPath(); ctx.moveTo(hitch.x, hitch.y); ctx.lineTo(bar.x, bar.y); ctx.stroke();
      ctx.lineWidth = Math.max(6, 0.35 * bar.s); ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    }
    drawTractor(projV);
    // zoomed far out the machine is a few pixels: mark it with an arrow
    const m0 = projV(0, 0), m1 = projV(0, 6);
    if (m0 && m1 && Math.hypot(m1.x - m0.x, m1.y - m0.y) < 18) {
      const ux = (m1.x - m0.x), uy = (m1.y - m0.y), L = Math.hypot(ux, uy) || 1, ax = ux / L, ay = uy / L;
      ctx.fillStyle = '#ffd200'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(m0.x + ax * 26, m0.y + ay * 26);
      ctx.lineTo(m0.x - ax * 14 - ay * 16, m0.y - ay * 14 + ax * 16); ctx.lineTo(m0.x - ax * 6, m0.y - ay * 6);
      ctx.lineTo(m0.x - ax * 14 + ay * 16, m0.y - ay * 14 - ax * 16); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    $('mapHdg').textContent = `${cardinal(p.h)} ${Math.round(p.h)}°`;
    // track number and direction from Track 0, as the G5 writes it ("5S", "0" on Track 0)
    $('mapTrk').textContent = s ? `${Math.abs(s.k)}${s.k === 0 ? '' : cardinal((s.k > 0 ? t.h + 90 : t.h - 90))}` : '---';
    $('mapArrow').style.transform = `rotate(${-hf}deg)`;
  }

  // Chevron positions along each recorded pass, recomputed only when new frames arrive.
  let chevCache = { version: -1, list: [] };
  function chevrons(frames) {
    const ver = G5Layers.version();
    if (chevCache.version === ver) return chevCache.list;
    const list = [];
    let pass = null, run = 0, last = null;
    for (const fr of frames) {
      const q = fr.q[0];
      if (!q) continue;
      const cx = (q[4] + q[6]) / 2, cz = (q[5] + q[7]) / 2;          // middle of the leading edge
      if (fr.p !== pass) { pass = fr.p; run = CHEV_STEP / 2; last = null; }
      if (last) run += Math.hypot(cx - last.x, cz - last.z);
      last = { x: cx, z: cz };
      if (run < CHEV_STEP) continue;
      run = 0;
      const w = fr.q.reduce((m, qq) => Math.max(m, Math.hypot(qq[4] - qq[6], qq[5] - qq[7])), 0);
      list.push({ x: cx, z: cz, h: fr.h, w: Math.max(w, 3) });
    }
    chevCache = { version: ver, list };
    return list;
  }

  // AI driver status chip (Courseplay or AutoDrive)
  function renderAi() {
    const cp = pose.cp, ad = pose.ad;
    let name = null, txt = '';
    if (cp && cp.active) {
      name = 'Courseplay';
      const state = cp.waitingForUnload ? 'Waiting for unload' : cp.maneuvering ? 'Turning'
        : cp.drivingToFieldwork ? 'Driving to field' : cp.fieldworkActive ? 'Field work' : 'Active';
      const pct = typeof cp.progress === 'number' ? ` · ${Math.round(cp.progress * 100)}%` : '';
      const turns = cp.course && typeof cp.course.remainingTurns === 'number' ? ` · ${cp.course.remainingTurns} turns left` : '';
      txt = state + pct + turns;
    } else if (ad && ad.active) {
      name = 'AutoDrive';
      const eta = ad.remainingDriveTime > 0 ? ` · ${Math.floor(ad.remainingDriveTime / 60)}:${String(Math.round(ad.remainingDriveTime % 60)).padStart(2, '0')}` : '';
      txt = (ad.destination ? 'To ' + ad.destination : ad.task || 'Driving') + eta;
    }
    $('mapAi').hidden = !name;
    if (name) { $('mapAiName').textContent = name; $('mapAiTxt').textContent = txt; }
  }

  function drawTractor(proj) {
    const c = proj(0, 0);
    if (!c) return;
    const k = Math.max(0.6, c.s / 10);
    const box = (r0, f0, r1, f1, fill) => {
      const a = proj(r0, f0), b = proj(r1, f0), d = proj(r1, f1), e = proj(r0, f1);
      if (!a || !b || !d || !e) return;
      ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0b2a08'; ctx.lineWidth = 2 * k; ctx.stroke();
    };
    box(-1.4, -2.0, -0.7, -0.2, '#1a1a1a'); box(0.7, -2.0, 1.4, -0.2, '#1a1a1a');     // rear tyres
    box(-1.25, 1.2, -0.75, 2.4, '#1a1a1a'); box(0.75, 1.2, 1.25, 2.4, '#1a1a1a');     // front tyres
    box(-0.65, -1.8, 0.65, 2.8, '#3c9a2e');                                            // body
    box(-0.75, -1.4, 0.75, 0.3, '#2f7d25');                                            // cab
    box(-0.55, -1.2, 0.55, 0.1, '#ffd200');                                            // roof accent
  }

  renderSide();
  requestAnimationFrame(draw);
})();

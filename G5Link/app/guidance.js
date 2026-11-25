'use strict';
// G5Link Guidance run page: straight AB tracks, off-track error, lightbar, perspective map.
// Guidance is computed on the display from the vehicle position the mod streams (x, z, heading).
// World convention (matches the mod): north = -Z, heading 0 = north, 90 = east.

(function () {
  const G = Object.assign({ tracks: [], current: -1, spacing: null, shift: 0, incr: 0.0254, zoom: 1, view: '3d' },
    settings.guid || {});
  settings.guid = G;
  const save = () => { settings.guid = G; saveSettings(); };

  const rad = d => d * Math.PI / 180;
  const fwdOf = h => ({ x: Math.sin(rad(h)), z: -Math.cos(rad(h)) });   // unit vector of heading
  const rightOf = h => ({ x: Math.cos(rad(h)), z: Math.sin(rad(h)) });
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinal = h => CARD[Math.round(((h % 360) + 360) % 360 / 45) % 8];

  // ---------------------------------------------------------------- live pose (dead-reckoned between 4 Hz frames)
  const pose = { ok: false, x: 0, z: 0, h: 0, speed: 0, dir: 1, t: 0, width: 0, recording: false, farmland: null, onField: false };
  const trail = [];            // coverage: {x, z, h, w}
  let lastTrail = null;

  window.onTelemetry = d => {
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
    // Coverage trail behind the implement, sampled every ~1.5 m
    if (pose.recording && pose.width > 0) {
      const f = fwdOf(pose.h);
      const p = { x: pose.x - f.x * 7.5, z: pose.z - f.z * 7.5, h: pose.h, w: pose.width };
      if (!lastTrail || Math.hypot(p.x - lastTrail.x, p.z - lastTrail.z) > 1.5) {
        if (lastTrail && Math.hypot(p.x - lastTrail.x, p.z - lastTrail.z) > 30) trail.push(null); // jump: break strip
        trail.push(p); lastTrail = p;
        if (trail.length > 4000) trail.splice(0, trail.length - 4000);
      }
    } else if (lastTrail) { trail.push(null); lastTrail = null; }
    renderSide();
  };

  function livePose() {
    if (!pose.ok) return null;
    const dt = Math.min(0.5, (performance.now() - pose.t) / 1000);
    const f = fwdOf(pose.h), m = pose.speed / 3.6 * dt * pose.dir;
    return { x: pose.x + f.x * m, z: pose.z + f.z * m, h: pose.h };
  }

  // ---------------------------------------------------------------- guidance math
  const spacing = () => G.spacing || pose.width || 12;
  const currentTrack = () => G.tracks[G.current] || null;
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
    if (metric()) return a < 1 ? `${Math.round(a * 100)}<small>cm</small>` : `${a.toFixed(1)}<small>m</small>`;
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
  const lenText = m => metric() ? `${m.toFixed(3)}m` : `${(m * 3.28084).toFixed(3)}ft`;
  function renderSide() {
    const t = currentTrack();
    $('trkName').textContent = t ? t.name : 'No track';
    $('trkSpacing').textContent = lenText(spacing());
    $('trkIncr').textContent = metric() ? `${(G.incr * 100).toFixed(1)} cm` : `${(G.incr / 0.0254).toFixed(1)} in`;
    $('locName').textContent = pose.farmland ? `Farmland ${pose.farmland}` : '---';
    $('mapCrop').textContent = pose.implName || 'Field';
  }

  $('setTrackBtn').onclick = () => { renderTrackList(); openWin('trackWin'); };
  $('spacingBtn').onclick = () => openNumpad(`Track Spacing (${metric() ? 'm' : 'ft'})`, v => {
    G.spacing = metric() ? v : v / 3.28084; save(); renderSide();
  });
  const INCRS = [0.0254, 0.0508, 0.1016, 0.3048, 0.01, 0.05, 0.1];
  $('incrBtn').onclick = () => { G.incr = INCRS[(INCRS.indexOf(G.incr) + 1) % INCRS.length]; save(); renderSide(); };
  document.querySelectorAll('[data-shift]').forEach(b => {
    b.onclick = () => {
      const dirn = +b.dataset.shift;
      if (dirn === 0) {                            // center the nearest track on the vehicle
        const s = solve(livePose());
        if (s) G.shift += s.err;
      } else G.shift += dirn * G.incr;
      save();
    };
  });

  // ---------------------------------------------------------------- track list window
  let pointA = null;
  function addTrack(ax, az, h, how) {
    const n = G.tracks.length + 1;
    G.tracks.push({ name: `Track ${n} (${how})`, ax, az, h: (h + 360) % 360 });
    G.current = G.tracks.length - 1; G.shift = 0; save(); renderTrackList(); renderSide();
  }
  function renderTrackList() {
    setHtml($('trackList'), G.tracks.length ? G.tracks.map((t, i) =>
      `<button class="trk-row ${i === G.current ? 'on' : ''}" data-trk="${i}"><b>${esc(t.name)}</b><span>${cardinal(t.h)} ${t.h.toFixed(1)}°</span></button>`).join('')
      : '<p class="hint">No guidance tracks yet. Create one on the right.</p>');
    $('abStatus').textContent = pointA ? 'Point A set. Drive at least 3 m along the line, then tap Set B.'
      : 'Drive to point A, tap Set A, then drive at least 3 m and tap Set B.';
  }
  $('trackList').onclick = e => { const b = e.target.closest('[data-trk]'); if (b) { G.current = +b.dataset.trk; G.shift = 0; save(); renderTrackList(); renderSide(); } };
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
    if (G.current < 0) return;
    G.tracks.splice(G.current, 1); G.current = G.tracks.length - 1; G.shift = 0; save(); renderTrackList(); renderSide();
  };

  // ---------------------------------------------------------------- map
  const canvas = $('map'), ctx = canvas.getContext('2d');
  document.querySelectorAll('[data-zoom]').forEach(b => {
    b.onclick = () => { G.zoom = Math.min(4, Math.max(0.5, G.zoom * (+b.dataset.zoom > 0 ? 1.4 : 1 / 1.4))); save(); };
  });
  const paintView = () => { $('mapView').textContent = G.view === '3d' ? '2D' : '3D'; };
  $('mapView').onclick = () => { G.view = G.view === '3d' ? '2d' : '3d'; save(); paintView(); };
  paintView();

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * 2 || canvas.height !== h * 2) { canvas.width = w * 2; canvas.height = h * 2; }
    return { W: canvas.width, H: canvas.height };
  }

  // camera: returns a projector from vehicle-local (r = right, f = forward, metres) to canvas px
  function camera(W, H) {
    if (G.view === '2d') {
      const ppm = H / (90 * G.zoom);                       // pixels per metre
      return (r, f) => ({ x: W / 2 + r * ppm, y: H * 0.62 - f * ppm, s: 1 });
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

  function draw() {
    requestAnimationFrame(draw);
    if (!$('map').offsetParent) return;                   // page not visible
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
    const f = fwdOf(p.h), rt = rightOf(p.h);
    const local = (x, z) => { const dx = x - p.x, dz = z - p.z; return { r: dx * rt.x + dz * rt.z, f: dx * f.x + dz * f.z }; };
    const P = (x, z) => { const l = local(x, z); return proj(l.r, l.f); };

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
    const gx0 = Math.floor((p.x - 300) / 20) * 20, gz0 = Math.floor((p.z - 300) / 20) * 20;
    for (let i = 0; i <= 30; i++) {
      const xs = [], zs = [];
      for (let j = 0; j <= 30; j++) { xs.push(P(gx0 + i * 20, gz0 + j * 20)); zs.push(P(gx0 + j * 20, gz0 + i * 20)); }
      polyline(xs, '#d8d2b8', 2); polyline(zs, '#d8d2b8', 2);
    }
    ctx.globalAlpha = 1;

    // coverage
    ctx.fillStyle = 'rgba(64, 128, 214, 0.55)';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (!a || !b) continue;
      const ra = rightOf(a.h), rb = rightOf(b.h);
      const q = [P(a.x - ra.x * a.w / 2, a.z - ra.z * a.w / 2), P(a.x + ra.x * a.w / 2, a.z + ra.z * a.w / 2),
                 P(b.x + rb.x * b.w / 2, b.z + rb.z * b.w / 2), P(b.x - rb.x * b.w / 2, b.z - rb.z * b.w / 2)];
      if (q.some(v => !v)) continue;
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach(v => ctx.lineTo(v.x, v.y)); ctx.closePath(); ctx.fill();
    }

    // guidance tracks
    const t = currentTrack();
    if (t && s) {
      const td = fwdOf(t.h), tn = rightOf(t.h);
      const along = (p.x - t.ax) * td.x + (p.z - t.az) * td.z;
      for (let k = s.k - 8; k <= s.k + 8; k++) {
        const o = k * spacing() + G.shift;
        const pts = [];
        for (let a = -60; a <= 900; a += (a < 60 ? 4 : 20)) {
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

    // implement (green T) and tractor
    const w = pose.width || 0;
    const hitch = proj(0, -2.2), bar = proj(0, -7.5);
    if (w > 0 && hitch && bar) {
      const l = proj(-w / 2, -7.5), r = proj(w / 2, -7.5);
      ctx.strokeStyle = '#2ee82e'; ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(6, 0.45 * bar.s); ctx.beginPath(); ctx.moveTo(hitch.x, hitch.y); ctx.lineTo(bar.x, bar.y); ctx.stroke();
      ctx.lineWidth = Math.max(6, 0.35 * bar.s); ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
    }
    drawTractor(proj);

    $('mapHdg').textContent = `${cardinal(p.h)} ${Math.round(p.h)}°`;
    $('mapTrk').textContent = s ? `${Math.abs(s.k)}${s.k === 0 ? '' : ' ' + cardinal((s.k > 0 ? t.h + 90 : t.h - 90))}` : '---';
    $('mapArrow').style.transform = `rotate(${-p.h}deg)`;
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

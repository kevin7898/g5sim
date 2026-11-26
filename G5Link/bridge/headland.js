'use strict';
// G5Link headland link: hands the mod what it needs to run headland automation (scripts/Headland.lua).
//   headland.xml  settings + the active boundary of the field being worked (rewritten when they change)
//   headcov.xml   ground already worked in the current operation within RADIUS m of the machine
//                 (1 m cells, runs per row), so passes worked first become headland like on the G5
// The mod does the timing itself (every 100 ms), so the bridge's latency doesn't move the lift point.

const fs = require('fs');
const path = require('path');

const RADIUS = 150;          // m of coverage sent around the machine
const COV_MS = 1000;         // at most one coverage write per second
const MOVE_M = 40;           // rewrite coverage after moving this far even if nothing new was worked

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (i === 4) throw e; }   // locked by the game on Windows
  }
}
const num = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : 0);

// Headland width for a field: per-field override, passes x implement width, or the distance setting.
function widthFor(h, fieldId, implWidth) {
  if (fieldId !== null && h.perField && h.perField[fieldId] !== undefined) return h.perField[fieldId];
  if (h.widthMode === 'passes') return implWidth > 0 ? h.passes * implWidth : h.width;
  return h.width;
}

class HeadlandLink {
  constructor({ dir, write = true }) {
    this.dir = dir;
    this.write = write && !!dir;
    this.v = 0; this.key = null;
    this.covV = 0; this.covKey = null; this.covAt = 0; this.covAtPos = null;
    this.status = { armed: false, field: null, width: 0, boundary: false, coverage: 0 };
  }

  // t: latest frame; store: FieldStore; save: savegame; maps: CoverageStore
  update(t, store, save, maps) {
    const h = store.headland(save);
    const v = t && t.vehicle;
    const implWidth = (t && t.implements || []).reduce((m, i) => Math.max(m, i.width || 0), 0);
    let field = null;
    if (v && typeof v.x === 'number') {
      const ws = store.workSetup(save);
      field = ws.fieldMode === 'fixed' && ws.fieldId ? store.list(save).find(f => String(f.id) === String(ws.fieldId)) || null
        : store.fieldAt(save, v.x, v.z);
    }
    const width = widthFor(h, field ? String(field.id) : null, implWidth);
    const poly = field && h.useBoundary ? field.polygon : [];
    const attrs = `armed="${!!h.armed}" field="${field ? field.id : ''}" width="${num(width)}" raiseLead="${num(h.raiseLead)}" ` +
      `lowerLead="${num(h.lowerLead)}" lowerMode="${h.lowerMode}" headSpeed="${num(h.headSpeed, 1)}" workSpeed="${num(h.workSpeed, 1)}" ` +
      `useBoundary="${!!h.useBoundary}" useCoverage="${!!h.useCoverage}"`;
    const key = attrs + '|' + (field ? field.id + ':' + field.v : '') + '|' + poly.length;
    if (key !== this.key) {
      this.key = key; this.v++;
      const pts = poly.map(p => `    <pt x="${num(p[0])}" z="${num(p[1])}"/>`).join('\n');
      if (this.write) {
        try { writeAtomic(path.join(this.dir, 'headland.xml'), `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<headland v="${this.v}" ${attrs}>\n${pts}\n</headland>\n`); }
        catch (e) { console.warn('Could not write headland.xml:', e.message); }
      }
    }
    this.status = { armed: !!h.armed, field: field ? field.id : null, fieldName: field ? field.name : null, width: num(width, 1),
      boundary: poly.length >= 3, coverage: this.status.coverage || 0, v: this.v };
    if (h.armed && h.useCoverage && v && typeof v.x === 'number') this.coverage(v, maps);
    return this.status;
  }

  coverage(v, maps) {
    const now = Date.now();
    if (now - this.covAt < COV_MS) return;
    const op = maps.current ? maps.ops().get(maps.current) : null;
    const moved = !this.covAtPos || Math.hypot(v.x - this.covAtPos[0], v.z - this.covAtPos[1]) > MOVE_M;
    const key = op ? op.id + ':' + op.seq : 'none';
    if (key === this.covKey && !moved) return;
    this.covAt = now; this.covKey = key; this.covAtPos = [v.x, v.z]; this.covV++;
    const rows = op ? op.coveredRowsNear(v.x, v.z, RADIUS) : new Map();
    let runs = 0;
    const lines = [];
    for (const [cz, list] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
      runs += list.length;
      lines.push(`    <r z="${cz}" x="${list.map(r => r[0] + ',' + r[1]).join(',')}"/>`);
    }
    this.status.coverage = runs;
    this.lastCoverage = { op: op ? op.id : null, rows };
    if (this.write) {
      try { writeAtomic(path.join(this.dir, 'headcov.xml'), `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<headcov v="${this.covV}" cell="1" op="${op ? op.id : ''}">\n${lines.join('\n')}\n</headcov>\n`); }
      catch (e) { console.warn('Could not write headcov.xml:', e.message); }
    }
  }
}

module.exports = { HeadlandLink, widthFor };

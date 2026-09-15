// Local persistence: one JSON file per record under the app's data folder.
// Writes are atomic (temp file + rename), so a crash never leaves a torn report.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = { report: 'reports', preferences: 'settings', source: 'settings' };
// Cached network data is only useful for a while; expired entries are pruned at startup.
const RETENTION = { match: 7 * 86400e3, history: 6 * 3600e3, ai: 30 * 86400e3 };

class LocalStore {
  constructor(root) {
    this.root = root;
    for (const dir of ['reports', 'settings', 'cache']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  file(key, kind) {
    const dir = KINDS[kind] || 'cache';
    return path.join(this.root, dir, crypto.createHash('sha256').update(key).digest('hex').slice(0, 40) + '.json');
  }
  locate(key) {
    for (const kind of ['report', 'preferences', 'cache']) {
      const f = this.file(key, kind);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
  record(key) {
    const f = this.locate(key);
    if (!f) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch { return null; } // A damaged cache entry is treated as missing, never as data.
  }
  read(key, maxAge = null) {
    const r = this.record(key);
    if (!r) return null;
    if (maxAge !== null && Date.now() - r.updatedAt >= maxAge) return null;
    return r.payload;
  }
  write(value, key, kind) {
    const f = this.file(key, kind);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ key, kind, updatedAt: Date.now(), payload: value }));
    fs.renameSync(tmp, f);
  }
  reports() {
    const dir = path.join(this.root, 'reports');
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (r.kind === 'report' && r.payload) out.push(r);
      } catch { /* skip unreadable file */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).map(r => r.payload);
  }
  deleteReport(id) {
    const f = this.file(`report:${id}`, 'report');
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  prune(now = Date.now()) {
    const dir = path.join(this.root, 'cache');
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      if (name.endsWith('.tmp')) { fs.rmSync(f, { force: true }); continue; }
      try {
        const r = JSON.parse(fs.readFileSync(f, 'utf8'));
        const limit = RETENTION[r.kind];
        if (limit && now - r.updatedAt > limit) { fs.unlinkSync(f); removed++; }
      } catch { fs.rmSync(f, { force: true }); removed++; }
    }
    return removed;
  }
}

module.exports = { LocalStore };

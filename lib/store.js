'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file store: in-memory maps + debounced atomic writes.
 * Good enough for a hackathon; swap for SQLite/Mongo by keeping this interface.
 */
class Store {
  constructor(file) {
    this.file = file || null;
    this.data = { users: {}, rounds: {} };
    this.timer = null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data.users = this.data.users || {};
        this.data.rounds = this.data.rounds || {};
      } catch (e) {
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.data = { users: {}, rounds: {} };
      }
    }
    this.byToken = new Map();
    this.byName = new Map();
    for (const u of Object.values(this.data.users)) this._index(u);
  }

  _index(u) {
    this.byToken.set(u.token, u.id);
    this.byName.set(u.username.toLowerCase(), u.id);
  }

  getUser(id) { return this.data.users[id] || null; }
  getUserByToken(t) { const id = this.byToken.get(t); return id ? this.data.users[id] : null; }
  getUserByName(n) { const id = this.byName.get(String(n).toLowerCase()); return id ? this.data.users[id] : null; }
  allUsers() { return Object.values(this.data.users); }

  putUser(u) { this.data.users[u.id] = u; this._index(u); this.schedule(); return u; }

  getRound(id) { return this.data.rounds[id] || null; }
  putRound(r) { this.data.rounds[r.id] = r; this.schedule(); return r; }

  prune() {
    const ids = Object.keys(this.data.rounds);
    if (ids.length <= 3000) return;
    const sorted = ids.map((i) => this.data.rounds[i]).sort((a, b) => a.startedAt - b.startedAt);
    for (const r of sorted.slice(0, ids.length - 2000)) {
      if (r.status !== 'active') delete this.data.rounds[r.id];
    }
  }

  schedule() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (!this.file) return;
    this.prune();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };

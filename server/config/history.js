'use strict';
const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../constants');
const { localDayKey, startOfDay } = require('../utils/time');

// Displayed and skipped alerts, plus aggregates that pruning never shrinks: per-day totals and
// per-donor sums. Raw entries are bounded (LIMITS.history); the day and donor maps stay tiny. Writes are
// debounced and atomic (tmp + rename), mirroring the config store.
const KINDS = new Set(['tip', 'sub', 'gift', 'command']);

// Display names are the only identity available for KickBot tips: group case-insensitively, collapse spaces.
function donorKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, LIMITS.name);
}

function safeMap(value) {
  const out = Object.create(null);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) out[key] = entry;
  }
  return out;
}

class HistoryStore {
  constructor(dataDir, { logger } = {}) {
    this.file = path.join(dataDir, 'history.json');
    this.log = logger || (() => {});
    this.entries = [];
    this.days = safeMap();
    this.donors = safeMap();
    this.saveTimer = null;
    this.saveGeneration = 0;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
      this.entries = Array.isArray(raw.entries)
        ? raw.entries.filter(e => e && typeof e === 'object').slice(-LIMITS.history)
        : [];
      this.days = safeMap(raw.days);
      this.donors = safeMap(raw.donors);
    } catch {
      this.entries = [];
      this.days = safeMap();
      this.donors = safeMap();
    }
  }

  reload() {
    ++this.saveGeneration;
    this.load();
  }

  add(rec) {
    const at = Number(rec.at) || Date.now();
    const day = localDayKey(new Date(at));
    const name =
      String(rec.name || '')
        .trim()
        .slice(0, LIMITS.name) || 'ناشناس';
    const entry = {
      id: String(rec.id || '').slice(0, 64),
      name,
      kind: KINDS.has(rec.kind) ? rec.kind : 'tip',
      usd: Math.max(0, Number(rec.usd) || 0),
      currency: /^[A-Za-z]{3}$/.test(String(rec.currency || 'USD'))
        ? String(rec.currency || 'USD').toUpperCase()
        : 'USD',
      source: String(rec.source || 'kickbot').slice(0, 24),
      toman: Math.max(0, Math.round(Number(rec.toman) || 0)),
      count: rec.count != null ? Math.max(1, Math.round(Number(rec.count) || 1)) : null,
      months: rec.months != null ? Math.max(1, Math.round(Number(rec.months) || 1)) : null,
      message: String(rec.message || '').slice(0, LIMITS.message),
      media: rec.media ? String(rec.media).slice(0, LIMITS.fileName) : null,
      rule: String(rec.rule || '').slice(0, 32) || null,
      ruleName: String(rec.ruleName || '').slice(0, LIMITS.ruleName),
      test: !!rec.test,
      replay: !!rec.replay,
      played: rec.played !== false,
      at
    };

    this.entries.push(entry);
    if (this.entries.length > LIMITS.history) this.entries = this.entries.slice(-LIMITS.history);

    // Test/replay traffic stays in the raw list (tagged) but never pollutes totals or leaderboards
    if (entry.played && !entry.test && !entry.replay) {
      const d = this.days[day] || (this.days[day] = { alerts: 0, toman: 0, tips: 0, subs: 0, gifts: 0 });
      d.alerts++;
      d.toman += entry.toman;
      if (entry.kind === 'sub') d.subs++;
      else if (entry.kind === 'gift') d.gifts += entry.count || 1;
      else if (entry.kind === 'tip') d.tips++;

      const key = donorKey(entry.name);
      if (key && entry.toman > 0) {
        const dn = this.donors[key] || (this.donors[key] = { name: entry.name, toman: 0, count: 0, at: 0 });
        dn.name = entry.name; // keep the latest spelling
        dn.toman += entry.toman;
        dn.count++;
        dn.at = at;
      }
    }

    this.debouncedSave();
    return { day, entry };
  }

  day(day) {
    return this.days[day] || { alerts: 0, toman: 0, tips: 0, subs: 0, gifts: 0 };
  }

  totals() {
    let toman = 0,
      alerts = 0,
      subs = 0,
      gifts = 0;
    for (const d of Object.values(this.days)) {
      toman += Number(d.toman) || 0;
      alerts += Number(d.alerts) || 0;
      subs += Number(d.subs) || 0;
      gifts += Number(d.gifts) || 0;
    }
    return { toman, alerts, subs, gifts };
  }

  // Newest first; `day` filters to one local calendar day
  getEntries({ limit = 100, day: dayKey = null } = {}) {
    let list = this.entries;
    if (dayKey) list = list.filter(e => localDayKey(new Date(e.at)) === dayKey);
    const n = Math.min(1000, Math.max(1, Math.round(Number(limit) || 100)));
    return list.slice(-n).reverse();
  }

  getDays(limit = 30) {
    const n = Math.min(365, Math.max(1, Math.round(Number(limit) || 30)));
    return Object.keys(this.days)
      .sort()
      .reverse()
      .slice(0, n)
      .map(date => ({ date, ...this.day(date) }));
  }

  // All-time comes from the never-pruned donor map; daily/weekly from the retained entries window
  getTop(range = 'all', limit = 10) {
    const n = Math.min(50, Math.max(1, Math.round(Number(limit) || 10)));
    if (range !== 'daily' && range !== 'weekly') {
      return Object.values(this.donors)
        .sort((a, b) => b.toman - a.toman || b.count - a.count)
        .slice(0, n)
        .map((d, i) => ({ rank: i + 1, name: d.name, toman: d.toman, count: d.count }));
    }
    const days = range === 'daily' ? 1 : 7;
    const cutoff = startOfDay(Date.now() - (days - 1) * 86400000);
    const map = new Map();
    for (const e of this.entries) {
      if (e.played === false || e.test || e.replay || e.toman <= 0 || e.at < cutoff) continue;
      const key = donorKey(e.name);
      if (!key) continue;
      const d = map.get(key) || { name: e.name, toman: 0, count: 0 };
      map.set(key, d);
      d.name = e.name;
      d.toman += e.toman;
      d.count++;
    }
    return Array.from(map.values())
      .sort((a, b) => b.toman - a.toman || b.count - a.count)
      .slice(0, n)
      .map((d, i) => ({ rank: i + 1, ...d }));
  }

  clear() {
    ++this.saveGeneration;
    this.entries = [];
    this.days = safeMap();
    this.donors = safeMap();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } catch (e) {
      this.log('warn', 'پاک کردن history.json ناموفق بود', e.message);
    }
  }

  toJSON() {
    return { v: 1, entries: this.entries.slice(-LIMITS.history), days: this.days, donors: this.donors };
  }

  saveSync() {
    ++this.saveGeneration;
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.toJSON()));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log('error', 'ذخیره‌ی history.json ناموفق بود', e.message);
    }
  }

  async saveAsync() {
    const generation = ++this.saveGeneration;
    const tmp = this.file + '.' + generation + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(this.toJSON()), 'utf8');
      if (generation === this.saveGeneration) fs.renameSync(tmp, this.file);
      else await fs.promises.unlink(tmp);
    } catch (e) {
      this.log('error', 'ذخیره‌ی async history.json ناموفق بود', e.message);
      try {
        await fs.promises.unlink(tmp);
      } catch {}
    }
  }

  debouncedSave(delayMs = 500) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveAsync();
    }, delayMs);
  }

  stop() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saveSync();
    }
  }
}

module.exports = {
  HistoryStore,
  donorKey
};

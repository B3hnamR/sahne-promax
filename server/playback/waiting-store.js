'use strict';
const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../constants');
const { cleanText, finite, httpsUrl } = require('../utils/validation');

const LIMIT = 500;

// Only paid, provider-owned alerts that may not be sent again belong on disk.
function normalizeWaiting(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t) || t.is_test) return null;
  const id = String(t.stripe_pi_id || '');
  const source = t.source || (t.is_local && ['sub', 'gift'].includes(t.kind) ? 'kick' : 'kickbot');
  const captured = source === 'kickbot' && t.captured === true && !t.is_local && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const se = source === 'streamelements' && t.is_local === true && /^se_[A-Za-z0-9_-]{1,64}$/.test(id);
  const kick =
    source === 'kick' &&
    t.is_local === true &&
    ['sub', 'gift'].includes(t.kind) &&
    /^(sub|gift)_[a-f0-9]{12}$/.test(id);
  const donofa = source === 'donofa' && t.is_local === true && /^donofa_[A-Za-z0-9_-]{1,64}$/.test(id);
  if (!captured && !se && !kick && !donofa) return null;
  const kind = kick ? t.kind : 'tip';
  return {
    stripe_pi_id: id,
    tipper_name: cleanText(t.tipper_name, LIMITS.name),
    tip_message: cleanText(t.tip_message, LIMITS.message),
    amount_total: finite(t.amount_total, 0, 1e14, 0),
    currency: /^[A-Z]{3}$/.test(String(t.currency || '')) ? t.currency : donofa ? 'IRT' : 'USD',
    approval_status: 'approved',
    source,
    kind,
    is_local: !captured,
    captured,
    count: kick ? finite(t.count, 1, 1e6, 1) : null,
    months: kick && t.months != null ? finite(t.months, 1, 240, 1) : null,
    tags: kick ? (kind === 'gift' ? ['giftsub', 'gift', 'sub'] : ['sub', 'newsub']) : [],
    toman_override: !captured && t.toman_override != null ? finite(t.toman_override, 0, 1e12, 0) : null,
    gif_url: captured ? httpsUrl(t.gif_url) : null,
    audio_url: captured || donofa ? httpsUrl(t.audio_url) : null,
    created_at: typeof t.created_at === 'string' ? cleanText(t.created_at, 64) : undefined
  };
}

class WaitingStore {
  constructor(dataDir, playedStore, logger) {
    this.file = path.join(dataDir, 'waiting-alerts.json');
    this.playedStore = playedStore;
    this.logger = logger;
    this.saved = null;
    this.stopped = false;
    this.overflowWarned = false;
  }

  load() {
    let rows = [];
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) rows = data;
    } catch {}
    const seen = new Set();
    const restored = [];
    for (const raw of rows.slice(0, LIMIT)) {
      const tip = normalizeWaiting(raw);
      if (!tip || seen.has(tip.stripe_pi_id) || this.playedStore.isPlayed(tip.stripe_pi_id)) continue;
      seen.add(tip.stripe_pi_id);
      restored.push(tip);
    }
    this.save(restored);
    return restored;
  }

  save(queue) {
    if (this.stopped) return;
    const list = queue.map(normalizeWaiting).filter(Boolean);
    if (list.length > LIMIT && !this.overflowWarned)
      this.logger.warn('Only the first 500 waiting alerts can survive a restart');
    this.overflowWarned = list.length > LIMIT;
    const serialized = JSON.stringify(list.slice(0, LIMIT));
    if (serialized === this.saved) return;
    try {
      if (list.length) {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, serialized);
        fs.renameSync(tmp, this.file);
      } else fs.rmSync(this.file, { force: true });
      this.saved = serialized;
    } catch (e) {
      this.logger.warn('Could not save waiting alerts', e.message);
    }
  }

  clear() {
    this.stopped = true;
    for (const file of [this.file, this.file + '.tmp']) {
      try {
        fs.rmSync(file, { force: true });
      } catch {}
    }
  }
}

module.exports = { WaitingStore, normalizeWaiting };

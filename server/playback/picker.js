'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normFa, cleanText, httpsUrl } = require('../utils/validation');
const { LIMITS } = require('../constants');

function rand(a) {
  return a[crypto.randomInt(a.length)];
}

function pickMedia(t, { config, mediaDir, currentRate }) {
  const usd = (t.amount_total || 0) / 100;
  const rate = currentRate();
  const toman = t.toman_override != null ? Number(t.toman_override) : rate ? usd * rate : null;
  const msg = normFa(t.tip_message);
  const tags = (t.tags || []).map(x => normFa(x));
  const files = config.files.filter(f => f.enabled !== false && fs.existsSync(path.join(mediaDir, f.file)));

  // Sub months filtering for renewals
  const months = t.months != null ? Number(t.months) : null;
  const count = t.count != null ? Number(t.count) : null;

  const minT = f => (f.minToman != null ? Number(f.minToman) : rate ? (Number(f.minAmount) || 0) * rate : 0);
  const maxT = f =>
    f.maxToman != null ? Number(f.maxToman) : rate && f.maxAmount != null ? Number(f.maxAmount) * rate : null;
  const value = toman != null ? toman : usd;

  const inRange = f => {
    // Milestone filters
    if (months != null && f.minMonths != null && months < f.minMonths) return false;
    if (months != null && f.maxMonths != null && months > f.maxMonths) return false;
    if (count != null && f.minCount != null && count < f.minCount) return false;
    if (count != null && f.maxCount != null && count > f.maxCount) return false;

    return value >= (toman != null ? minT(f) : Number(f.minAmount) || 0) && (maxT(f) == null || value <= maxT(f));
  };

  const kw = files.filter(
    f =>
      inRange(f) &&
      (f.keywords || []).some(k => {
        const n = normFa(k);
        return n && (msg.includes(n) || tags.includes(n));
      })
  );
  if (kw.length) return rand(kw);
  if (toman == null) return null;

  const noKw = files.filter(f => inRange(f) && !(f.keywords || []).length);
  if (!noKw.length) return null;
  const top = Math.max(...noKw.map(minT));
  return rand(noKw.filter(f => minT(f) === top));
}

function buildPayload(t, media, { mediaDir, currentRate, tomanOf }) {
  let pairedAudioUrl = null;
  if (media && media.audioFile && fs.existsSync(path.join(mediaDir, media.audioFile))) {
    pairedAudioUrl = '/media/' + encodeURIComponent(media.audioFile);
  }

  return {
    id: t.stripe_pi_id,
    name: cleanText(t.tipper_name, LIMITS.name) || 'ناشناس',
    amount: (t.amount_total || 0) / 100,
    toman: t.toman_override != null ? t.toman_override : tomanOf((t.amount_total || 0) / 100),
    rate: currentRate(),
    kind: t.kind || 'tip',
    count: t.count || null,
    months: t.months || null,
    message: cleanText(t.tip_message, LIMITS.message),
    gif_url: httpsUrl(t.gif_url),
    tts_url: httpsUrl(t.audio_url),
    is_test: !!t.is_test,
    media: media
      ? {
          url: '/media/' + encodeURIComponent(media.file),
          type: media.type,
          volume: media.volume ?? 100,
          duration: media.duration || null,
          cardDelay: media.cardDelay ?? null,
          name: media.name,
          audio_url: pairedAudioUrl
        }
      : null
  };
}

module.exports = {
  pickMedia,
  buildPayload,
  rand
};

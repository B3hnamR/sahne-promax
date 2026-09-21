'use strict';
const path = require('path');
const crypto = require('crypto');
const { LIMITS, ENUMS, FONTS, TYPES } = require('../constants');
const { typeOf, cleanText, parseThreshold, finite, intOrNull, isHex } = require('./validation');

function sanitizeFile(f) {
  if (!f || typeof f !== 'object') return null;
  const file = path.basename(String(f.file || ''));
  if (!file || file !== String(f.file) || !typeOf(file)) return null;
  const kw = Array.isArray(f.keywords)
    ? f.keywords
        .map(k => cleanText(k, LIMITS.keyword).trim())
        .filter(Boolean)
        .slice(0, LIMITS.keywords)
    : [];

  let audioFile = null;
  if (f.audioFile) {
    const af = path.basename(String(f.audioFile));
    if (af === String(f.audioFile) && typeOf(af) === 'audio') {
      audioFile = af;
    }
  }

  return {
    id: /^[0-9a-f]{10}$/.test(String(f.id)) ? f.id : crypto.randomBytes(5).toString('hex'),
    file,
    name: cleanText(f.name || path.basename(file, path.extname(file)), LIMITS.name).trim() || file,
    type: typeOf(file),
    audioFile,
    enabled: f.enabled !== false,
    minToman: intOrNull(f.minToman, 0, 1e12) ?? (f.minToman === undefined ? parseThreshold(f.name || file) : null),
    maxToman: intOrNull(f.maxToman, 0, 1e12),
    minAmount: finite(f.minAmount, 0, 1e9, 0),
    maxAmount: intOrNull(f.maxAmount, 0, 1e9),
    minMonths: intOrNull(f.minMonths, 1, 120),
    maxMonths: intOrNull(f.maxMonths, 1, 120),
    minCount: intOrNull(f.minCount, 1, 1000),
    maxCount: intOrNull(f.maxCount, 1, 1000),
    keywords: kw,
    volume: finite(f.volume, 0, 100, 100),
    duration: intOrNull(f.duration, 1, 3600),
    // seconds before the name/amount card (and TTS) appears for this file; null = use the appearance setting
    cardDelay:
      f.cardDelay === null || f.cardDelay === undefined || f.cardDelay === ''
        ? null
        : Math.round(finite(f.cardDelay, 0, 60, 0) * 10) / 10,
    size: finite(f.size, 0, 1e13, 0)
  };
}

function sanitizeAppearance(a, current = {}) {
  const cur = current || {};
  const out = { ...cur };
  if (!a || typeof a !== 'object') return out;
  const num = (k, min, max, dflt) => {
    if (k in a) out[k] = finite(a[k], min, max, cur[k] !== undefined ? cur[k] : dflt);
  };
  const bool = (k, dflt) => {
    if (k in a) out[k] = !!a[k];
    else if (out[k] === undefined) out[k] = dflt;
  };
  const str = (k, max, dflt) => {
    if (k in a) out[k] = cleanText(a[k], max);
    else if (out[k] === undefined) out[k] = dflt;
  };
  const col = (k, dflt) => {
    if (k in a && isHex(a[k])) out[k] = String(a[k]).toLowerCase();
    else if (out[k] === undefined) out[k] = dflt;
  };
  const en = (k, dflt) => {
    if (k in a && ENUMS[k] && ENUMS[k].includes(a[k])) out[k] = a[k];
    else if (out[k] === undefined) out[k] = dflt;
  };

  if ('font' in a) out.font = FONTS.includes(a.font) ? a.font : cur.font || 'Vazirmatn';
  num('textSize', 10, 120, 34);
  num('bgOpacity', 0, 1, 0.6);
  num('borderOpacity', 0, 1, 0.1);
  num('width', 200, 1920, 720);
  num('radius', 0, 120, 26);
  num('cardX', 0, 100, 50);
  num('cardY', 0, 100, 82);
  num('cardScale', 0.2, 3, 1);
  num('padY', 0, 120, 26);
  num('padX', 0, 160, 34);
  num('mediaMaxHeight', 10, 100, 55);
  num('imageDuration', 1, 600, 8);
  num('minDuration', 1, 600, 6);
  num('maxDuration', 2, 3600, 90);
  num('cardDelay', 0, 60, 0);
  out.cardDelay = Math.round((Number(out.cardDelay) || 0) * 10) / 10;
  num('volume', 0, 100, 80);
  num('ttsVolume', 0, 100, 70);

  ['nameColor', 'textColor', 'accent', 'bgColor', 'headlineColor', 'borderColor'].forEach(k =>
    col(k, cur[k] || '#ffffff')
  );
  ['showLine', 'showGlow', 'showBorder', 'showGloss', 'shadow', 'showMessage', 'showAmount', 'persianDigits'].forEach(
    k => bool(k, true)
  );
  ['template', 'giftTemplate', 'subTemplate'].forEach(k => str(k, 200, ''));
  const ENUM_DEFAULTS = {
    mediaMode: 'full',
    mediaFit: 'cover',
    amountStyle: 'pill',
    animation: 'pop',
    currency: 'toman'
  };
  ['mediaMode', 'mediaFit', 'amountStyle', 'animation', 'currency'].forEach(k => en(k, ENUM_DEFAULTS[k]));

  if (out.maxDuration < out.minDuration) out.maxDuration = out.minDuration;
  return out;
}

function sanitizeGoal(g, current = {}) {
  const cur = current || {};
  const out = { ...cur };
  if (!g || typeof g !== 'object') return out;
  if ('enabled' in g) out.enabled = !!g.enabled;
  if ('title' in g) out.title = cleanText(g.title, LIMITS.goalTitle).trim() || 'هدف حمایت استریم';
  if ('targetToman' in g) out.targetToman = finite(g.targetToman, 1000, 1e12, cur.targetToman || 5000000);
  if ('currentToman' in g) out.currentToman = finite(g.currentToman, 0, 1e12, cur.currentToman || 0);
  if ('autoIncrement' in g) out.autoIncrement = !!g.autoIncrement;
  if ('unit' in g && ['toman', 'usd'].includes(g.unit)) out.unit = g.unit;
  if ('color' in g && isHex(g.color)) out.color = String(g.color).toLowerCase();
  if ('bgColor' in g && isHex(g.bgColor)) out.bgColor = String(g.bgColor).toLowerCase();
  return out;
}

module.exports = {
  sanitizeFile,
  sanitizeAppearance,
  sanitizeGoal
};

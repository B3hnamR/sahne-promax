'use strict';
const path = require('path');
const crypto = require('crypto');
const { LIMITS, ENUMS, FONTS, TYPES } = require('../constants');
const { typeOf, cleanText, parseThreshold, finite, intOrNull, isHex, normFa } = require('./validation');

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
  ['template', 'giftTemplate', 'subTemplate', 'commandTemplate'].forEach(k => str(k, 200, ''));
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

  // Timed goal: deadline is epoch ms; '' or null clears it
  if ('mode' in g && ENUMS.goalMode.includes(g.mode)) out.mode = g.mode;
  if ('deadline' in g) {
    out.deadline =
      g.deadline === null || g.deadline === undefined || g.deadline === '' ? null : intOrNull(g.deadline, 1, 4e12);
  }

  // Milestone confetti settings and internal celebration/day state
  if ('milestoneToman' in g) out.milestoneToman = finite(g.milestoneToman, 0, 1e12, cur.milestoneToman || 0);
  if ('confettiOnComplete' in g) out.confettiOnComplete = !!g.confettiOnComplete;
  if ('confettiOnFirstSub' in g) out.confettiOnFirstSub = !!g.confettiOnFirstSub;
  if ('completedCelebrated' in g) out.completedCelebrated = !!g.completedCelebrated;
  if ('subsDay' in g) out.subsDay = /^\d{4}-\d{2}-\d{2}$/.test(String(g.subsDay || '')) ? g.subsDay : null;

  // Live counters (subs / gift-subs / subs today) shown on the goal widget
  if ('showCounters' in g) out.showCounters = !!g.showCounters;
  if ('subCount' in g) out.subCount = Math.round(finite(g.subCount, 0, 1e9, cur.subCount || 0));
  if ('giftSubCount' in g) out.giftSubCount = Math.round(finite(g.giftSubCount, 0, 1e9, cur.giftSubCount || 0));
  if ('giftCount' in g) out.giftCount = Math.round(finite(g.giftCount, 0, 1e9, cur.giftCount || 0));
  if ('subsToday' in g) out.subsToday = Math.round(finite(g.subsToday, 0, 1e9, cur.subsToday || 0));
  return out;
}

// Chat commands: entries map a chat token to a registered alert file (fileId). Stale references are dropped.
function sanitizeChatCommands(c, current = {}, files = []) {
  const cur = current || {};
  const out = { ...cur };
  if (!c || typeof c !== 'object') return out;
  if ('enabled' in c) out.enabled = !!c.enabled;
  if ('prefix' in c) {
    const p = String(c.prefix == null ? '' : c.prefix)
      .trim()
      .slice(0, 3);
    out.prefix = /^[!$#%./?@+~-]{1,3}$/.test(p) ? p : cur.prefix || '!';
  }
  if ('globalCooldownSec' in c) out.globalCooldownSec = finite(c.globalCooldownSec, 0, 600, cur.globalCooldownSec ?? 5);
  if ('userCooldownSec' in c) out.userCooldownSec = finite(c.userCooldownSec, 0, 3600, cur.userCooldownSec ?? 30);
  if ('maxPerMinute' in c) out.maxPerMinute = Math.round(finite(c.maxPerMinute, 1, 120, cur.maxPerMinute ?? 10));
  if (Array.isArray(c.entries)) {
    const ids = new Set((Array.isArray(files) ? files : []).map(f => f.id));
    const seen = new Set();
    out.entries = c.entries
      .map(e => {
        if (!e || typeof e !== 'object') return null;
        const command = String(e.command == null ? '' : e.command)
          .trim()
          .toLowerCase()
          .slice(0, LIMITS.command);
        if (!/^[a-z0-9_-]{1,31}$/.test(command)) return null;
        if (seen.has(command)) return null;
        seen.add(command);
        const fileId = String(e.fileId == null ? '' : e.fileId);
        if (!ids.has(fileId)) return null; // orphaned reference (file deleted)
        return { command, fileId, enabled: e.enabled !== false };
      })
      .filter(Boolean)
      .slice(0, LIMITS.commands);
  }
  return out;
}

const RULE_PROVIDERS = new Set(['kickbot', 'streamelements', 'kick']);
const RULE_KINDS = new Set(['tip', 'sub', 'gift']);

function ruleEnumList(value, allowed) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v == null ? '' : v).toLowerCase()).filter(v => allowed.has(v)))];
}

function ruleNumber(value, lo, hi) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Returns a sanitized rule, or null when the rule is malformed or self-contradictory.
function sanitizeRule(item) {
  if (!item || typeof item !== 'object') return null;
  const c = item.conditions && typeof item.conditions === 'object' ? item.conditions : {};
  const fileId = String(item.fileId == null ? '' : item.fileId);
  if (!/^[0-9a-f]{10}$/.test(fileId)) return null;
  const providers = ruleEnumList(c.providers, RULE_PROVIDERS);
  const kinds = ruleEnumList(c.kinds, RULE_KINDS);
  const currency = /^[A-Za-z]{3}$/.test(String(c.currency || '')) ? String(c.currency).toUpperCase() : null;
  const minToman = ruleNumber(c.minToman, 0, 1e12);
  const maxToman = ruleNumber(c.maxToman, 0, 1e12);
  const minMonths = ruleNumber(c.minMonths, 1, 240);
  const maxMonths = ruleNumber(c.maxMonths, 1, 240);
  const minCount = ruleNumber(c.minCount, 1, 1000);
  const maxCount = ruleNumber(c.maxCount, 1, 1000);
  if (minToman != null && maxToman != null && minToman > maxToman) return null;
  if (minMonths != null && maxMonths != null && minMonths > maxMonths) return null;
  if (minCount != null && maxCount != null && minCount > maxCount) return null;
  if ((minMonths != null || maxMonths != null) && (minCount != null || maxCount != null)) return null;
  return {
    id: /^[0-9a-f]{10}$/.test(String(item.id || '')) ? item.id : crypto.randomBytes(5).toString('hex'),
    name: cleanText(item.name, LIMITS.ruleName).trim(),
    enabled: item.enabled !== false,
    conditions: {
      providers,
      kinds,
      currency,
      minToman,
      maxToman,
      messageContains: normFa(cleanText(c.messageContains, LIMITS.ruleMessage)).slice(0, LIMITS.ruleMessage),
      minMonths,
      maxMonths,
      minCount,
      maxCount
    },
    fileId
  };
}

// Alert routing rules: fixed condition fields only (no regex/JS), capped and bounded.
// Unknown but well-formed fileIds are kept so deleted files stay visible and flagged.
function sanitizeRules(r, current = {}, files = []) {
  const cur = current || {};
  const out = { ...cur };
  if (!r || typeof r !== 'object') return out;
  if ('enabled' in r) out.enabled = !!r.enabled;
  out.v = 1;
  if (!Array.isArray(r.items)) return out;
  out.items = r.items.map(sanitizeRule).filter(Boolean).slice(0, LIMITS.rules);
  return out;
}

module.exports = {
  sanitizeFile,
  sanitizeAppearance,
  sanitizeGoal,
  sanitizeChatCommands,
  sanitizeRule,
  sanitizeRules
};

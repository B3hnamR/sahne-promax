'use strict';
const fs = require('fs');
const path = require('path');
const { pickMedia } = require('./picker');

function isFileUsable(file, mediaDir) {
  return !!(file && file.enabled !== false && file.file && fs.existsSync(path.join(mediaDir, file.file)));
}

// Returns the codes of every populated condition the facts fail (empty = all match).
function conditionReasons(rule, facts) {
  const c = rule.conditions || {};
  const reasons = [];
  if (c.providers && c.providers.length && !c.providers.includes(facts.provider)) reasons.push('provider');
  if (c.kinds && c.kinds.length && !c.kinds.includes(facts.kind)) reasons.push('kind');
  if (c.currency && facts.currency !== c.currency) reasons.push('currency');
  if (c.minToman != null || c.maxToman != null) {
    if (facts.toman == null) reasons.push('amount-missing');
    else if (c.minToman != null && facts.toman < c.minToman) reasons.push('amount-range');
    else if (c.maxToman != null && facts.toman > c.maxToman) reasons.push('amount-range');
  }
  if (c.messageContains && !String(facts.message || '').includes(c.messageContains)) reasons.push('message');
  if (c.minMonths != null || c.maxMonths != null) {
    if (facts.kind !== 'sub') reasons.push('months');
    else if (c.minMonths != null && (facts.months == null || facts.months < c.minMonths)) reasons.push('months');
    else if (c.maxMonths != null && (facts.months == null || facts.months > c.maxMonths)) reasons.push('months');
  }
  if (c.minCount != null || c.maxCount != null) {
    if (facts.kind !== 'gift') reasons.push('count');
    else if (c.minCount != null && (facts.count == null || facts.count < c.minCount)) reasons.push('count');
    else if (c.maxCount != null && (facts.count == null || facts.count > c.maxCount)) reasons.push('count');
  }
  return reasons;
}

function evaluateRules(t, facts, { config, mediaDir }) {
  const rules = config && config.alertRules;
  if (!rules || !rules.enabled || !Array.isArray(rules.items) || !rules.items.length) return [];
  return rules.items.map(rule => {
    if (!rule || rule.enabled === false)
      return { ruleId: rule && rule.id, name: rule && rule.name, matched: false, reasons: ['disabled'] };
    const reasons = conditionReasons(rule, facts);
    if (reasons.length) return { ruleId: rule.id, name: rule.name, matched: false, reasons };
    const file = (config.files || []).find(f => f.id === rule.fileId);
    if (!file) return { ruleId: rule.id, name: rule.name, matched: true, reasons: ['file-missing'] };
    if (!isFileUsable(file, mediaDir))
      return { ruleId: rule.id, name: rule.name, matched: true, reasons: ['file-disabled'] };
    return { ruleId: rule.id, name: rule.name, matched: true, reasons: ['matched'] };
  });
}

function resolveMedia(t, facts, { config, mediaDir, currentRate, replayFileId = null, logger = null }) {
  const picker = source => ({
    media: pickMedia(t, { config, mediaDir, currentRate }),
    source,
    ruleId: null,
    ruleName: null
  });
  try {
    if (t && t.commandFileId) return picker('command');
    if (replayFileId) {
      const original = (config.files || []).find(f => f.id === replayFileId);
      if (isFileUsable(original, mediaDir)) return { media: original, source: 'replay', ruleId: null, ruleName: null };
    }
    const rules = config.alertRules;
    if (rules && rules.enabled && Array.isArray(rules.items)) {
      for (const rule of rules.items) {
        if (!rule || rule.enabled === false) continue;
        if (conditionReasons(rule, facts).length) continue;
        const file = (config.files || []).find(f => f.id === rule.fileId);
        if (isFileUsable(file, mediaDir))
          return { media: file, source: 'rule', ruleId: rule.id, ruleName: rule.name || '' };
      }
    }
  } catch (error) {
    // A malformed rule must never stop playback: fall through to the picker.
    if (logger && typeof logger.warn === 'function') logger.warn('ارزیابی قواعد رسانه ناموفق بود', error.message);
  }
  return picker('picker');
}

module.exports = { isFileUsable, evaluateRules, resolveMedia };

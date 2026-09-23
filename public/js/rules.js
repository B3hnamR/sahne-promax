// Sahne ProMax — Alert media routing rules page.
'use strict';

import { $, $$, esc, post, put, toast } from './api.js';
import { state } from './state.js';

let availability = {};

const num = v => (v === '' || v == null ? null : Number(v));
const text = v => String(v == null ? '' : v).trim();

function collectRules() {
  const items = $$('.rule-row').map(row => {
    const get = sel => row.querySelector(sel);
    const providers = get('.rule-provider').value ? [get('.rule-provider').value] : [];
    const kinds = get('.rule-kind').value ? [get('.rule-kind').value] : [];
    return {
      id: row.dataset.id || undefined,
      name: text(get('.rule-name').value).slice(0, 40),
      enabled: !!get('.rule-enabled').checked,
      conditions: {
        providers,
        kinds,
        currency: get('.rule-currency').value ? get('.rule-currency').value.toUpperCase() : null,
        minToman: num(get('.rule-min-toman').value),
        maxToman: num(get('.rule-max-toman').value),
        messageContains: text(get('.rule-message').value),
        minMonths: num(get('.rule-months').value),
        maxMonths: null,
        minCount: num(get('.rule-count').value),
        maxCount: null
      },
      fileId: get('.rule-file').value
    };
  });
  return { enabled: !!$('#rulesEnabled').checked, items };
}

function ruleRow(rule) {
  const row = document.createElement('div');
  row.className = 'rule-row card';
  row.dataset.id = rule && rule.id ? rule.id : '';
  const files = (state.cfg && state.cfg.files) || [];
  const options = files
    .map(f => `<option value="${esc(f.id)}" ${rule && rule.fileId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`)
    .join('');
  const status = rule && rule.fileId ? availability[rule.fileId] : null;
  const badge =
    status === 'missing'
      ? '<span class="chip warn">فایل پیدا نشد</span>'
      : status === 'disabled'
        ? '<span class="chip warn">فایل غیرفعال</span>'
        : '';
  row.innerHTML =
    '<div class="row" style="gap:8px;align-items:center">' +
    `<label class="switch"><input type="checkbox" class="rule-enabled" ${!rule || rule.enabled !== false ? 'checked' : ''}><span></span></label>` +
    `<input type="text" class="rule-name ltr" style="flex:1" maxlength="40" placeholder="نام قاعده" value="${esc(rule ? rule.name : '')}">` +
    badge +
    '<button class="btn icon rule-up" title="بالا">▲</button>' +
    '<button class="btn icon rule-down" title="پایین">▼</button>' +
    '<button class="btn icon danger rule-del" title="حذف">✕</button>' +
    '</div>' +
    '<div class="grid" style="margin-top:10px">' +
    '<div class="field"><label>ارائه‌دهنده</label><select class="rule-provider">' +
    '<option value="">همه</option>' +
    `<option value="kickbot" ${rule && rule.conditions.providers.includes('kickbot') ? 'selected' : ''}>KickBot</option>` +
    `<option value="streamelements" ${rule && rule.conditions.providers.includes('streamelements') ? 'selected' : ''}>StreamElements</option>` +
    `<option value="kick" ${rule && rule.conditions.providers.includes('kick') ? 'selected' : ''}>Kick</option>` +
    '</select></div>' +
    '<div class="field"><label>نوع</label><select class="rule-kind">' +
    '<option value="">همه</option>' +
    `<option value="tip" ${rule && rule.conditions.kinds.includes('tip') ? 'selected' : ''}>دونیت</option>` +
    `<option value="sub" ${rule && rule.conditions.kinds.includes('sub') ? 'selected' : ''}>ساب</option>` +
    `<option value="gift" ${rule && rule.conditions.kinds.includes('gift') ? 'selected' : ''}>ساب‌گیفت</option>` +
    '</select></div>' +
    `<div class="field"><label>ارز</label><input type="text" class="rule-currency ltr" maxlength="3" placeholder="EUR" value="${esc(rule && rule.conditions.currency ? rule.conditions.currency : '')}"></div>` +
    `<div class="field"><label>حداقل تومان</label><input type="number" class="rule-min-toman ltr" min="0" value="${rule && rule.conditions.minToman != null ? rule.conditions.minToman : ''}"></div>` +
    `<div class="field"><label>حداکثر تومان</label><input type="number" class="rule-max-toman ltr" min="0" value="${rule && rule.conditions.maxToman != null ? rule.conditions.maxToman : ''}"></div>` +
    `<div class="field"><label>متن پیام شامل</label><input type="text" class="rule-message" maxlength="100" value="${esc(rule ? rule.conditions.messageContains : '')}"></div>` +
    `<div class="field"><label>حداقل ماه ساب</label><input type="number" class="rule-months ltr" min="1" max="240" value="${rule && rule.conditions.minMonths != null ? rule.conditions.minMonths : ''}"></div>` +
    `<div class="field"><label>حداقل تعداد گیفت</label><input type="number" class="rule-count ltr" min="1" max="1000" value="${rule && rule.conditions.minCount != null ? rule.conditions.minCount : ''}"></div>` +
    `<div class="field"><label>فایل</label><select class="rule-file"><option value="">— انتخاب فایل —</option>${options}</select></div>` +
    '</div>' +
    '<p class="hint">قاعده‌ی انتخاب‌شده بر پله‌ها و کلمات کلیدی همان فایل اولویت دارد؛ ترتیب قواعد مهم است (اولین تطابق برنده است).</p>';
  return row;
}

function renderRules() {
  const box = $('#rulesList');
  if (!box) return;
  box.innerHTML = '';
  const rules = (state.cfg && state.cfg.alertRules) || { items: [] };
  for (const rule of rules.items || []) box.appendChild(ruleRow(rule));
}

async function refreshAvailability() {
  try {
    const r = await fetch('/api/rules');
    const j = await r.json();
    availability = (j && j.availability) || {};
  } catch {
    availability = {};
  }
}

function updateCount() {
  const n = $$('.rule-row').length;
  if ($('#rulesCount')) $('#rulesCount').textContent = n ? String(n) : '—';
}

export async function fillRules() {
  await refreshAvailability();
  if ($('#rulesEnabled'))
    $('#rulesEnabled').checked = !!(state.cfg && state.cfg.alertRules && state.cfg.alertRules.enabled);
  renderRules();
  updateCount();
}

export function initRules() {
  if ($('#btnAddRule'))
    $('#btnAddRule').onclick = () => {
      $('#rulesList').appendChild(ruleRow(null));
      updateCount();
    };
  if ($('#rulesList'))
    $('#rulesList').addEventListener('click', e => {
      const row = e.target.closest('.rule-row');
      if (!row) return;
      if (e.target.closest('.rule-del')) {
        row.remove();
        updateCount();
      } else if (e.target.closest('.rule-up') && row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
      } else if (e.target.closest('.rule-down') && row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
      }
    });
  if ($('#btnSaveRules'))
    $('#btnSaveRules').onclick = async () => {
      const r = await put('/api/rules', collectRules());
      if (r && r.ok) {
        if (state.cfg) state.cfg.alertRules = { v: 1, enabled: r.rules.enabled, items: r.rules.items };
        await fillRules();
        toast('قواعد رسانه ذخیره شد', 'ok');
      } else {
        toast((r && r.error) || 'ذخیره قواعد ناموفق بود', 'err');
      }
    };
  if ($('#btnRuleTest'))
    $('#btnRuleTest').onclick = async () => {
      const body = {
        provider: $('#rtProvider').value,
        kind: $('#rtKind').value,
        currency: $('#rtCurrency').value,
        amount: Number($('#rtAmount').value) || 0,
        message: $('#rtMessage').value,
        months: Number($('#rtMonths').value) || null,
        count: Number($('#rtCount').value) || null
      };
      const r = await post('/api/rules/test', body);
      const out = $('#rtResult');
      if (!r || !r.ok) {
        if (out) out.textContent = 'آزمایش ناموفق بود';
        return;
      }
      const match = r.match;
      if (out)
        out.textContent = match
          ? `نتیجه: ${match.source === 'rule' ? 'قاعده' : 'انتخابگر پیش‌فرض'} — ${match.fileName || match.file}${match.ruleName ? ' (' + match.ruleName + ')' : ''}`
          : 'فایلی برای پخش پیدا نشد';
      if (match && $('#btnRulePreview')) $('#btnRulePreview').dataset.fileId = match.fileId;
    };
  if ($('#btnRulePreview'))
    $('#btnRulePreview').onclick = () => {
      const fileId = $('#btnRulePreview').dataset.fileId;
      if (!fileId) return;
      post('/api/preview', {
        fileId,
        name: $('#rtName') ? $('#rtName').value : 'Tester',
        amount: Number($('#rtAmount').value) || 0,
        message: $('#rtMessage').value
      });
    };
}

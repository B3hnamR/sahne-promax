// Sahne ProMax — Alert media routing rules page.
'use strict';

import { $, $$, esc, post, put, toast } from './api.js';
import { state } from './state.js';

let availability = {};

const REASON_LABELS = {
  disabled: 'قاعده غیرفعال است',
  provider: 'ارائه‌دهنده متفاوت است',
  kind: 'نوع رویداد متفاوت است',
  currency: 'ارز متفاوت است',
  'amount-missing': 'نرخ تبدیل در دسترس نیست',
  'amount-range': 'مبلغ خارج از محدوده است',
  message: 'متن پیام تطابق ندارد',
  months: 'شرط ماه ساب برقرار نیست',
  count: 'شرط تعداد گیفت برقرار نیست',
  'file-missing': 'فایل پیدا نشد',
  'file-disabled': 'فایل غیرفعال است',
  matched: 'منطبق'
};

function reasonLabel(reasons) {
  return (Array.isArray(reasons) ? reasons : []).map(r => REASON_LABELS[r] || r).join('، ');
}

let rendered = false;
let simulationRevision = 0;
let previewEvent = null;
let tipProvider = 'kickbot';
let tipCurrency = 'USD';

const num = v => (v === '' || v == null ? null : Number(v));
const text = v => String(v == null ? '' : v).trim();
const checkedValues = (row, selector) =>
  [...row.querySelectorAll(selector)].filter(input => input.checked).map(input => input.value);

function invalidatePreview() {
  simulationRevision++;
  previewEvent = null;
  const button = $('#btnRulePreview');
  if (button) {
    button.disabled = true;
    delete button.dataset.fileId;
  }
}

function simulationInput() {
  return {
    provider: $('#rtProvider').value,
    kind: $('#rtKind').value,
    currency: $('#rtCurrency').value,
    amount: Number($('#rtAmount').value) || 0,
    name: $('#rtName').value,
    message: $('#rtMessage').value,
    months: Number($('#rtMonths').value) || null,
    count: Number($('#rtCount').value) || null
  };
}

function syncSimulationKind() {
  const kind = $('#rtKind').value;
  const local = kind !== 'tip';
  const wasLocal = $('#rtProvider').disabled;
  if (local) {
    if (!wasLocal) {
      tipProvider = $('#rtProvider').value;
      tipCurrency = $('#rtCurrency').value;
    }
    $('#rtProvider').value = 'kick';
    $('#rtCurrency').value = 'USD';
  } else if (wasLocal) {
    $('#rtProvider').value = tipProvider;
    $('#rtCurrency').value = tipCurrency;
  }
  $('#rtProvider').disabled = local;
  $('#rtCurrency').disabled = local;
  $('#rtAmount').disabled = local;
  $('#rtMonths').disabled = kind !== 'sub';
  $('#rtCount').disabled = kind !== 'gift';
}

function collectRules() {
  const items = $$('.rule-row').map(row => {
    const get = sel => row.querySelector(sel);
    const providers = checkedValues(row, '.rule-provider');
    const kinds = checkedValues(row, '.rule-kind');
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
        maxMonths: num(get('.rule-max-months').value),
        minCount: num(get('.rule-count').value),
        maxCount: num(get('.rule-max-count').value)
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
  const knownFile = rule && files.some(f => f.id === rule.fileId);
  const missingOption =
    rule && rule.fileId && !knownFile
      ? `<option value="${esc(rule.fileId)}" selected>فایل حذف‌شده (${esc(rule.fileId)})</option>`
      : '';
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
  const checkGroup = (cls, choices, selected) =>
    choices
      .map(
        ([value, label]) =>
          `<label class="chip"><input type="checkbox" class="${cls}" value="${value}" ${selected.includes(value) ? 'checked' : ''}> ${label}</label>`
      )
      .join('');
  const conditions = (rule && rule.conditions) || {};
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
    '<div class="field"><label>ارائه‌دهنده‌ها (هیچ‌کدام = همه)</label><div class="row" style="flex-wrap:wrap;gap:6px">' +
    checkGroup(
      'rule-provider',
      [
        ['kickbot', 'KickBot'],
        ['streamelements', 'StreamElements'],
        ['kick', 'Kick']
      ],
      conditions.providers || []
    ) +
    '</div></div>' +
    '<div class="field"><label>نوع رویداد (هیچ‌کدام = همه)</label><div class="row" style="flex-wrap:wrap;gap:6px">' +
    checkGroup(
      'rule-kind',
      [
        ['tip', 'دونیت'],
        ['sub', 'ساب'],
        ['gift', 'ساب‌گیفت']
      ],
      conditions.kinds || []
    ) +
    '</div></div>' +
    `<div class="field"><label>ارز</label><input type="text" class="rule-currency ltr" maxlength="3" placeholder="EUR" value="${esc(rule && rule.conditions.currency ? rule.conditions.currency : '')}"></div>` +
    `<div class="field"><label>حداقل تومان</label><input type="number" class="rule-min-toman ltr" min="0" value="${rule && rule.conditions.minToman != null ? rule.conditions.minToman : ''}"></div>` +
    `<div class="field"><label>حداکثر تومان</label><input type="number" class="rule-max-toman ltr" min="0" value="${rule && rule.conditions.maxToman != null ? rule.conditions.maxToman : ''}"></div>` +
    `<div class="field"><label>متن پیام شامل</label><input type="text" class="rule-message" maxlength="100" value="${esc(rule ? rule.conditions.messageContains : '')}"></div>` +
    `<div class="field"><label>حداقل ماه ساب</label><input type="number" class="rule-months ltr" min="1" max="240" value="${rule && rule.conditions.minMonths != null ? rule.conditions.minMonths : ''}"></div>` +
    `<div class="field"><label>حداکثر ماه ساب</label><input type="number" class="rule-max-months ltr" min="1" max="240" value="${rule && rule.conditions.maxMonths != null ? rule.conditions.maxMonths : ''}"></div>` +
    `<div class="field"><label>حداقل تعداد گیفت</label><input type="number" class="rule-count ltr" min="1" max="1000" value="${rule && rule.conditions.minCount != null ? rule.conditions.minCount : ''}"></div>` +
    `<div class="field"><label>حداکثر تعداد گیفت</label><input type="number" class="rule-max-count ltr" min="1" max="1000" value="${rule && rule.conditions.maxCount != null ? rule.conditions.maxCount : ''}"></div>` +
    `<div class="field"><label>فایل</label><select class="rule-file"><option value="">— انتخاب فایل —</option>${missingOption}${options}</select></div>` +
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
  rendered = true;
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
  rendered = false;
  invalidatePreview();
  await refreshAvailability();
  if ($('#rulesEnabled'))
    $('#rulesEnabled').checked = !!(state.cfg && state.cfg.alertRules && state.cfg.alertRules.enabled);
  renderRules();
  updateCount();
}

export function initRules() {
  syncSimulationKind();
  invalidatePreview();
  for (const selector of [
    '#rtProvider',
    '#rtKind',
    '#rtCurrency',
    '#rtAmount',
    '#rtName',
    '#rtMessage',
    '#rtMonths',
    '#rtCount'
  ]) {
    const input = $(selector);
    if (!input) continue;
    input.addEventListener('input', invalidatePreview);
    input.addEventListener('change', () => {
      if (selector === '#rtKind') syncSimulationKind();
      invalidatePreview();
    });
  }
  if ($('#rulesEnabled')) $('#rulesEnabled').addEventListener('change', invalidatePreview);
  if ($('#btnAddRule'))
    $('#btnAddRule').onclick = () => {
      $('#rulesList').appendChild(ruleRow(null));
      updateCount();
      invalidatePreview();
    };
  if ($('#rulesList')) $('#rulesList').addEventListener('input', invalidatePreview);
  if ($('#rulesList')) $('#rulesList').addEventListener('change', invalidatePreview);
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
      invalidatePreview();
    });
  if ($('#btnSaveRules'))
    $('#btnSaveRules').onclick = async () => {
      if (!rendered || !state.cfg) {
        toast('قواعد هنوز بارگذاری نشده‌اند؛ دوباره تلاش کنید', 'err');
        return;
      }
      invalidatePreview();
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
      invalidatePreview();
      const revision = simulationRevision;
      const body = simulationInput();
      let r;
      try {
        r = await post('/api/rules/test', body);
      } catch {
        r = null;
      }
      if (revision !== simulationRevision) return;
      const out = $('#rtResult');
      if (!r || !r.ok) {
        if (out) out.textContent = 'آزمایش ناموفق بود';
        return;
      }
      const match = r.match;
      if (out) {
        out.textContent = '';
        const verdict = document.createElement('div');
        verdict.textContent = match
          ? `نتیجه: ${match.source === 'rule' ? 'قاعده' : 'انتخابگر پیش‌فرض'} — ${match.fileName || match.file}${match.ruleName ? ' (' + match.ruleName + ')' : ''}`
          : 'فایلی برای پخش پیدا نشد';
        out.appendChild(verdict);
        for (const ev of r.evaluations || []) {
          const line = document.createElement('div');
          line.className = 'hint';
          const fileBlocked = ev.reasons.includes('file-missing') || ev.reasons.includes('file-disabled');
          const stateText = ev.matched ? (fileBlocked ? 'منطبق، ولی فایل در دسترس نیست' : 'منطبق') : 'نامنطبق';
          line.textContent = `${ev.name || ev.ruleId}: ${stateText} — ${reasonLabel(ev.reasons)}`;
          out.appendChild(line);
        }
      }
      if (match && $('#btnRulePreview')) {
        previewEvent = body;
        $('#btnRulePreview').dataset.fileId = match.fileId;
        $('#btnRulePreview').disabled = false;
      }
    };
  if ($('#btnRulePreview'))
    $('#btnRulePreview').onclick = () => {
      const fileId = $('#btnRulePreview').dataset.fileId;
      if (!fileId || !previewEvent || $('#btnRulePreview').disabled) return;
      post('/api/preview', { ...previewEvent, fileId })
        .then(result => {
          if (!result || !result.ok) toast('پیش‌نمایش ناموفق بود', 'err');
        })
        .catch(() => toast('پیش‌نمایش ناموفق بود', 'err'));
    };
}

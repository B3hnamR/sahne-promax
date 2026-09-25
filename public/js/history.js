// Sahne ProMax — Alert history, daily totals and top donors (2.3.0).
// Donor names are UNTRUSTED: every row is built with textContent, never innerHTML.
'use strict';

import { $, toast, copyText, faNum, fmtToman } from './api.js';

let cache = null;

const KIND_CHIP = {
  tip: { label: 'دونیت', cls: '' },
  sub: { label: '⭐ ساب', cls: '' },
  gift: { label: '🎁 ساب‌گیفت', cls: '' },
  command: { label: '⌨️ دستور', cls: 'acc' }
};

function shortTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function dayLabel(key) {
  try {
    return new Date(String(key) + 'T00:00:00').toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
  } catch {
    return String(key);
  }
}

function row(children) {
  const d = document.createElement('div');
  d.className = 'hrow';
  for (const c of children) if (c) d.appendChild(c);
  return d;
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function chip(label, extra) {
  const c = document.createElement('span');
  c.className = 'chip' + (extra ? ' ' + extra : '');
  c.textContent = label;
  return c;
}

export function initHistory() {
  const topUrl = 'http://localhost:' + (window.location.port || 7788) + '/top?range=all&limit=5';
  if ($('#hTopUrl')) $('#hTopUrl').value = topUrl;
  if ($('#btnCopyTopUrl')) {
    $('#btnCopyTopUrl').onclick = () => {
      copyText(topUrl);
      toast('لینک ویجت برترین‌ها کپی شد', 'ok');
    };
  }
  if ($('#btnHistoryRefresh')) $('#btnHistoryRefresh').onclick = () => refreshHistory(true);
  if ($('#hTopRange')) $('#hTopRange').onchange = loadTop;
}

export async function refreshHistory(notify) {
  try {
    const r = await fetch('/api/history?limit=200');
    cache = await r.json();
    renderSummary();
    renderEntries();
    renderDays();
    loadTop();
    if (notify) toast('تاریخچه به‌روز شد', 'ok');
  } catch {
    if (notify) toast('دریافت تاریخچه ناموفق بود', 'err');
  }
}

// Live patch from the admin SSE stream: today's numbers update instantly, lists on the next open/refresh
export function renderHistoryLive(d) {
  if (!cache || !d) return;
  if (d.dayTotals) cache.today = d.dayTotals;
  if (d.totals) cache.totals = d.totals;
  renderSummary();
}

function summaryTo(elId, metaId, toman, alerts, extra) {
  if ($(elId)) $(elId).textContent = fmtToman(toman || 0);
  if ($(metaId)) {
    const bits = [faNum(alerts || 0) + ' الرت'];
    if (extra) bits.push(extra);
    $(metaId).textContent = bits.join(' · ');
  }
}

function renderSummary() {
  if (!cache) return;
  summaryTo('#hTodayToman', '#hTodayMeta', cache.today && cache.today.toman, cache.today && cache.today.alerts, null);
  const week = (cache.days || []).slice(0, 7);
  const weekToman = week.reduce((s, d) => s + (Number(d.toman) || 0), 0);
  const weekAlerts = week.reduce((s, d) => s + (Number(d.alerts) || 0), 0);
  summaryTo('#hWeekToman', '#hWeekMeta', weekToman, weekAlerts, null);
  const t = cache.totals || {};
  summaryTo(
    '#hTotalToman',
    '#hTotalMeta',
    t.toman,
    t.alerts,
    faNum(t.subs || 0) + ' ساب · ' + faNum(t.gifts || 0) + ' ساب‌گیفت'
  );
}

function renderEntries() {
  const box = $('#hEntries');
  if (!box || !cache) return;
  box.innerHTML = '';
  const list = cache.entries || [];
  if (!list.length) {
    const p = document.createElement('span');
    p.className = 'hint';
    p.textContent = 'هنوز الرتی نمایش داده نشده';
    box.appendChild(p);
    return;
  }
  for (const e of list.slice(0, 120)) {
    const k = KIND_CHIP[e.kind] || KIND_CHIP.tip;
    const currency = String(e.currency || 'USD').toUpperCase();
    const original =
      e.usd == null && currency === 'USD'
        ? '—'
        : currency === 'USD'
          ? '$' + (Number(e.usd) || 0)
          : currency === 'IRT'
            ? fmtToman(e.toman || e.usd)
            : (Number(e.usd) || 0) + ' ' + currency;
    const amount =
      e.kind === 'command'
        ? 'دستور چت'
        : Number(e.toman) > 0 && currency !== 'IRT'
          ? fmtToman(e.toman) + ' · ' + original
          : original;
    const source =
      e.source === 'streamelements'
        ? 'StreamElements'
        : e.source === 'kickbot'
          ? 'KickBot'
          : e.source === 'kick'
            ? 'Kick'
            : e.source === 'donofa'
              ? 'Donofa'
              : '';
    const rowEl = row([
      span('t', shortTime(e.at)),
      span('n', e.name || 'ناشناس'),
      chip(k.label, k.cls),
      source ? chip(source) : null,
      e.test ? chip('تست', 'warn') : e.replay ? chip('ریپلی') : null,
      e.played === false ? chip('نمایش داده نشد', 'warn') : null,
      e.ruleName ? chip(e.ruleName, 'acc') : null,
      span('m', e.message || ''),
      span('a', amount)
    ]);
    box.appendChild(rowEl);
  }
}

function renderDays() {
  const box = $('#hDays');
  if (!box || !cache) return;
  box.innerHTML = '';
  const days = (cache.days || []).filter(d => d.alerts > 0).slice(0, 14);
  if (!days.length) {
    const p = document.createElement('span');
    p.className = 'hint';
    p.textContent = 'جمع روزانه‌ای ثبت نشده';
    box.appendChild(p);
    return;
  }
  for (const d of days) {
    box.appendChild(
      row([
        span('t', dayLabel(d.date)),
        span('m', faNum(d.alerts) + ' الرت · ' + faNum(d.subs || 0) + ' ساب · ' + faNum(d.gifts || 0) + ' گیفت'),
        span('a', fmtToman(d.toman || 0))
      ])
    );
  }
}

async function loadTop() {
  const box = $('#hTop');
  if (!box) return;
  const range = $('#hTopRange') ? $('#hTopRange').value : 'all';
  try {
    const r = await fetch('/api/top?range=' + encodeURIComponent(range) + '&limit=10');
    const j = await r.json();
    box.innerHTML = '';
    const list = j.donors || [];
    if (!list.length) {
      const p = document.createElement('span');
      p.className = 'hint';
      p.textContent = 'هنوز حمایتی ثبت نشده';
      box.appendChild(p);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    for (const d of list) {
      box.appendChild(
        row([
          span('t', medals[d.rank - 1] || faNum(d.rank)),
          span('n', d.name || 'ناشناس'),
          span('m', faNum(d.count || 0) + ' حمایت'),
          span('a', fmtToman(d.toman || 0))
        ])
      );
    }
  } catch {}
}

// Sahne ProMax — API Client and UI utilities
'use strict';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const DESK = !!(window.sahne && window.sahne.desktop);

export const api = (p, opt) => fetch(p, opt).then(r => r.json());
export const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
export const patch = (p, body) =>
  api(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let toastT;
export function toast(m, kind) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2000);
}

export function spConfirm({
  title = 'تایید عملیات',
  body = 'آیا مطمئن هستید؟',
  confirmText = 'تایید',
  cancelText = 'انصراف',
  icon = '#i-power',
  danger = true
} = {}) {
  return new Promise(resolve => {
    const m = $('#confirmModal');
    if (!m) return resolve(window.confirm(body));
    const titleEl = $('#confirmTitle');
    const bodyEl = $('#confirmBody');
    const okBtn = $('#confirmOk');
    const cancelBtn = $('#confirmCancel');
    const iconBox = $('#confirmIcon');
    const iconUse = $('#confirmIcon use');

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (iconUse) iconUse.setAttribute('href', icon);
    if (iconBox) iconBox.className = 'modal-icon ' + (danger ? 'danger' : 'primary');
    if (okBtn) {
      okBtn.textContent = confirmText;
      okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;

    m.classList.add('show');

    function cleanup(res) {
      m.classList.remove('show');
      if (okBtn) okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      m.onclick = null;
      window.removeEventListener('keydown', onKey);
      resolve(res);
    }

    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    }

    if (okBtn) okBtn.onclick = () => cleanup(true);
    if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
    m.onclick = e => {
      if (e.target === m) cleanup(false);
    };
    window.addEventListener('keydown', onKey);
  });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export const faNum = n => Number(n || 0).toLocaleString('fa-IR');

export function fmtToman(t) {
  t = Number(t);
  if (!t) return 'بدون مبلغ';
  if (t >= 1e6) return faNum(+(t / 1e6).toFixed(2)) + ' میلیون';
  if (t >= 1e3) return faNum(+(t / 1e3).toFixed(1)) + ' هزار';
  return faNum(t) + ' تومان';
}

export function fmtSize(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b > 1024 && i < 3) {
    b /= 1024;
    i++;
  }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function copyText(t) {
  if (DESK && window.sahne.app.copy) return window.sahne.app.copy(t);
  return navigator.clipboard.writeText(t);
}

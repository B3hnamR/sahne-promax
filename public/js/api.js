// Sahne ProMax — API Client and UI utilities
'use strict';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const DESK = !!(window.sahne && window.sahne.desktop);

export const api = (p, opt) => fetch(p, opt).then(r => r.json());
export const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
export const patch = (p, body) => settingsRequest(p, body, 'PATCH');
export const put = (p, body) =>
  api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

export const SETTINGS_SAVE_ERROR = 'تنظیمات ذخیره نشد؛ دوباره تلاش کنید';
export async function settingsRequest(p, body, method = 'POST') {
  try {
    const response = await fetch(p, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const result = await response.json();
    if (!response.ok || result?.ok !== true)
      return { ok: false, error: result?.error || SETTINGS_SAVE_ERROR, code: result?.code };
    return result;
  } catch {
    return { ok: false, error: SETTINGS_SAVE_ERROR };
  }
}

export async function saveSettings(body) {
  const result = await settingsRequest('/api/config', body);
  if (!result.ok) toast(result.error, 'err');
  return result.ok;
}

let toastT;
export function toast(m, kind) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2000);
}

let pendingConfirm = null;

export function spConfirm({
  title = 'تایید عملیات',
  body = 'آیا مطمئن هستید؟',
  confirmText = 'تایید',
  cancelText = 'انصراف',
  icon = '#i-power',
  danger = true
} = {}) {
  if (pendingConfirm)
    return pendingConfirm.then(() => spConfirm({ title, body, confirmText, cancelText, icon, danger }));
  const m = $('#confirmModal');
  if (!m) return Promise.resolve(window.confirm(body));
  pendingConfirm = new Promise(resolve => {
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

    const previousFocus = document.activeElement;
    m.hidden = false;
    // Native modal dialogs make the rest of the document inert, including to AT.
    if (typeof m.showModal === 'function') m.showModal();
    m.classList.add('show');
    // Put keyboard focus on the safe choice. Native button keyboard handling then
    // gives Enter the same result as clicking the focused button.
    if (cancelBtn) cancelBtn.focus();

    let settled = false;
    function cleanup(res) {
      if (settled) return;
      settled = true;
      m.classList.remove('show');
      if (typeof m.close === 'function') m.close();
      m.hidden = true;
      if (okBtn) okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      m.onclick = null;
      m.oncancel = null;
      window.removeEventListener('keydown', onKey);
      pendingConfirm = null;
      if (previousFocus && previousFocus.isConnected !== false && typeof previousFocus.focus === 'function')
        previousFocus.focus();
      resolve(res);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Tab') {
        const buttons = [cancelBtn, okBtn].filter(button => button && !button.disabled);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (first && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    }

    if (okBtn) okBtn.onclick = () => cleanup(true);
    if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
    m.onclick = e => {
      if (e.target === m) cleanup(false);
    };
    m.oncancel = e => {
      e.preventDefault();
      cleanup(false);
    };
    window.addEventListener('keydown', onKey);
  });
  return pendingConfirm;
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

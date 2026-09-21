// Sahne ProMax — Alert Appearance & Live Canvas
'use strict';

import { $, $$, post, toast } from './api.js';
import { state } from './state.js';

const lbl = {
  textSize: 'lblSize',
  bgOpacity: 'lblOp',
  width: 'lblW',
  mediaMaxHeight: 'lblMH',
  volume: 'lblVol',
  ttsVolume: 'lblTts',
  cardScale: 'lblCS',
  radius: 'lblR',
  borderOpacity: 'lblBO',
  padY: 'lblPY',
  padX: 'lblPX'
};

const LOOK_DEFAULTS = {
  giftTemplate: '{name} {count} تا ساب گیفت داد 🎁 {amount}',
  subTemplate: '{name} ساب شد ⭐ {amount}',
  commandTemplate: '{name} دستور چت داد 🎮',
  mediaMode: 'full',
  mediaFit: 'cover',
  cardX: 50,
  cardY: 82,
  cardScale: 1,
  cardDelay: 0,
  radius: 26,
  amountStyle: 'pill',
  showLine: true,
  showGlow: true,
  showBorder: true,
  headlineColor: '#ffffff',
  borderColor: '#ffffff',
  borderOpacity: 0.1,
  padY: 26,
  padX: 34
};

let saveT;

export function fillLook() {
  const app = state.cfg.appearance;
  for (const k in LOOK_DEFAULTS) {
    if (app[k] === undefined) app[k] = LOOK_DEFAULTS[k];
  }
  $$('[data-a]').forEach(el => {
    const k = el.dataset.a;
    const v = app[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
    if (lbl[k] && $('#' + lbl[k])) $('#' + lbl[k]).textContent = v;
  });
}

export function setA(k, v) {
  state.cfg.appearance[k] = v;
  const el = document.querySelector(`[data-a="${k}"]`);
  if (el) {
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  if (lbl[k] && $('#' + lbl[k])) $('#' + lbl[k]).textContent = v;
}

export function saveLook() {
  clearTimeout(saveT);
  saveT = setTimeout(() => post('/api/config', { appearance: state.cfg.appearance }), 250);
}

export function fitPreview() {
  const pw = $('#pw');
  const pv = $('#pv');
  if (pw && pv && pw.clientWidth) {
    pv.style.transform = `scale(${pw.clientWidth / 1920})`;
  }
}

export function initLook() {
  $$('[data-a]').forEach(el =>
    el.addEventListener('input', () => {
      const k = el.dataset.a;
      const v =
        el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
      state.cfg.appearance[k] = v;
      if (lbl[k] && $('#' + lbl[k])) $('#' + lbl[k]).textContent = v;
      saveLook();
    })
  );

  $('#btnPreview').onclick = () =>
    post('/api/preview', { name: $('#pvName').value, amount: $('#pvAmount').value, message: $('#pvMsg').value });

  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type !== 'cardpos') return;
    setA('cardX', d.x);
    setA('cardY', d.y);
    if (d.final) saveLook();
  });

  $$('[data-pos]').forEach(
    b =>
      (b.onclick = () => {
        const [x, y] = b.dataset.pos.split(',').map(Number);
        setA('cardX', x);
        setA('cardY', y);
        saveLook();
      })
  );

  const PRESETS = {
    gold: {
      font: 'Segoe UI',
      textSize: 40,
      template: '{name} tip {amount}',
      currency: 'eq-en',
      persianDigits: false,
      amountStyle: 'inherit',
      showAmount: true,
      showMessage: true,
      headlineColor: '#f7c948',
      nameColor: '#f7c948',
      accent: '#f7c948',
      textColor: '#ffffff',
      bgColor: '#070707',
      bgOpacity: 0.55,
      radius: 14,
      borderColor: '#f7c948',
      borderOpacity: 0.45,
      showLine: false,
      showGlow: false,
      showBorder: true,
      shadow: true,
      showGloss: false,
      width: 1000,
      padY: 16,
      padX: 30
    },
    dark: {
      font: 'Vazirmatn',
      textSize: 34,
      template: '{name} با {amount} حمایت کرد',
      currency: 'eq-fa',
      persianDigits: true,
      amountStyle: 'soft',
      showAmount: true,
      showMessage: true,
      headlineColor: '#ffffff',
      nameColor: '#8ab4ff',
      accent: '#8ab4ff',
      textColor: '#c9d1e3',
      bgColor: '#0d1014',
      bgOpacity: 0.88,
      radius: 18,
      borderColor: '#ffffff',
      borderOpacity: 0.12,
      showLine: false,
      showGlow: false,
      showBorder: true,
      shadow: true,
      showGloss: true,
      width: 780,
      padY: 18,
      padX: 28
    },
    green: {
      font: 'Vazirmatn',
      textSize: 34,
      template: '{name} با {amount} حمایت کرد',
      currency: 'toman',
      persianDigits: true,
      amountStyle: 'pill',
      showAmount: true,
      showMessage: true,
      headlineColor: '#ffffff',
      nameColor: '#53fc18',
      accent: '#53fc18',
      textColor: '#ffffff',
      bgColor: '#0b0f0c',
      bgOpacity: 0.6,
      radius: 26,
      borderColor: '#ffffff',
      borderOpacity: 0.1,
      showLine: true,
      showGlow: true,
      showBorder: true,
      shadow: true,
      showGloss: false,
      width: 720,
      padY: 26,
      padX: 34
    }
  };

  $$('[data-preset]').forEach(
    b =>
      (b.onclick = () => {
        const p = PRESETS[b.dataset.preset];
        for (const k in p) setA(k, p[k]);
        saveLook();
        toast('پریست اعمال شد', 'ok');
      })
  );

  initCanvasDrag();
  window.addEventListener('resize', fitPreview);
}

function initCanvasDrag() {
  const pw = $('#pw');
  const pv = $('#pv');
  if (!pw || !pv) return;

  let drag = null;
  const scale = () => pw.clientWidth / 1920;
  const inner = e => {
    const r = pw.getBoundingClientRect();
    return [(e.clientX - r.left) / scale(), (e.clientY - r.top) / scale()];
  };

  const setVars = () => {
    try {
      const st = pv.contentDocument.documentElement.style;
      st.setProperty('--cardX', state.cfg.appearance.cardX);
      st.setProperty('--cardY', state.cfg.appearance.cardY);
    } catch {}
  };

  pw.addEventListener('pointerdown', e => {
    const [ix, iy] = inner(e);
    let hit = null;
    try {
      hit = pv.contentDocument.elementFromPoint(ix, iy);
    } catch {}
    if (!hit || !hit.closest('.card')) return;
    e.preventDefault();
    pw.setPointerCapture(e.pointerId);
    pw.classList.add('dragging');
    drag = {
      sx: e.clientX,
      sy: e.clientY,
      x: Number(state.cfg.appearance.cardX ?? 50),
      y: Number(state.cfg.appearance.cardY ?? 82)
    };
  });

  pw.addEventListener('pointermove', e => {
    if (!drag) return;
    let x = drag.x + ((e.clientX - drag.sx) / scale() / 1920) * 100;
    let y = drag.y + ((e.clientY - drag.sy) / scale() / 1080) * 100;
    if (e.shiftKey) {
      if (Math.abs(x - 50) < 2) x = 50;
      if (Math.abs(y - 50) < 2) y = 50;
    }
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    setA('cardX', +x.toFixed(2));
    setA('cardY', +y.toFixed(2));
    setVars();
  });

  const up = () => {
    if (!drag) return;
    drag = null;
    pw.classList.remove('dragging');
    saveLook();
  };

  pw.addEventListener('pointerup', up);
  pw.addEventListener('pointercancel', up);
}

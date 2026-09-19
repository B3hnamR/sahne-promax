// Sahne ProMax — Navigation and Window Controls
'use strict';

import { $, $$, DESK, toast } from './api.js';

export function initNav({ onPageChange }) {
  if (DESK) {
    $('#wMin').onclick = () => window.sahne.win.minimize();
    $('#wMax').onclick = () => window.sahne.win.toggleMax();
    $('#wClose').onclick = () => window.sahne.win.close();
    $('#chrome').addEventListener('dblclick', e => {
      if (e.target.closest('.win-controls')) return;
      window.sahne.win.toggleMax();
    });
  }

  $('#btnExit').onclick = async () => {
    if (!DESK) {
      toast('در نسخه‌ی مرورگر خروج معنی نداره');
      return;
    }
    if (confirm('برنامه کاملاً بسته می‌شه و تا باز شدن دوباره، هیچ آلرتی روی استریم نمایش داده نمی‌شه. مطمئنی؟')) {
      window.sahne.app.quit();
    }
  };

  const capsule = $('#capsule');
  function moveCapsule(btn) {
    if (!btn || !capsule) return;
    capsule.style.opacity = 1;
    capsule.style.transform = `translateY(${btn.offsetTop}px)`;
    capsule.style.height = btn.offsetHeight + 'px';
  }

  window.goPage = function (name) {
    $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === name));
    moveCapsule($(`.nav button[data-page="${name}"]`));
    try {
      localStorage.setItem('sp.page', name);
    } catch {}
    if (typeof onPageChange === 'function') {
      onPageChange(name);
    }
  };

  $$('.nav button').forEach(b => (b.onclick = () => window.goPage(b.dataset.page)));
  window.addEventListener('resize', () => moveCapsule($('.nav button.active')));
}

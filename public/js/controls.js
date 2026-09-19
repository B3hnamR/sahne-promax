// Sahne ProMax — Hardware & Stream Deck REST Control Bindings
'use strict';

import { $, post, toast, spConfirm } from './api.js';

export function initControls({ onStateChange }) {
  if ($('#btnSkip')) {
    $('#btnSkip').onclick = async () => {
      const r = await post('/api/control/skip');
      if (r.skipped) toast('آلرت رد شد', 'ok');
      else toast('آلرتی در حال پخش نیست');
    };
  }

  if ($('#btnReplay')) {
    $('#btnReplay').onclick = async () => {
      const r = await post('/api/control/replay');
      if (r.replayed) toast('پخش مجدد آخرین آلرت', 'ok');
      else toast('آلرت قبلی برای پخش مجدد پیدا نشد');
    };
  }

  if ($('#btnPauseQueue')) {
    $('#btnPauseQueue').onclick = async () => {
      const isPaused = $('#btnPauseQueue').dataset.paused === '1';
      const endpoint = isPaused ? '/api/control/resume' : '/api/control/pause';
      const r = await post(endpoint);
      if (r.ok) {
        toast(isPaused ? 'پخش صف از سر گرفته شد' : 'صف متوقف شد', 'ok');
      }
    };
  }

  if ($('#btnMute')) {
    $('#btnMute').onclick = async () => {
      const r = await post('/api/control/mute');
      if (r.ok) {
        toast(r.muted ? 'صدا قطع شد (Mute)' : 'صدا وصل شد', 'ok');
      }
    };
  }

  if ($('#btnClear')) {
    $('#btnClear').onclick = async () => {
      const ok = await spConfirm({
        title: 'خالی کردن صف',
        body: 'آیا از پاک کردن کامل صف آلرت‌ها اطمینان دارید؟',
        confirmText: 'خالی کردن صف',
        cancelText: 'انصراف',
        icon: '#i-queue',
        danger: true
      });
      if (!ok) return;
      await post('/api/control/clear');
      toast('صف پخش خالی شد', 'ok');
    };
  }
}

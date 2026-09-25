// Sahne ProMax — 1-Click Backup & Restore Management
'use strict';

import { $, toast, spConfirm } from './api.js';

export function initBackup({ onRestoreComplete }) {
  const btnBackup = $('#btnDownloadBackup');
  const btnRestore = $('#btnRestoreBackup');
  const restoreInput = $('#restoreFileInput');

  if (btnBackup) {
    btnBackup.onclick = () => {
      toast('در حال ایجاد فایل پشتیبان…', 'ok');
      window.location.href = '/api/backup';
    };
  }

  if (btnRestore && restoreInput) {
    btnRestore.onclick = () => {
      restoreInput.click();
    };

    restoreInput.onchange = async () => {
      const file = restoreInput.files[0];
      if (!file) return;
      const notice = $('#restoreNotice');

      if (!file.name.endsWith('.zip')) {
        toast('لطفاً یک فایل فشرده معتبر با فرمت .zip انتخاب کنید', 'err');
        restoreInput.value = '';
        return;
      }

      const ok = await spConfirm({
        title: 'بازیابی نسخه پشتیبان',
        body: `آیا از بازیابی نسخه پشتیبان «${file.name}» مطمئنید؟ تنظیمات فعلی و فایل‌های مدیا با محتوای این نسخه جایگزین خواهند شد.`,
        confirmText: 'بازیابی',
        cancelText: 'انصراف',
        icon: '#i-refresh',
        danger: true
      });
      if (!ok) {
        restoreInput.value = '';
        return;
      }

      toast('در حال بازیابی اطلاعات… لطفاً منتظر بمانید', 'ok');

      try {
        const res = await fetch('/api/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/zip'
          },
          body: file
        });

        const r = await res.json();
        if (r.ok) {
          if (notice) {
            notice.textContent = '';
            notice.hidden = true;
          }
          toast(`بازیابی با موفقیت انجام شد (${r.restoredFiles || 0} فایل)`, 'ok');
          const reconnect = r.reconnectRequired || {};
          const providers = [
            reconnect.kickbot && 'KickBot',
            reconnect.streamelements && 'StreamElements',
            reconnect.donofa && 'Donofa'
          ].filter(Boolean);
          if (notice && providers.length) {
            notice.textContent = `بازیابی انجام شد. برای دریافت دوبارهٔ دونیت‌ها، اتصال ${providers.join(' و ')} را در تنظیمات دوباره برقرار کنید.`;
            notice.hidden = false;
          }
          if (typeof onRestoreComplete === 'function') {
            onRestoreComplete();
          }
        } else {
          toast(r.error || 'خطا در بازیابی نسخه پشتیبان', 'err');
        }
      } catch (err) {
        toast('ارتباط با سرور در حین بازیابی قطع شد: ' + err.message, 'err');
      } finally {
        restoreInput.value = '';
      }
    };
  }
}

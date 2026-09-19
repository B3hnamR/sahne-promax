// Sahne ProMax — Live Donation & Sub Goal Management
'use strict';

import { $, post, toast, copyText, fmtToman } from './api.js';

export function fillGoal(goal) {
  if (!goal) return;
  if ($('#gTitle')) $('#gTitle').value = goal.title || '';
  if ($('#gTarget')) $('#gTarget').value = goal.targetToman || 5000000;
  if ($('#gCurrent')) $('#gCurrent').value = goal.currentToman || 0;
  if ($('#gAutoReset')) $('#gAutoReset').checked = goal.autoIncrement !== false;
  if ($('#gCurrentLbl')) $('#gCurrentLbl').textContent = fmtToman(goal.currentToman || 0);
  if ($('#gTargetLbl')) $('#gTargetLbl').textContent = fmtToman(goal.targetToman || 5000000);
}

export function initGoal() {
  const goalUrl = 'http://localhost:' + (window.location.port || 7788) + '/goal';
  if ($('#gUrl')) $('#gUrl').value = goalUrl;

  if ($('#btnCopyGoalUrl')) {
    $('#btnCopyGoalUrl').onclick = () => {
      copyText(goalUrl);
      toast('لینک ویجت هدف کپی شد', 'ok');
    };
  }

  if ($('#btnSaveGoal')) {
    $('#btnSaveGoal').onclick = async () => {
      const title = $('#gTitle').value.trim();
      const targetToman = Number($('#gTarget').value) || 5000000;
      const currentToman = Number($('#gCurrent').value) || 0;
      const autoIncrement = $('#gAutoReset').checked;

      const r = await post('/api/goal', { title, targetToman, currentToman, autoIncrement });
      if (r.ok) {
        toast('تنظیمات هدف دونیت ذخیره شد', 'ok');
        fillGoal(r.goal);
        refreshGoalPreview();
      } else {
        toast(r.error || 'خطا در ذخیره هدف', 'err');
      }
    };
  }

  if ($('#btnResetGoal')) {
    $('#btnResetGoal').onclick = async () => {
      if (!confirm('آیا از صفر کردن مبلغ جمع‌آوری‌شده مطمئنید؟')) return;
      const r = await post('/api/goal/reset', { targetToman: Number($('#gTarget').value) || undefined });
      if (r.ok) {
        toast('هدف دونیت صفر شد', 'ok');
        fillGoal(r.goal);
        refreshGoalPreview();
      }
    };
  }
}

export function refreshGoalPreview() {
  const pv = $('#goalPv');
  if (pv) {
    try {
      pv.contentWindow.location.reload();
    } catch {}
  }
}

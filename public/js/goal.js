// Sahne ProMax — Live Donation & Sub Goal Management
'use strict';

import { $, post, toast, copyText, fmtToman, spConfirm } from './api.js';

function toLocalInput(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
  );
}

function toggleDeadlineRow() {
  const on = !!($('#gTimed') || {}).checked;
  if ($('#gDeadlineRow')) $('#gDeadlineRow').hidden = !on;
}

export function fillGoal(goal) {
  if (!goal) return;
  if ($('#gTitle')) $('#gTitle').value = goal.title || '';
  if ($('#gTarget')) $('#gTarget').value = goal.targetToman || 5000000;
  if ($('#gCurrent')) $('#gCurrent').value = goal.currentToman || 0;
  if ($('#gAutoReset')) $('#gAutoReset').checked = goal.autoIncrement !== false;
  if ($('#gTimed')) $('#gTimed').checked = goal.mode === 'timed';
  if ($('#gDeadline')) $('#gDeadline').value = goal.deadline ? toLocalInput(goal.deadline) : '';
  toggleDeadlineRow();
  if ($('#gConfettiDone')) $('#gConfettiDone').checked = goal.confettiOnComplete !== false;
  if ($('#gConfettiSub')) $('#gConfettiSub').checked = goal.confettiOnFirstSub !== false;
  if ($('#gMilestone')) $('#gMilestone').value = goal.milestoneToman || 0;
  if ($('#gCurrentLbl')) $('#gCurrentLbl').textContent = fmtToman(goal.currentToman || 0);
  if ($('#gTargetLbl')) $('#gTargetLbl').textContent = fmtToman(goal.targetToman || 5000000);
}

export function initGoal() {
  const goalUrl = 'http://localhost:' + (window.location.port || 7788) + '/goal';
  if ($('#gUrl')) $('#gUrl').value = goalUrl;

  if ($('#gTimed')) $('#gTimed').onchange = toggleDeadlineRow;

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

      const timed = !!($('#gTimed') || {}).checked;
      let deadline = null;
      if (timed) {
        const v = ($('#gDeadline') || {}).value || '';
        if (!v) return toast('برای هدف زمان‌دار، تاریخ و ساعت پایان را وارد کنید', 'err');
        deadline = new Date(v).getTime();
        if (!Number.isFinite(deadline) || deadline <= Date.now()) return toast('زمان پایان باید در آینده باشد', 'err');
      }

      const r = await post('/api/goal', {
        title,
        targetToman,
        currentToman,
        autoIncrement,
        mode: timed ? 'timed' : 'amount',
        deadline,
        confettiOnComplete: !!($('#gConfettiDone') || {}).checked,
        confettiOnFirstSub: !!($('#gConfettiSub') || {}).checked,
        milestoneToman: Number(($('#gMilestone') || {}).value) || 0
      });
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
      const ok = await spConfirm({
        title: 'صفر کردن پیشرفت هدف',
        body: 'آیا از صفر کردن مبلغ جمع‌آوری‌شده هدف مطمئنید؟',
        confirmText: 'صفر کردن',
        cancelText: 'انصراف',
        icon: '#i-chart',
        danger: true
      });
      if (!ok) return;
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

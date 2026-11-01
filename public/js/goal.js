// Sahne ProMax — Live Donation & Sub Goal Management
'use strict';

import { $, settingsRequest, toast, copyText, fmtToman, spConfirm } from './api.js';

const goalFields = {
  gTitle: 'value',
  gTarget: 'value',
  gCurrent: 'value',
  gAutoReset: 'checked',
  gTimed: 'checked',
  gDeadline: 'value',
  gConfettiDone: 'checked',
  gConfettiSub: 'checked',
  gMilestone: 'value',
  gCounters: 'checked'
};
const goalBaseline = {};

function snapshotGoal() {
  return Object.fromEntries(Object.entries(goalFields).map(([id, property]) => [id, $('#' + id)?.[property]]));
}

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

export function fillGoal(goal, { snapshot } = {}) {
  if (!goal) return;
  const values = {
    gTitle: goal.title || '',
    gTarget: String(goal.targetToman || 5000000),
    gCurrent: String(goal.currentToman || 0),
    gAutoReset: goal.autoIncrement !== false,
    gTimed: goal.mode === 'timed',
    gDeadline: goal.deadline ? toLocalInput(goal.deadline) : '',
    gConfettiDone: goal.confettiOnComplete !== false,
    gConfettiSub: goal.confettiOnFirstSub !== false,
    gMilestone: String(goal.milestoneToman || 0),
    gCounters: goal.showCounters !== false
  };
  for (const [id, value] of Object.entries(values)) {
    const field = $('#' + id);
    const property = goalFields[id];
    // A response may acknowledge the submitted draft, but not edits made while it was pending.
    if (
      field &&
      (snapshot ? field[property] === snapshot[id] : !(id in goalBaseline) || field[property] === goalBaseline[id])
    ) {
      field[property] = value;
    }
    goalBaseline[id] = value;
  }
  toggleDeadlineRow();
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

      const snapshot = snapshotGoal();
      const r = await settingsRequest('/api/goal', {
        title,
        targetToman,
        currentToman,
        autoIncrement,
        mode: timed ? 'timed' : 'amount',
        deadline,
        confettiOnComplete: !!($('#gConfettiDone') || {}).checked,
        confettiOnFirstSub: !!($('#gConfettiSub') || {}).checked,
        milestoneToman: Number(($('#gMilestone') || {}).value) || 0,
        showCounters: !!($('#gCounters') || {}).checked
      });
      if (r.ok) {
        toast('تنظیمات هدف دونیت ذخیره شد', 'ok');
        fillGoal(r.goal, { snapshot });
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
        body: 'آیا از صفر کردن مبلغ جمع‌آوری‌شده و شمارنده‌های هدف (ساب / ساب‌گیفت) مطمئنید؟',
        confirmText: 'صفر کردن',
        cancelText: 'انصراف',
        icon: '#i-chart',
        danger: true
      });
      if (!ok) return;
      const snapshot = snapshotGoal();
      const r = await settingsRequest('/api/goal/reset', { targetToman: Number($('#gTarget').value) || undefined });
      if (r.ok) {
        toast('هدف دونیت صفر شد', 'ok');
        fillGoal(r.goal, { snapshot });
        refreshGoalPreview();
      } else {
        toast(r.error, 'err');
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

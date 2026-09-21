'use strict';
const { sanitizeGoal } = require('../utils/sanitizers');

// Local (streamer machine) calendar day key; the first_sub milestone resets on this boundary
function localDayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

class GoalManager {
  constructor({ configStore, logger, sse }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
  }

  getGoal() {
    return this.configStore.config.goal;
  }

  // toman: amount added to the goal (0 for chat-command alerts, which must never inflate it).
  // meta: { kind, count, name, test, replay } from the alert that triggered this.
  addAmount(toman, meta = {}) {
    const goal = this.getGoal();
    if (!goal || !goal.enabled || !goal.autoIncrement) return;
    const add = Math.max(0, Math.round(Number(toman) || 0));
    const test = !!meta.test || !!meta.replay;
    const events = [];

    if (add > 0) {
      goal.currentToman = (goal.currentToman || 0) + add;
      this.configStore.debouncedSave();
      this.logger.info('هدف حمایت به‌روز شد', { added: add, current: goal.currentToman, target: goal.targetToman });

      this.sse.broadcast('goal', { type: 'goal_update', goal: this.getPublicGoal() });
      this.sse.broadcast('admin', { type: 'goal_update', goal: this.getPublicGoal() });

      // One celebration per goal completion (resetGoal / raising the target arms it again)
      const target = Math.max(1, Number(goal.targetToman) || 1);
      if (goal.confettiOnComplete !== false && !goal.completedCelebrated && goal.currentToman >= target) {
        goal.completedCelebrated = true;
        this.configStore.debouncedSave();
        events.push({ reason: 'goal_complete' });
      }
    }

    if (!test) {
      const milestone = Math.max(0, Number(goal.milestoneToman) || 0);
      if (milestone > 0 && add >= milestone) events.push({ reason: 'big_donation' });

      if (goal.confettiOnFirstSub !== false && meta.kind === 'sub') {
        const day = localDayKey();
        if (goal.subsDay !== day) {
          goal.subsDay = day;
          this.configStore.debouncedSave();
          events.push({ reason: 'first_sub' });
        }
      }
    }

    for (const ev of events) this.celebrate(ev.reason, { name: meta.name, toman: add, count: meta.count });
  }

  // Tell the overlays to throw confetti (they also drive the goal widget's own completion effect)
  celebrate(reason, extra = {}) {
    const payload = {
      type: 'celebrate',
      reason,
      name: extra.name || null,
      toman: extra.toman || 0,
      count: extra.count || null
    };
    this.logger.info('جشن میدانی (کانفتی)', { reason, name: payload.name, toman: payload.toman });
    this.sse.broadcast('overlay', payload);
    this.sse.broadcast('preview', payload);
  }

  setGoal(data) {
    const current = this.getGoal();
    const updated = sanitizeGoal(data, current);
    // Below target again (e.g. the target was raised): the next completion may celebrate once more
    if ((updated.currentToman || 0) < Math.max(1, Number(updated.targetToman) || 1))
      updated.completedCelebrated = false;
    this.configStore.config.goal = updated;
    this.configStore.debouncedSave();

    this.logger.info('تنظیمات هدف حمایت ذخیره شد', updated);
    this.sse.broadcast('goal', { type: 'goal_update', goal: this.getPublicGoal() });
    this.sse.broadcast('admin', { type: 'goal_update', goal: this.getPublicGoal() });
    return updated;
  }

  resetGoal(newTarget = null) {
    const goal = this.getGoal();
    goal.currentToman = 0;
    goal.completedCelebrated = false;
    if (newTarget && Number(newTarget) > 0) {
      goal.targetToman = Math.round(Number(newTarget));
    }
    this.configStore.debouncedSave();
    this.logger.info('هدف حمایت بازنشانی شد', { current: 0, target: goal.targetToman });

    this.sse.broadcast('goal', { type: 'goal_update', goal: this.getPublicGoal() });
    this.sse.broadcast('admin', { type: 'goal_update', goal: this.getPublicGoal() });
  }

  getPublicGoal() {
    const g = this.getGoal();
    const target = g.targetToman || 1;
    const current = g.currentToman || 0;
    const percent = Math.min(100, Math.round((current / target) * 100));
    const mode = g.mode === 'timed' ? 'timed' : 'amount';
    const deadline = mode === 'timed' && Number(g.deadline) > 0 ? Number(g.deadline) : null;
    const remainingMs = deadline ? Math.max(0, deadline - Date.now()) : null;
    return {
      enabled: g.enabled !== false,
      title: g.title || 'هدف حمایت استریم',
      targetToman: target,
      currentToman: current,
      percent,
      completed: current >= target,
      autoIncrement: g.autoIncrement !== false,
      unit: g.unit || 'toman',
      color: g.color || '#53fc18',
      bgColor: g.bgColor || '#0b0f0c',
      mode,
      deadline,
      remainingMs,
      expired: deadline != null && remainingMs === 0,
      serverNow: Date.now(),
      milestoneToman: Math.max(0, Number(g.milestoneToman) || 0),
      confettiOnComplete: g.confettiOnComplete !== false,
      confettiOnFirstSub: g.confettiOnFirstSub !== false
    };
  }
}

module.exports = {
  GoalManager,
  localDayKey
};

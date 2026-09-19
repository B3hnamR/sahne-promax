'use strict';
const { sanitizeGoal } = require('../utils/sanitizers');

class GoalManager {
  constructor({ configStore, logger, sse }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
  }

  getGoal() {
    return this.configStore.config.goal;
  }

  addAmount(toman) {
    const goal = this.getGoal();
    if (!goal || !goal.enabled || !goal.autoIncrement) return;
    const add = Math.max(0, Math.round(Number(toman) || 0));
    if (add <= 0) return;

    goal.currentToman = (goal.currentToman || 0) + add;
    this.configStore.debouncedSave();
    this.logger.info('هدف حمایت به‌روز شد', { added: add, current: goal.currentToman, target: goal.targetToman });

    this.sse.broadcast('goal', { type: 'goal_update', goal: this.getPublicGoal() });
    this.sse.broadcast('admin', { type: 'goal_update', goal: this.getPublicGoal() });
  }

  setGoal(data) {
    const current = this.getGoal();
    const updated = sanitizeGoal(data, current);
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
      bgColor: g.bgColor || '#0b0f0c'
    };
  }
}

module.exports = {
  GoalManager
};

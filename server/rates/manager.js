'use strict';
const { LIMITS } = require('../constants');
const { fetchNobitex } = require('./nobitex');
const { fetchBaha24 } = require('./baha24');

class RateManager {
  constructor({ configStore, logger, sse, fetchNobitexFn = null, fetchBaha24Fn = null }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
    this.fetchNobitex = fetchNobitexFn || fetchNobitex;
    this.fetchBaha24 = fetchBaha24Fn || fetchBaha24;
    this.rateError = null;
    this.rateTimer = null;
    this.rateBusy = false;
  }

  currentRate() {
    const config = this.configStore.config;
    return Number(config.rate.manual) > 0 ? Number(config.rate.manual) : Number(config.rate.value) || 0;
  }

  tomanOf(usd) {
    const r = this.currentRate();
    return r ? Math.round(usd * r) : null;
  }

  async refreshRate(force = false) {
    if (this.rateBusy) return null;
    const config = this.configStore.config;
    if (!config.rate.auto && !force) return null;
    this.rateBusy = true;
    try {
      let v;
      let source = 'nobitex';
      const errs = [];
      const proxy = (config.rate.proxy || '').trim();

      // Main source: Nobitex USDTIRT orderbook
      try {
        v = await this.fetchNobitex(proxy);
      } catch (e1) {
        errs.push('nobitex: ' + e1.message);
        // Fallback source: Baha24 public API
        try {
          v = await this.fetchBaha24(proxy);
          source = 'baha24';
        } catch (e2) {
          errs.push('baha24: ' + e2.message);
          throw new Error(errs.join(' | '));
        }
      }

      const changed = v !== config.rate.value || source !== config.rate.source;
      config.rate.value = v;
      config.rate.updatedAt = new Date().toISOString();
      config.rate.source = source;
      this.rateError = null;
      this.configStore.debouncedSave();

      if (changed) {
        this.logger.info('نرخ دلار به‌روز شد (' + source + ')', { toman: v });
      }
      this.sse.broadcast('admin', { type: 'rate', rate: config.rate, effective: this.currentRate() });
      this.sse.sendState();
      return v;
    } catch (e) {
      this.rateError = e.message;
      this.logger.warn('دریافت نرخ دلار ناموفق بود؛ نرخ قبلی استفاده می‌شود', e.message);
      this.sse.sendState();
      return null;
    } finally {
      this.rateBusy = false;
    }
  }

  scheduleRate() {
    clearInterval(this.rateTimer);
    const config = this.configStore.config;
    const intervalMs = Math.max(LIMITS.minRateInterval, Number(config.rate.intervalMin) || 2) * 60000;
    this.rateTimer = setInterval(() => this.refreshRate(false), intervalMs);
  }

  stop() {
    if (this.rateTimer) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }
}

module.exports = {
  RateManager
};

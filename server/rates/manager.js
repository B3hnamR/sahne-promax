'use strict';
const { LIMITS, NOBITEX, BAHA24 } = require('../constants');
const { fetchNobitex } = require('./nobitex');
const { fetchBaha24 } = require('./baha24');
const { routeOrder, routeLabel } = require('../utils/net');

class RateManager {
  constructor({ configStore, logger, sse, systemProxy = null, fetchNobitexFn = null, fetchBaha24Fn = null }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
    this.fetchNobitex = fetchNobitexFn || fetchNobitex;
    this.fetchBaha24 = fetchBaha24Fn || fetchBaha24;
    this.systemProxy = systemProxy;
    this.systemProxyLabel = null;
    this.rateError = null;
    this.rateTimer = null;
    this.rateBusy = false;
  }

  // ---------- Windows system proxy (a VPN app in "system proxy" mode). Node ignores it, so the Electron shell
  // resolves it (opts.systemProxy, Chromium's resolver incl. PAC) and it is tried after a manual proxy. ----------
  async systemProxyFor(url) {
    if (typeof this.systemProxy !== 'function') return '';
    let p = '';
    try {
      p = String((await this.systemProxy(url)) || '');
    } catch {
      p = '';
    }
    if (!/^https?:\/\/\S+$/.test(p)) p = '';
    const label = p ? routeLabel(p) : null;
    if (label !== this.systemProxyLabel) {
      this.systemProxyLabel = label;
      if (label) this.logger.info('پراکسی سیستم ویندوز پیدا شد', { proxy: label });
      this.sse.sendState();
    }
    return p;
  }

  async routesFor(url, directFirst) {
    return routeOrder({
      manual: this.configStore.config.rate.proxy,
      system: await this.systemProxyFor(url),
      directFirst
    });
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

      // Main source: Nobitex USDTIRT orderbook (domestic: direct first, proxies as retries)
      try {
        v = await this.fetchNobitex(await this.routesFor(NOBITEX, true));
      } catch (e1) {
        errs.push('nobitex: ' + e1.message);
        // Fallback source: Baha24 public API (direct first, proxies as retries)
        try {
          v = await this.fetchBaha24(await this.routesFor(BAHA24, true));
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

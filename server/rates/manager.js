'use strict';
const { LIMITS, NOBITEX, BAHA24, BONBAST } = require('../constants');
const { fetchNobitex } = require('./nobitex');
const { fetchBaha24, fetchBaha24Quote, sanitizeFx } = require('./baha24');
const { fetchBonbastFx } = require('./bonbast');
const { routeOrder, routeLabel } = require('../utils/net');

class RateManager {
  constructor({
    configStore,
    logger,
    sse,
    systemProxy = null,
    fetchNobitexFn = null,
    fetchBaha24Fn = null,
    fetchBaha24QuoteFn = null,
    fetchBonbastFxFn = null,
    bonbastMinIntervalMs = 5 * 60 * 1000
  }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
    this.fetchNobitex = fetchNobitexFn || fetchNobitex;
    this.fetchBaha24 = fetchBaha24Fn || fetchBaha24;
    this.fetchBaha24Quote =
      fetchBaha24QuoteFn ||
      (fetchBaha24Fn ? async routes => ({ usd: await fetchBaha24Fn(routes), fx: {} }) : fetchBaha24Quote);
    this.fetchBonbastFx = fetchBonbastFxFn || fetchBonbastFx;
    this.bonbastMinIntervalMs = Math.max(0, Number(bonbastMinIntervalMs) || 0);
    this.lastBonbastAttempt = 0;
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

  rateFor(currency = 'USD') {
    const code = String(currency || 'USD').toUpperCase();
    if (code === 'USD') return this.currentRate() || null;
    const value = this.configStore.config.rate.fx && this.configStore.config.rate.fx[code];
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  }

  tomanFor(amount, currency = 'USD') {
    const rate = this.rateFor(currency);
    const value = Number(amount);
    return rate && Number.isFinite(value) ? Math.round(value * rate) : null;
  }

  async fetchFxFallback() {
    if (Date.now() - this.lastBonbastAttempt < this.bonbastMinIntervalMs) return null;
    this.lastBonbastAttempt = Date.now();
    return this.fetchBonbastFx(await this.routesFor(BONBAST, false));
  }

  async fetchBahaQuote() {
    return this.fetchBaha24Quote(await this.routesFor(BAHA24, true));
  }

  async refreshRate(force = false) {
    if (this.rateBusy) return null;
    const config = this.configStore.config;
    if (!config.rate.auto && !force) return null;
    this.rateBusy = true;
    try {
      let v;
      let source = 'nobitex';
      let fx = null;
      let fxSource = null;
      const errs = [];

      // Main source: Nobitex USDTIRT orderbook (domestic: direct first, proxies as retries)
      try {
        v = await this.fetchNobitex(await this.routesFor(NOBITEX, true));
        // Baha24 is still queried on the normal Nobitex path: its quote table supplies non-USD SE currency rates.
        try {
          const quote = await this.fetchBahaQuote();
          fx = quote && quote.fx;
          if (!fx || !Object.keys(sanitizeFx(fx)).length) throw new Error('no supported foreign exchange rates');
          fxSource = 'baha24';
        } catch (e) {
          this.logger.warn('دریافت نرخ ارزهای دیگر از بها۲۴ ناموفق بود؛ تلاش با بون‌بست', e.message);
          try {
            fx = await this.fetchFxFallback();
            if (fx && Object.keys(sanitizeFx(fx)).length) fxSource = 'bonbast';
          } catch (fallbackError) {
            this.logger.warn(
              'دریافت نرخ ارزهای دیگر از بون‌بست ناموفق بود؛ نرخ‌های قبلی استفاده می‌شود',
              fallbackError.message
            );
          }
        }
      } catch (e1) {
        errs.push('nobitex: ' + e1.message);
        // Fallback source: Baha24 public API (direct first, proxies as retries)
        try {
          const quote = await this.fetchBahaQuote();
          v = quote && typeof quote === 'object' ? quote.usd : quote;
          fx = quote && typeof quote === 'object' ? quote.fx : null;
          if (fx && Object.keys(sanitizeFx(fx)).length) fxSource = 'baha24';
          if (!fx || !Object.keys(sanitizeFx(fx)).length) {
            try {
              fx = await this.fetchFxFallback();
              if (fx && Object.keys(sanitizeFx(fx)).length) fxSource = 'bonbast';
            } catch (fallbackError) {
              this.logger.warn(
                'دریافت نرخ ارزهای دیگر از بون‌بست ناموفق بود؛ نرخ‌های قبلی استفاده می‌شود',
                fallbackError.message
              );
            }
          }
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
      if (fx && Object.keys(sanitizeFx(fx)).length) {
        config.rate.fx = sanitizeFx(fx);
        config.rate.fxSource = fxSource;
      }
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

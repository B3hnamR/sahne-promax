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
    this.refreshGeneration = 0;
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
    const generation = this.refreshGeneration;
    try {
      let v;
      let source = 'nobitex';
      let usdPublished = false;
      let fx = null;
      let fxSource = null;
      const errs = [];

      // Main source: Nobitex USDTIRT orderbook (domestic: direct first, proxies as retries)
      try {
        v = await this.fetchNobitex(await this.routesFor(NOBITEX, true));
        if (generation !== this.refreshGeneration) return null;
        // A slow optional FX source must never delay the usable USD rate.
        this.publishRate(v, source);
        usdPublished = true;
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
        if (generation !== this.refreshGeneration) return null;
        errs.push('nobitex: ' + e1.message);
        // Fallback source: Baha24 public API (direct first, proxies as retries)
        try {
          const quote = await this.fetchBahaQuote();
          v = quote && typeof quote === 'object' ? quote.usd : quote;
          fx = quote && typeof quote === 'object' ? quote.fx : null;
          source = 'baha24';
          // Same rule as the Nobitex path: a slow optional FX lookup must not
          // delay a usable USD quote.
          if (v != null) {
            this.publishRate(v, source);
            usdPublished = true;
          }
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
        } catch (e2) {
          errs.push('baha24: ' + e2.message);
          throw new Error(errs.join(' | '));
        }
      }

      if (generation !== this.refreshGeneration) return null;
      if (!usdPublished) this.publishRate(v, source);
      if (fx && Object.keys(sanitizeFx(fx)).length) {
        config.rate.fx = sanitizeFx(fx);
        config.rate.fxSource = fxSource;
        this.configStore.debouncedSave();
        this.sse.broadcast('admin', { type: 'rate', rate: config.rate, effective: this.currentRate() });
        this.sse.sendState();
      }
      this.rateError = null;
      return v;
    } catch (e) {
      if (generation !== this.refreshGeneration) return null;
      this.rateError = e.message;
      this.logger.warn('دریافت نرخ دلار ناموفق بود؛ نرخ قبلی استفاده می‌شود', e.message);
      this.sse.sendState();
      return null;
    } finally {
      if (generation === this.refreshGeneration) this.rateBusy = false;
    }
  }

  publishRate(value, source) {
    const rate = this.configStore.config.rate;
    const changed = value !== rate.value || source !== rate.source;
    rate.value = value;
    rate.updatedAt = new Date().toISOString();
    rate.source = source;
    this.rateError = null;
    this.configStore.debouncedSave();
    if (changed) this.logger.info('نرخ دلار به‌روز شد (' + source + ')', { toman: value });
    this.sse.broadcast('admin', { type: 'rate', rate, effective: this.currentRate() });
    this.sse.sendState();
  }

  scheduleRate() {
    clearInterval(this.rateTimer);
    const config = this.configStore.config;
    const intervalMs = Math.max(LIMITS.minRateInterval, Number(config.rate.intervalMin) || 2) * 60000;
    this.rateTimer = setInterval(() => this.refreshRate(false), intervalMs);
  }

  stop() {
    // Invalidate any refresh still awaiting the network: it must not publish or
    // schedule a config write after shutdown.
    this.refreshGeneration++;
    this.rateBusy = false;
    if (this.rateTimer) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }

  resetForRestore() {
    this.rateError = null;
    this.stop();
  }
}

module.exports = {
  RateManager
};

'use strict';
const crypto = require('crypto');
const { LIMITS } = require('../constants');
const { cleanText, finite, intOrNull } = require('../utils/validation');
const { pickMedia, buildPayload } = require('./picker');

class PlaybackQueue {
  constructor({
    configStore,
    playedStore,
    mediaDir,
    logger,
    sse,
    rateManager,
    captureFn,
    publishFn,
    captureRetryMs = 15000
  }) {
    this.configStore = configStore;
    this.playedStore = playedStore;
    this.mediaDir = mediaDir;
    this.logger = logger;
    this.sse = sse;
    this.rateManager = rateManager;
    this.capture = captureFn;
    this.publish = publishFn || (() => {});
    this.captureRetryMs = Number(captureRetryMs) || 15000;

    this.pending = [];
    this.approved = [];
    this.playing = null;
    this.recent = [];
    this.queueStatus = 'play';
    this.queueDelay = 2;
    this.queueMode = 'auto';
    this.tippingEnabled = true;
    this.isMuted = false;
    this.masterVolume = 80;

    this.lastEnd = 0;
    this.nextTimer = null;
    this.playTimeout = null;
    this.advancing = false;
    this.captureFailures = new Map();
    this.CAPTURE_MAX_ATTEMPTS = 3;

    // Optional goal manager hook
    this.goalManager = null;
  }

  setGoalManager(gm) {
    this.goalManager = gm;
  }

  tipSummary(t) {
    return {
      id: t.stripe_pi_id,
      name: t.tipper_name,
      amount: (t.amount_total || 0) / 100,
      message: t.tip_message,
      test: !!t.is_test,
      kind: t.kind || 'tip',
      count: t.count || null,
      months: t.months || null
    };
  }

  async tryNext() {
    const config = this.configStore.config;
    if (config.mode === 'companion' || this.advancing) return;
    if (this.playing || this.queueStatus !== 'play' || this.approved.length === 0) return;
    if (this.sse.clientCount('overlay') === 0) return;

    const wait = this.lastEnd + this.queueDelay * 1000 - Date.now();
    if (wait > 0) {
      clearTimeout(this.nextTimer);
      this.nextTimer = setTimeout(() => this.tryNext(), wait + 50);
      return;
    }

    const t = this.approved.shift();
    if (!t) return;
    if (!t.is_replay && this.playedStore.isPlayed(t.stripe_pi_id)) return this.tryNext();

    this.advancing = true;
    let next = false;
    try {
      this.playing = t;
      this.sse.sendState();

      if (!t.is_test && !t.is_local) {
        const res = await this.capture(t);
        if (!this.playing || this.playing.stripe_pi_id !== t.stripe_pi_id) return;
        if (res !== 'ok') {
          this.playing = null;
          next = true;
          if (res === 'failed') {
            this.captureFailures.delete(t.stripe_pi_id);
            this.playedStore.markPlayed(t.stripe_pi_id);
            this.logger.error('پرداخت کپچر نشد، دونیت رد شد', this.tipSummary(t));
            this.publish('tip_end', { stripe_pi_id: t.stripe_pi_id });
            this.sse.sendState();
            return;
          }
          const attempts = (this.captureFailures.get(t.stripe_pi_id) || 0) + 1;
          if (attempts >= this.CAPTURE_MAX_ATTEMPTS) {
            this.captureFailures.delete(t.stripe_pi_id);
            this.logger.error(
              'پرداخت بعد از ' + attempts + ' تلاش کپچر نشد؛ بعد از همگام‌سازی بعدی صف دوباره تلاش می‌شود',
              this.tipSummary(t)
            );
            this.sse.sendState();
            return;
          }
          this.captureFailures.set(t.stripe_pi_id, attempts);
          this.approved.push(t);
          this.logger.warn(
            'پرداخت کپچر نشد؛ تلاش مجدد (' + attempts + '/' + this.CAPTURE_MAX_ATTEMPTS + ')',
            this.tipSummary(t)
          );
          this.sse.sendState();
          clearTimeout(this.nextTimer);
          this.nextTimer = setTimeout(() => this.tryNext(), this.captureRetryMs);
          next = this.approved.length > 1;
          return;
        }
        this.publish('tip_play', { stripe_pi_id: t.stripe_pi_id });
      }

      this.captureFailures.delete(t.stripe_pi_id);
      this.playedStore.markPlayed(t.stripe_pi_id);
      this.showTip(t);
    } finally {
      this.advancing = false;
      if (next) this.tryNext();
    }
  }

  showTip(t) {
    const config = this.configStore.config;
    const media = pickMedia(t, {
      config,
      mediaDir: this.mediaDir,
      currentRate: () => this.rateManager.currentRate()
    });

    if (!media && config.showAlertWithoutMedia === false) {
      this.logger.info('آلرت بدون فایل نمایش داده نشد (طبق تنظیمات)', this.tipSummary(t));
      this.recent.unshift({
        ...this.tipSummary(t),
        toman: t.toman_override != null ? t.toman_override : this.rateManager.tomanOf((t.amount_total || 0) / 100),
        media: null,
        skipped: true,
        at: Date.now()
      });
      if (this.recent.length > 30) this.recent.pop();
      if (config.mode !== 'companion' && this.playing && this.playing.stripe_pi_id === t.stripe_pi_id) {
        if (!t.is_test && !t.is_local) this.publish('tip_end', { stripe_pi_id: t.stripe_pi_id });
        this.playing = null;
        this.lastEnd = Date.now();
        this.sse.sendState();
        setTimeout(() => this.tryNext(), 0);
      }
      return;
    }

    const payload = buildPayload(t, media, {
      mediaDir: this.mediaDir,
      currentRate: () => this.rateManager.currentRate(),
      tomanOf: usd => this.rateManager.tomanOf(usd)
    });

    // Master volume / mute override
    if (this.isMuted) {
      if (payload.media) payload.media.volume = 0;
    }

    this.recent.unshift({
      ...this.tipSummary(t),
      toman: payload.toman,
      media: media ? media.name : null,
      at: Date.now()
    });
    if (this.recent.length > 30) this.recent.pop();

    // Auto-increment goal if active
    if (this.goalManager && payload.toman > 0) {
      this.goalManager.addAmount(payload.toman);
    }

    this.logger.info('نمایش دونیت', { ...this.tipSummary(t), media: media ? media.file : '-' });
    this.sse.broadcast('overlay', { type: 'play', tip: payload });

    clearTimeout(this.playTimeout);
    this.playTimeout = setTimeout(
      () => this.finishPlaying(t.stripe_pi_id, false, true),
      (config.appearance.maxDuration + 15) * 1000
    );
    this.sse.sendState();
  }

  finishPlaying(id, rejected, timedOut) {
    if (this.configStore.config.mode === 'companion') return;
    if (!this.playing || this.playing.stripe_pi_id !== id) return;
    clearTimeout(this.playTimeout);
    if (timedOut) this.logger.warn('اورلی پایان پخش را اعلام نکرد؛ رد شدن به بعدی');
    if (!this.playing.is_test && !this.playing.is_local && !rejected) {
      this.publish('tip_end', { stripe_pi_id: id });
    }
    this.playing = null;
    this.lastEnd = Date.now();
    this.sse.sendState();
    this.tryNext();
  }

  skipCurrent() {
    if (!this.playing) return false;
    this.logger.info('آلرت جاری رد شد (Skip)');
    this.sse.broadcast('overlay', { type: 'stop' });
    clearTimeout(this.playTimeout);
    const t = this.playing;
    this.playing = null;
    this.lastEnd = Date.now();
    // In companion mode KickBot owns tip lifecycle, so only clear local state; never publish tip_end
    if (this.configStore.config.mode !== 'companion' && !t.is_test && !t.is_local) {
      this.publish('tip_end', { stripe_pi_id: t.stripe_pi_id });
    }
    this.sse.sendState();
    this.tryNext();
    return true;
  }

  replayLast() {
    if (!this.recent.length) return false;
    const last = this.recent[0];
    const tip = {
      stripe_pi_id: 'replay_' + crypto.randomBytes(6).toString('hex'),
      tipper_name: last.name,
      amount_total: Math.round((last.amount || 0) * 100),
      tip_message: last.message,
      kind: last.kind || 'tip',
      count: last.count,
      months: last.months,
      toman_override: last.toman,
      approval_status: 'approved',
      is_test: true,
      is_replay: true,
      created_at: new Date().toISOString()
    };
    this.approved.unshift(tip);
    this.logger.info('آلرت مجدداً در صف قرار گرفت (Replay)', { id: tip.stripe_pi_id, name: tip.tipper_name });
    this.sse.sendState();
    this.tryNext();
    return true;
  }

  setQueueStatus(status) {
    if (status !== 'play' && status !== 'pause') return false;
    this.queueStatus = status;
    this.logger.info('وضعیت صف تغییر کرد', { status });
    this.sse.sendState();
    if (status === 'play') this.tryNext();
    return true;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.logger.info('وضعیت صدا تغییر کرد', { muted: this.isMuted });
    this.sse.broadcast('overlay', { type: 'mute', muted: this.isMuted });
    this.sse.sendState();
    return this.isMuted;
  }

  setVolume(vol) {
    this.masterVolume = finite(vol, 0, 100, 80);
    this.logger.info('ولوم مستر تنظیم شد', { volume: this.masterVolume });
    this.sse.broadcast('overlay', { type: 'volume', volume: this.masterVolume });
    this.sse.sendState();
    return this.masterVolume;
  }

  makeTestTip({ name, amount, message, kind = 'tip', count = null, months = null }) {
    return {
      stripe_pi_id: 'test_' + crypto.randomBytes(6).toString('hex'),
      tipper_name: cleanText(name, LIMITS.name) || 'تستی',
      amount_total: Math.round(finite(amount, 0, 1e6, 5) * 100),
      tip_message: cleanText(message, LIMITS.message),
      approval_status: 'approved',
      is_test: true,
      kind,
      count: intOrNull(count, 1, 100),
      months: intOrNull(months, 1, 240),
      created_at: new Date().toISOString()
    };
  }

  clearQueue() {
    this.approved = [];
    this.pending = [];
    this.logger.info('صف خالی شد');
    this.sse.sendState();
  }

  stop() {
    clearTimeout(this.playTimeout);
    clearTimeout(this.nextTimer);
    this.playTimeout = null;
    this.nextTimer = null;
  }
}

module.exports = {
  PlaybackQueue
};

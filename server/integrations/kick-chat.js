'use strict';
const crypto = require('crypto');
const { PUSHER_WS, KICK_CHANNEL_API, KICK_SUB_USD, UA, LIMITS } = require('../constants');
const { cleanText, finite } = require('../utils/validation');
const { httpsRequest } = require('../utils/http-client');

class KickChatClient {
  constructor({ configStore, queue, rateManager, logger, sse }) {
    this.configStore = configStore;
    this.queue = queue;
    this.rateManager = rateManager;
    this.logger = logger;
    this.sse = sse;

    this.kws = null;
    this.kickPing = null;
    this.kickRetry = 5000;
    this.checkTimer = null;
    this.stopped = false;
    this.kickState = { connected: false, error: null };
    this.recentKeys = new Map();
  }

  status() {
    const config = this.configStore.config;
    if (!config.kick.enabled) return 'disabled';
    if (!config.kick.channel) return 'unconfigured';
    if (this.kickState.connected) return 'connected';
    if (this.kickState.error) return 'error';
    return 'reconnecting';
  }

  seenRecently(key, ms = 2500) {
    const now = Date.now();
    for (const [k, t] of this.recentKeys) {
      if (now - t > 60000) this.recentKeys.delete(k);
    }
    if (this.recentKeys.has(key) && now - this.recentKeys.get(key) < ms) return true;
    this.recentKeys.set(key, now);
    return false;
  }

  async resolveKickChannel() {
    const config = this.configStore.config;
    const slug = String(config.kick.channel || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?kick\.com\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@/, '');

    if (!/^[a-z0-9_.-]{1,40}$/.test(slug)) {
      if (slug) {
        this.kickState.error = 'اسم کانال نامعتبر است';
        this.sse.sendState();
      }
      return false;
    }

    if (config.kick.chatroomId && config.kick.resolvedFor === slug) return true;
    const proxy = (config.rate.proxy || '').trim();
    const order = proxy ? [proxy, ''] : [''];
    let last = null;

    for (const px of order) {
      try {
        const r = await httpsRequest(KICK_CHANNEL_API + encodeURIComponent(slug), {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          proxy: px
        });
        if (r.status === 404) throw new Error('کانالی با این اسم پیدا نشد؛ فقط قسمت بعد از kick.com/ را وارد کنید');
        if (r.status !== 200) throw new Error('kick api HTTP ' + r.status);
        const j = JSON.parse(r.text);
        const chatroomId = Number(j && j.chatroom && j.chatroom.id);
        const channelId = Number(j && j.id);
        if (!chatroomId) throw new Error('chatroom not in response');

        config.kick.channel = slug;
        config.kick.chatroomId = chatroomId;
        config.kick.channelId = channelId || null;
        config.kick.resolvedFor = slug;
        this.configStore.saveConfig();
        this.kickState.error = null;
        this.logger.info('کانال کیک شناسایی شد', { channel: slug, chatroom: chatroomId });
        return true;
      } catch (e) {
        last = e;
      }
    }

    this.kickState.error = (last && last.message) || 'unknown';
    this.logger.warn('شناسایی کانال کیک ناموفق بود (اسم کانال یا دسترسی به kick.com را بررسی کن)', this.kickState.error);
    this.sse.sendState();
    return false;
  }

  connect() {
    const config = this.configStore.config;
    if (!config.kick.enabled || !config.kick.chatroomId || this.stopped) return;
    if (this.kws && (this.kws.readyState === 0 || this.kws.readyState === 1)) return;

    try {
      this.kws = new WebSocket(PUSHER_WS);
    } catch {
      return;
    }

    const sock = this.kws;
    sock.onmessage = ev => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (m.event === 'pusher:connection_established') {
        const chans = [`chatrooms.${config.kick.chatroomId}.v2`, `chatroom_${config.kick.chatroomId}`];
        if (config.kick.channelId) chans.push(`channel.${config.kick.channelId}`);
        for (const ch of chans) {
          sock.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: ch } }));
        }
        this.kickState.connected = true;
        this.kickState.error = null;
        this.kickRetry = 5000;
        this.logger.info('به چت کیک وصل شد (ساب / ساب‌گیفت)', { channel: config.kick.channel });
        clearInterval(this.kickPing);
        this.kickPing = setInterval(() => {
          try {
            sock.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          } catch {}
        }, 60000);
        this.sse.sendState();
      } else if (m.event === 'pusher:ping') {
        try {
          sock.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        } catch {}
      } else if (m.event === 'pusher:error') {
        this.logger.warn('pusher error', m.data);
      } else if (/GiftedSubscriptionsEvent$/.test(m.event || '')) {
        let d = {};
        try {
          d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
        } catch {}
        const names = Array.isArray(d.gifted_usernames)
          ? d.gifted_usernames.map(n => cleanText(n, LIMITS.name)).slice(0, 200)
          : [];
        this.handleGift(cleanText(d.gifter_username, LIMITS.name) || 'ناشناس', names);
      } else if (/\\SubscriptionEvent$/.test(m.event || '')) {
        let d = {};
        try {
          d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
        } catch {}
        this.handleSub(cleanText(d.username, LIMITS.name) || 'ناشناس', finite(d.months, 1, 240, 1));
      }
    };

    sock.onerror = () => {};
    sock.onclose = () => {
      clearInterval(this.kickPing);
      if (this.kickState.connected) this.logger.warn('اتصال چت کیک قطع شد؛ تلاش مجدد');
      this.kickState.connected = false;
      this.sse.sendState();
      if (!this.stopped) setTimeout(() => this.connect(), this.kickRetry);
      this.kickRetry = Math.min(60000, this.kickRetry * 2);
    };
  }

  startKeepAlive() {
    this.checkTimer = setInterval(() => {
      const config = this.configStore.config;
      if (config.kick.enabled && config.kick.chatroomId && (!this.kws || this.kws.readyState === 3)) {
        this.connect();
      }
    }, 15000);
  }

  subValueToman(kind) {
    const config = this.configStore.config;
    const v = Number(kind === 'gift' ? config.kick.giftValueToman : config.kick.subValueToman) || 0;
    if (v > 0) return v;
    const r = this.rateManager.currentRate();
    return r ? Math.round(KICK_SUB_USD * r) : 0;
  }

  localEvent(kind, name, toman, message, count, tags, months = null) {
    const rate = this.rateManager.currentRate();
    const usd = toman > 0 ? (rate ? toman / rate : KICK_SUB_USD * (count || 1)) : KICK_SUB_USD * (count || 1);
    return {
      stripe_pi_id: kind + '_' + crypto.randomBytes(6).toString('hex'),
      tipper_name: name,
      amount_total: Math.round(usd * 100),
      tip_message: cleanText(message, LIMITS.message),
      approval_status: 'approved',
      is_local: true,
      kind,
      count,
      months,
      tags,
      toman_override: toman > 0 ? toman : null,
      created_at: new Date().toISOString()
    };
  }

  enqueueLocal(t) {
    this.logger.info(t.kind === 'gift' ? 'ساب‌گیفت' : 'ساب جدید', {
      name: t.tipper_name,
      count: t.count,
      months: t.months,
      toman: t.toman_override
    });
    if (this.configStore.config.mode === 'companion') {
      this.queue.showTip(t);
    } else {
      this.queue.approved.push(t);
      this.queue.tryNext();
    }
    this.sse.sendState();
  }

  handleGift(gifter, names, isTest = false) {
    const count = Math.max(1, names.length);
    if (!isTest && this.seenRecently(`gift:${gifter}:${names.slice().sort().join('|')}`)) return;
    const t = this.localEvent('gift', gifter, count * this.subValueToman('gift'), names.join('، '), count, [
      'giftsub',
      'gift',
      'sub'
    ]);
    if (isTest) t.is_test = true;
    this.enqueueLocal(t);
  }

  handleSub(name, months = 1, isTest = false) {
    const config = this.configStore.config;
    if (!config.kick.showNewSubs && !isTest) return;
    if (!isTest && this.seenRecently(`sub:${name}`)) return;
    const t = this.localEvent(
      'sub',
      name,
      this.subValueToman('sub'),
      months > 1 ? `${months} ماه` : '',
      1,
      ['sub', 'newsub'],
      months
    );
    if (isTest) t.is_test = true;
    this.enqueueLocal(t);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.kickPing);
    clearInterval(this.checkTimer);
    if (this.kws) {
      try {
        this.kws.close();
      } catch {}
      this.kws = null;
    }
  }
}

module.exports = {
  KickChatClient
};

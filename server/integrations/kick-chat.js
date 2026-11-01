'use strict';
const crypto = require('crypto');
const {
  KICK_REALTIME_API,
  KICK_PUSHER_KEYS,
  KICK_REALTIME_RETRY,
  KICK_CHANNEL_API,
  KICK_SUB_USD,
  UA,
  LIMITS
} = require('../constants');
const { cleanText, finite } = require('../utils/validation');
const { httpsRequest } = require('../utils/http-client');
const { describeKickFailure, routeLabel } = require('../utils/net');

function pusherUrl(key, cluster) {
  if (!/^[a-f0-9]{20}$/.test(String(key || '')) || !/^[a-z0-9-]{1,20}$/.test(String(cluster || ''))) return null;
  return `wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
}

function parseKickRealtime(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const list = j && j.data && Array.isArray(j.data.connections) ? j.data.connections : [];
  for (const c of list) {
    if (!c || c.provider !== 'pusher' || !c.credentials || typeof c.credentials !== 'object') continue;
    const key = String(c.credentials.app_key || '').toLowerCase();
    const cluster = String(c.credentials.cluster || '').toLowerCase();
    if (pusherUrl(key, cluster)) return { key, cluster };
  }
  return null;
}

const KICK_KEY_ERROR = {
  error: 'کلید چت کیک عوض شده و برنامه نتوانست کلید جدید را از kick.com بگیرد',
  hint: 'کیک کلید اتصال چتش را عوض کرده است. VPN را روشن کنید (یا پراکسی HTTP آن را در کادر «پراکسی» بنویسید)؛ برنامه هر ۵ دقیقه دوباره از kick.com می‌پرسد و بعد از «ذخیره» در تنظیمات هم فوراً. اگر ادامه داشت، نسخه‌ی جدید Sahne+ را نصب کنید.'
};

class KickChatClient {
  constructor({
    configStore,
    queue,
    rateManager,
    logger,
    sse,
    WebSocketCtor = globalThis.WebSocket,
    httpsRequestFn = httpsRequest,
    kickPusherKeys = KICK_PUSHER_KEYS,
    now = Date.now,
    onSupport = null
  }) {
    this.configStore = configStore;
    this.queue = queue;
    this.rateManager = rateManager;
    this.logger = logger;
    this.sse = sse;
    this.WebSocketCtor = WebSocketCtor;
    this.httpsRequest = httpsRequestFn;
    this.kickPusherKeys = kickPusherKeys;
    this.now = now;
    this.onSupport = onSupport;
    this.connectionGeneration = 0;
    this.connecting = null;
    this.kickLookupAt = null;
    this.kickLookup = null;
    this.kickRejected = new Set();

    this.kws = null;
    this.kickPing = null;
    this.kickCloseTimer = null;
    this.kickRetry = 5000;
    this.checkTimer = null;
    this.stopped = false;
    this.kickState = { connected: false, error: null, hint: null };
    this.recentKeys = new Map();
    // Chat-command rate limiting state
    this.cmdUsers = new Map(); // username -> last trigger ts
    this.cmdWindow = []; // trigger timestamps in the last minute
    this.cmdLastGlobal = 0;
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
    const generation = this.connectionGeneration;
    const requestedChannel = config.kick.channel;
    const current = () =>
      !this.stopped &&
      generation === this.connectionGeneration &&
      config.kick.enabled &&
      config.kick.channel === requestedChannel;
    if (!current()) return false;
    const slug = String(config.kick.channel || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?kick\.com\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@/, '');

    if (!/^[a-z0-9_.-]{1,40}$/.test(slug)) {
      if (slug) {
        this.kickState.error = 'اسم کانال نامعتبر است';
        this.kickState.hint = 'فقط اسم کانال را بنویسید (حروف انگلیسی، عدد، _ . -)، مثلاً amireyzed.';
        this.sse.sendState();
      }
      return false;
    }

    if (config.kick.chatroomId && config.kick.resolvedFor === slug) return true;
    const attempts = [];

    for (const px of await this.rateManager.routesFor(KICK_CHANNEL_API, false)) {
      if (!current()) return false;
      try {
        const r = await this.httpsRequest(KICK_CHANNEL_API + encodeURIComponent(slug), {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          proxy: px
        });
        if (!current()) return false;
        if (r.status !== 200) {
          const e = new Error('kick api HTTP ' + r.status);
          e.httpStatus = r.status;
          throw e;
        }
        let j;
        try {
          j = JSON.parse(r.text);
        } catch {
          const e = new Error('kick api: response is not JSON');
          e.kind = 'parse';
          throw e;
        }
        const chatroomId = Number(j && j.chatroom && j.chatroom.id);
        const channelId = Number(j && j.id);
        if (!chatroomId) {
          const e = new Error('kick api: chatroom not in response');
          e.kind = 'parse';
          throw e;
        }

        config.kick.channel = slug;
        config.kick.chatroomId = chatroomId;
        config.kick.channelId = channelId || null;
        config.kick.resolvedFor = slug;
        this.configStore.saveConfig();
        this.kickState.error = null;
        this.kickState.hint = null;
        this.logger.info('کانال کیک شناسایی شد', { channel: slug, chatroom: chatroomId, via: routeLabel(px) });
        return true;
      } catch (e) {
        if (!current()) return false;
        attempts.push({ route: px, err: e });
        if (e.httpStatus === 404) break; // definitive: no such channel, other routes would say the same
      }
    }

    if (!current()) return false;
    const d = describeKickFailure(attempts);
    this.kickState.error = d.error;
    this.kickState.hint = d.hint;
    this.logger.warn(
      'شناسایی کانال کیک ناموفق بود: ' + d.error,
      attempts
        .map(
          a =>
            routeLabel(a.route) + ': ' + (a.err.httpStatus ? 'HTTP ' + a.err.httpStatus : a.err.code || a.err.message)
        )
        .join(' | ')
    );
    this.sse.sendState();
    return false;
  }

  pickKickPusher() {
    const config = this.configStore.config;
    const known = [{ key: config.kick.pusherKey, cluster: config.kick.pusherCluster }, ...this.kickPusherKeys];
    const usable = known.find(c => pusherUrl(c.key, c.cluster) && !this.kickRejected.has(c.key));
    if (usable) return usable;
    if (this.kickLookup) return this.kickLookup;
    if (this.kickLookupAt !== null && this.now() - this.kickLookupAt < KICK_REALTIME_RETRY) return null;
    this.kickLookupAt = this.now();
    const lookup = this.lookupKickPusher(this.connectionGeneration).finally(() => {
      if (this.kickLookup === lookup) this.kickLookup = null;
    });
    this.kickLookup = lookup;
    return lookup;
  }

  async lookupKickPusher(generation) {
    const body = JSON.stringify({
      client: { id: crypto.randomUUID(), type: 'web' },
      capabilities: { accepted_providers: [{ provider: 'pusher' }] }
    });
    const attempts = [];
    try {
      for (const px of await this.rateManager.routesFor(KICK_REALTIME_API, false)) {
        if (this.stopped || generation !== this.connectionGeneration || !this.configStore.config.kick.enabled)
          return null;
        try {
          const r = await this.httpsRequest(
            KICK_REALTIME_API,
            {
              method: 'POST',
              headers: {
                'User-Agent': UA,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
              },
              body,
              proxy: px
            },
            10000
          );
          if (this.stopped || generation !== this.connectionGeneration || !this.configStore.config.kick.enabled)
            return null;
          if (r.status !== 200) {
            const e = new Error('kick realtime api HTTP ' + r.status);
            e.httpStatus = r.status;
            throw e;
          }
          const creds = parseKickRealtime(r.text);
          if (!creds) throw new Error('kick realtime api: no pusher key in the response');
          if (this.kickRejected.has(creds.key)) {
            const e = new Error('kick realtime api: offered the rejected key ' + creds.key);
            e.kind = 'rejected';
            throw e;
          }
          const config = this.configStore.config;
          if (creds.key !== config.kick.pusherKey || creds.cluster !== config.kick.pusherCluster) {
            config.kick.pusherKey = creds.key;
            config.kick.pusherCluster = creds.cluster;
            this.configStore.saveConfig();
          }
          this.logger.info('کلید جدید چت کیک از kick.com گرفته شد', { ...creds, via: routeLabel(px) });
          return creds;
        } catch (e) {
          attempts.push({ route: px, err: e });
          if (e.kind === 'rejected') break;
        }
      }
    } catch (e) {
      attempts.push({ route: '', err: e });
    }
    if (this.stopped || generation !== this.connectionGeneration) return null;
    this.logger.warn(
      'گرفتن کلید چت کیک از kick.com ناموفق بود',
      attempts
        .map(
          a =>
            routeLabel(a.route) + ': ' + (a.err.httpStatus ? 'HTTP ' + a.err.httpStatus : a.err.code || a.err.message)
        )
        .join(' | ')
    );
    return null;
  }

  connect() {
    const config = this.configStore.config;
    clearTimeout(this.kickCloseTimer);
    this.kickCloseTimer = null;
    if (!config.kick.enabled || !config.kick.chatroomId || this.stopped) return;
    if (this.kws && (this.kws.readyState === 0 || this.kws.readyState === 1)) return;
    if (this.connecting) return this.connecting;
    const generation = this.connectionGeneration;
    const creds = this.pickKickPusher();
    if (creds && typeof creds.then === 'function') {
      const pending = creds
        .catch(() => null)
        .then(c => this.openConnection(c, generation))
        .finally(() => {
          if (this.connecting === pending) this.connecting = null;
        });
      this.connecting = pending;
      return pending;
    }
    this.openConnection(creds, generation);
  }

  openConnection(creds, generation) {
    const config = this.configStore.config;
    if (this.stopped || generation !== this.connectionGeneration || !config.kick.enabled || !config.kick.chatroomId)
      return;
    if (this.kws && (this.kws.readyState === 0 || this.kws.readyState === 1)) return;
    if (!creds) {
      if (this.kickState.error !== KICK_KEY_ERROR.error) {
        Object.assign(this.kickState, KICK_KEY_ERROR);
        this.sse.sendState();
      }
      return;
    }
    try {
      this.kws = new this.WebSocketCtor(pusherUrl(creds.key, creds.cluster));
    } catch {
      return;
    }

    const sock = this.kws;
    sock.onmessage = ev => {
      if (this.kws !== sock || this.kickRejected.has(creds.key)) return;
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
        this.kickState.hint = null;
        this.kickRetry = 5000;
        this.logger.info('به چت کیک وصل شد (ساب / ساب‌گیفت)', { channel: config.kick.channel });
        clearInterval(this.kickPing);
        this.kickPing = setInterval(() => {
          try {
            if (this.kws === sock) sock.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          } catch {}
        }, 60000);
        this.sse.sendState();
      } else if (m.event === 'pusher:ping') {
        try {
          sock.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        } catch {}
      } else if (m.event === 'pusher:error') {
        let data = m.data;
        try {
          if (typeof data === 'string') data = JSON.parse(data);
        } catch {}
        const code = Number(data && data.code) || 0;
        if (code >= 4000 && code < 4100) {
          this.kickRejected.add(creds.key);
          this.kickLookupAt = null;
          this.logger.warn('Pusher کلید چت کیک را قبول نکرد؛ کلید جدید از kick.com پرسیده می‌شود', {
            key: creds.key,
            code,
            message: data && data.message
          });
          try {
            sock.close();
          } catch {}
        } else this.logger.warn('pusher error', data);
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
      } else if (/ChatMessageEvent$/.test(m.event || '')) {
        let d = {};
        try {
          d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
        } catch {}
        this.handleChatMessage(d);
      } else if (/KicksGifted/i.test(m.event || '')) {
        let d;
        try {
          d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
        } catch {}
        this.handleKicks(d);
      }
    };

    sock.onerror = () => {};
    sock.onclose = () => {
      if (this.kws !== sock) return;
      this.kws = null;
      clearInterval(this.kickPing);
      if (this.kickState.connected) this.logger.warn('اتصال چت کیک قطع شد؛ تلاش مجدد');
      this.kickState.connected = false;
      this.sse.sendState();
      if (!this.stopped) {
        clearTimeout(this.kickCloseTimer);
        this.kickCloseTimer = setTimeout(() => {
          this.kickCloseTimer = null;
          this.connect();
        }, this.kickRetry);
      }
      this.kickRetry = Math.min(60000, this.kickRetry * 2);
    };
  }

  startKeepAlive() {
    clearInterval(this.checkTimer);
    this.checkTimer = setInterval(() => {
      const config = this.configStore.config;
      if (config.kick.enabled && config.kick.chatroomId && (!this.kws || this.kws.readyState === 3)) {
        this.connect();
      }
    }, 15000);
  }

  resetConnection() {
    ++this.connectionGeneration;
    this.connecting = null;
    this.kickLookup = null;
    this.kickLookupAt = null; // Saving settings retries discovery immediately, including after enabling a VPN.
    clearInterval(this.checkTimer);
    this.checkTimer = null;
    clearTimeout(this.kickCloseTimer);
    this.kickCloseTimer = null;
    clearInterval(this.kickPing);
    this.kickPing = null;
    const socket = this.kws;
    this.kws = null;
    this.kickState = { connected: false, error: null, hint: null };
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
    this.sse.sendState();
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
      source: 'kick',
      kind,
      count,
      months,
      tags,
      toman_override: toman > 0 ? toman : null,
      created_at: new Date().toISOString()
    };
  }

  enqueueLocal(t) {
    this.logger.info(t.kind === 'gift' ? 'ساب‌گیفت' : t.kind === 'command' ? 'دستور چت' : 'ساب جدید', {
      name: t.tipper_name,
      count: t.count,
      months: t.months,
      toman: t.toman_override
    });
    if (this.configStore.config.mode === 'companion') {
      this.queue.showTip(t);
    } else {
      this.queue.enqueueApproved(t);
      this.queue.tryNext();
    }
    this.sse.sendState();
  }

  // Viewer chat command (!dance, ...): plays the mapped alert file, free of charge. Rate limited in three
  // layers (per user, global, per minute) plus a queue-length cap so a spam wave can never flood the overlay.
  handleChatMessage(d) {
    const cfg = this.configStore.config.chatCommands;
    if (!cfg || !cfg.enabled) return;
    const content = cleanText(d && d.content, LIMITS.message).trim();
    if (!content) return;
    const prefix = cfg.prefix || '!';
    if (!content.startsWith(prefix)) return;
    const token = content.slice(prefix.length).split(/\s+/)[0].toLowerCase();
    if (!/^[a-z0-9_-]{1,31}$/.test(token)) return;

    const entry = (cfg.entries || []).find(e => e && e.command === token && e.enabled !== false);
    if (!entry) return;
    const file = this.configStore.config.files.find(f => f.id === entry.fileId && f.enabled !== false);
    if (!file) return;

    const msgId = String((d && d.id) || '');
    if (msgId && this.seenRecently('cmd:' + msgId, 5000)) return;

    const now = Date.now();
    const user = cleanText((d && d.sender && d.sender.username) || 'ناشناس', LIMITS.name) || 'ناشناس';

    const userCd = Math.max(0, Number(cfg.userCooldownSec) || 0) * 1000;
    if (userCd > 0 && now - (this.cmdUsers.get(user) || 0) < userCd) return;
    const globalCd = Math.max(0, Number(cfg.globalCooldownSec) || 0) * 1000;
    if (globalCd > 0 && now - this.cmdLastGlobal < globalCd) return;
    const maxPerMinute = Math.max(1, Number(cfg.maxPerMinute) || 10);
    this.cmdWindow = this.cmdWindow.filter(t => now - t < 60000);
    if (this.cmdWindow.length >= maxPerMinute) return;
    if (this.queue.approved.length + (this.queue.playing ? 1 : 0) >= LIMITS.cmdQueue) return;

    this.cmdUsers.set(user, now);
    if (this.cmdUsers.size > 500) {
      for (const [k, ts] of this.cmdUsers) if (now - ts > 3600000) this.cmdUsers.delete(k);
    }
    this.cmdLastGlobal = now;
    this.cmdWindow.push(now);

    this.logger.info('دستور چت در صف قرار گرفت', { command: token, user, file: file.file });
    this.enqueueLocal({
      stripe_pi_id: 'cmd_' + crypto.randomBytes(6).toString('hex'),
      tipper_name: user,
      amount_total: 0,
      tip_message: prefix + token,
      approval_status: 'approved',
      is_local: true,
      kind: 'command',
      count: null,
      months: null,
      tags: [token, 'command'],
      toman_override: 0,
      commandFileId: entry.fileId,
      created_at: new Date().toISOString()
    });
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
    else this.notifySupport(t);
    this.enqueueLocal(t);
  }

  handleSub(name, months = 1, isTest = false) {
    const config = this.configStore.config;
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
    else this.notifySupport(t);
    if (!config.kick.showNewSubs && !isTest) return;
    this.enqueueLocal(t);
  }

  handleKicks(d) {
    if (!d || typeof d !== 'object') return;
    const amount = finite((d.gift && d.gift.amount) || d.amount || d.kicks, 0, 1e7, 0);
    if (!amount) return;
    const name =
      cleanText((d.sender && (d.sender.username || d.sender.name)) || d.username, LIMITS.name) || 'Anonymous';
    const eventId = String(d.id || d.gift_transaction_id || d.transaction_id || (d.gift && d.gift.transaction_id) || '')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 64);
    if (this.seenRecently('kicks:' + (eventId || name + ':' + amount))) return;
    this.notifySupport({
      stripe_pi_id: 'kicks_' + (eventId || crypto.randomBytes(6).toString('hex')),
      tipper_name: name,
      source: 'kick',
      kind: 'kicks',
      is_local: true,
      currency: 'USD',
      amount_total: Math.round(amount * 0.0105 * 100),
      bridge_usd: amount * 0.0105,
      count: amount
    });
  }

  notifySupport(t) {
    if (!this.onSupport) return;
    try {
      this.onSupport(t);
    } catch (e) {
      this.logger.warn('Kick support callback failed', e.message);
    }
  }

  stop() {
    this.stopped = true;
    ++this.connectionGeneration;
    this.connecting = null;
    this.kickLookup = null;
    clearInterval(this.kickPing);
    clearInterval(this.checkTimer);
    clearTimeout(this.kickCloseTimer);
    this.kickCloseTimer = null;
    const socket = this.kws;
    this.kws = null;
    this.kickState.connected = false;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
  }
}

module.exports = {
  KickChatClient,
  pusherUrl,
  parseKickRealtime,
  KICK_PUSHER_KEYS
};

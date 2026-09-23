'use strict';
const crypto = require('crypto');
const { LIMITS, UA, DEFAULT_CONFIG } = require('../constants');
const { cleanText, finite } = require('../utils/validation');
const { httpsRequest } = require('../utils/http-client');

const SE_WS = 'wss://astro.streamelements.com';
const SE_ME = 'https://api.streamelements.com/kappa/v2/channels/me';

function seTokenOk(token) {
  const value = String(token || '').trim();
  if (value.length < 40 || value.length > 4000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
    return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    return !!payload && typeof payload === 'object' && !Array.isArray(payload);
  } catch {
    return false;
  }
}

function parseSeActivity(activity) {
  if (!activity || typeof activity !== 'object' || String(activity.type || '').toLowerCase() !== 'tip') return null;
  const data = activity.data && typeof activity.data === 'object' ? activity.data : {};
  const id = String(activity._id || data.tipId || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 64);
  if (!id) return null;
  const amount = finite(data.amount, 0, 1e9, 0);
  const rawCurrency = String(data.currency || '');
  const currency = /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : 'USD';
  const created =
    typeof activity.createdAt === 'string' && Number.isFinite(Date.parse(activity.createdAt))
      ? activity.createdAt
      : new Date().toISOString();
  return {
    stripe_pi_id: 'se_' + id,
    tipper_name: cleanText(data.displayName || data.username || data.name, LIMITS.name) || 'ناشناس',
    tip_message: cleanText(data.message, LIMITS.message),
    amount_total: Math.round(amount * 100),
    currency,
    approval_status: 'approved',
    is_local: true,
    is_test: !!(activity.isMock || activity.mock || data.isMock || activity.test || data.test),
    kind: 'tip',
    count: null,
    tags: [],
    toman_override: null,
    source: 'streamelements',
    created_at: created
  };
}

class StreamElementsClient {
  constructor({
    configStore,
    rateManager,
    queue,
    playedStore,
    logger,
    sse,
    WebSocketCtor = globalThis.WebSocket,
    fetchProfile = null
  }) {
    this.configStore = configStore;
    this.rateManager = rateManager;
    this.queue = queue;
    this.playedStore = playedStore;
    this.logger = logger;
    this.sse = sse;
    this.WebSocketCtor = WebSocketCtor;
    this.fetchProfile = fetchProfile;
    this.socket = null;
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.reconnectToken = '';
    this.subscribed = false;
    this.error = null;
    this.stopped = false;
  }

  configured() {
    return !!(this.configStore.seToken && this.configStore.config.se && this.configStore.config.se.channelId);
  }

  status() {
    if (!this.configured()) return 'unconfigured';
    if (this.error) return 'error';
    if (this.socket && this.socket.readyState === 1 && this.subscribed) return 'connected';
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return 'connecting';
    return 'reconnecting';
  }

  publicState() {
    return {
      configured: this.configured(),
      status: this.status(),
      username: this.configStore.config.se.username,
      provider: this.configStore.config.se.provider,
      error: this.error
    };
  }

  emitState() {
    this.sse.sendState();
  }

  async verifyToken(token) {
    const value = String(token || '').trim();
    if (!seTokenOk(value)) return { ok: false, rejected: true, error: 'invalid token' };
    let me = null;
    let lastError = null;
    if (this.fetchProfile) {
      try {
        me = await this.fetchProfile(value);
      } catch (error) {
        lastError = error;
      }
    } else {
      let routes = [''];
      try {
        routes = await this.rateManager.routesFor(SE_ME, true);
      } catch {}
      for (const proxy of routes) {
        try {
          const response = await httpsRequest(
            SE_ME,
            {
              headers: { Authorization: 'Bearer ' + value, Accept: 'application/json', 'User-Agent': UA },
              proxy
            },
            15000
          );
          if (response.status === 401 || response.status === 403) {
            return { ok: false, rejected: true, error: 'rejected' };
          }
          if (response.status !== 200) throw new Error('HTTP ' + response.status);
          me = JSON.parse(response.text);
          break;
        } catch (error) {
          lastError = error;
        }
      }
    }
    if (!me) return { ok: false, rejected: false, error: lastError ? lastError.message : 'unknown' };
    const channelId = String(me._id || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 64);
    if (!channelId) return { ok: false, rejected: true, error: 'missing channel id' };
    return {
      ok: true,
      channelId,
      username: cleanText(me.username || me.displayName || '', 60) || null,
      provider: cleanText(me.provider || '', 20) || null
    };
  }

  connect() {
    if (this.stopped || !this.configured() || typeof this.WebSocketCtor !== 'function') return;
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    this.subscribed = false;
    let socket;
    try {
      const url = this.reconnectToken ? SE_WS + '/?reconnect_token=' + encodeURIComponent(this.reconnectToken) : SE_WS;
      socket = new this.WebSocketCtor(url);
    } catch (error) {
      this.logger.error('StreamElements WebSocket create failed', error.message);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === 0) {
        try {
          socket.close();
        } catch {}
      }
    }, 15000);
    socket.onopen = () => {
      if (this.socket === socket) clearTimeout(this.connectionTimer);
    };
    socket.onmessage = event => this.handleSocketMessage(socket, event && event.data);
    socket.onerror = () => {};
    socket.onclose = event => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      this.socket = null;
      const wasSubscribed = this.subscribed;
      this.subscribed = false;
      if (wasSubscribed && this.configured() && !this.stopped) {
        this.logger.warn('StreamElements connection closed; reconnecting', { code: event && event.code });
      }
      this.emitState();
      if (!this.error) this.scheduleReconnect(this.reconnectToken ? 500 : 5000);
    };
    this.emitState();
  }

  handleSocketMessage(socket, raw) {
    if (socket !== this.socket) return;
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'welcome') {
      this.reconnectToken = '';
      try {
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            nonce: crypto.randomUUID(),
            data: {
              topic: 'channel.activities',
              room: this.configStore.config.se.channelId,
              token: this.configStore.seToken,
              token_type: 'jwt'
            }
          })
        );
      } catch (error) {
        this.logger.warn('StreamElements subscription request failed', error.message);
      }
      return;
    }
    if (message.type === 'response') {
      if (message.error) {
        const detail = String((message.data && message.data.message) || message.error).slice(0, 160);
        this.error = /unauth|signature|expired|invalid/i.test(detail)
          ? 'StreamElements token rejected; enter a current JWT token'
          : 'StreamElements: ' + detail;
        this.logger.warn('StreamElements subscription failed', {
          error: String(message.error).slice(0, 60),
          message: detail
        });
        try {
          socket.close();
        } catch {}
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 5 * 60 * 1000);
      } else {
        this.subscribed = true;
        this.error = null;
        this.logger.info('Connected to StreamElements', {
          username: this.configStore.config.se.username,
          provider: this.configStore.config.se.provider
        });
      }
      this.emitState();
      return;
    }
    if (message.type === 'reconnect') {
      this.reconnectToken = String((message.data && message.data.token) || message.token || '').slice(0, 2048);
      try {
        socket.close();
      } catch {}
      return;
    }
    if (message.type === 'message' && String(message.topic || '') === 'channel.activities') {
      this.handleActivity(message.data);
    }
  }

  handleActivity(activity) {
    const tip = parseSeActivity(activity);
    if (!tip) return false;
    if (
      this.playedStore.isPlayed(tip.stripe_pi_id) ||
      this.queue.approved.some(item => item.stripe_pi_id === tip.stripe_pi_id) ||
      this.queue.pending.some(item => item.stripe_pi_id === tip.stripe_pi_id) ||
      (this.queue.playing && this.queue.playing.stripe_pi_id === tip.stripe_pi_id)
    )
      return false;
    this.logger.info('StreamElements donation received', this.queue.tipSummary(tip));
    if (this.configStore.config.mode === 'companion') {
      this.playedStore.markPlayed(tip.stripe_pi_id);
      this.queue.showTip(tip);
    } else {
      this.queue.enqueueApproved(tip);
      this.queue.tryNext();
    }
    this.emitState();
    return true;
  }

  scheduleReconnect(delayMs = 5000) {
    clearTimeout(this.reconnectTimer);
    if (!this.stopped && this.configured()) this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  resetConnection() {
    this.reconnectToken = '';
    this.error = null;
    this.subscribed = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
    this.emitState();
  }

  disconnect({ clearAccount = true } = {}) {
    this.configStore.setSeToken('');
    if (clearAccount) this.configStore.config.se = { ...DEFAULT_CONFIG.se };
    this.resetConnection();
  }

  reloadAfterRestore() {
    this.resetConnection();
    if (this.configured()) this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    const socket = this.socket;
    this.socket = null;
    this.subscribed = false;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
  }
}

module.exports = { StreamElementsClient, parseSeActivity, seTokenOk, SE_ME, SE_WS };

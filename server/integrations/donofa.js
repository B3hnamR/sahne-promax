'use strict';
const { LIMITS, UA } = require('../constants');
const net = require('net');
const { cleanText, finite } = require('../utils/validation');
const { httpsRequest } = require('../utils/http-client');

const DONOFA_WS = 'wss://ws.donofa.com/app/AF5Ed2JK?protocol=7&client=js&version=8.5.0';
const DONOFA_API = { ir: 'https://api.donofa.ir', com: 'https://api.donofa.com' };

function donationId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function donofaAudioUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    if (net.isIP(host)) {
      if (net.isIP(host) === 6) return null;
      const [a, b] = host.split('.').map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      )
        return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function parseDonofaActivity(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const item = activity.data && typeof activity.data === 'object' && activity.data.id ? activity.data : activity;
  const id = donationId(item.id);
  if (!id) return null;
  const status = String(item.status || '').toLowerCase();
  if (status && !['paid', 'success', 'successful', 'completed', 'approved'].includes(status)) return null;
  const currency = String(item.currency || 'IRT').toUpperCase();
  if (!['IRT', 'TMN', 'TOMAN', 'IRR'].includes(currency)) return null;
  const rawAmount = finite(item.amount, 0, 1e12, 0);
  const toman = currency === 'IRR' ? rawAmount / 10 : rawAmount;
  if (toman <= 0) return null;
  const addons = item.addons && typeof item.addons === 'object' ? item.addons : {};
  return {
    stripe_pi_id: 'donofa_' + id,
    tipper_name: cleanText(item.name || item.username || item.displayName, LIMITS.name) || 'ناشناس',
    tip_message: cleanText(item.message, LIMITS.message),
    amount_total: Math.round(toman * 100),
    currency: 'IRT',
    approval_status: 'approved',
    is_local: true,
    is_test: !!(item.is_test || item.test || item.isMock || item.mock),
    kind: 'tip',
    count: null,
    tags: [],
    toman_override: toman,
    source: 'donofa',
    audio_url: donofaAudioUrl(item.voice_url || item.audio_url || item.tts_url || addons.voice_url || addons.tts_url),
    created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString()
  };
}

function parseSocketData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

class DonofaClient {
  constructor({
    configStore,
    rateManager,
    queue,
    playedStore,
    logger,
    sse,
    WebSocketCtor = globalThis.WebSocket,
    verifyKeyFn = null
  }) {
    this.configStore = configStore;
    this.rateManager = rateManager;
    this.queue = queue;
    this.playedStore = playedStore;
    this.logger = logger;
    this.sse = sse;
    this.WebSocketCtor = WebSocketCtor;
    this.verifyKeyFn = verifyKeyFn;
    this.socket = null;
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.pingTimer = null;
    this.subscribed = false;
    this.error = null;
    this.stopped = false;
    this.pendingTts = new Map();
  }

  configured() {
    return !!this.configStore.donofaKey;
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
      endpoint: this.configStore.config.donofa.endpoint,
      error: this.error
    };
  }

  async verifyKey(key, endpoint) {
    if (!this.configStore.isValidDonofaKey(key)) return { ok: false, rejected: true };
    if (this.verifyKeyFn) return this.verifyKeyFn(key, endpoint);
    const url = DONOFA_API[endpoint] + '/api/v2/donates?limit=1';
    let routes = [''];
    try {
      routes = await this.rateManager.routesFor(url, true);
    } catch {}
    let lastError = null;
    for (const proxy of routes) {
      try {
        const response = await httpsRequest(
          url,
          { headers: { Authorization: 'Api ' + key, Accept: 'application/json', 'User-Agent': UA }, proxy },
          15000
        );
        if (response.status === 401 || response.status === 403) return { ok: false, rejected: true };
        if (response.status !== 200) throw new Error('HTTP ' + response.status);
        return { ok: true };
      } catch (error) {
        lastError = error;
      }
    }
    return { ok: false, rejected: false, error: lastError ? lastError.message : 'network error' };
  }

  connect() {
    if (this.stopped || !this.configured() || typeof this.WebSocketCtor !== 'function') return;
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    let socket;
    try {
      socket = new this.WebSocketCtor(DONOFA_WS);
    } catch (error) {
      this.logger.warn('Donofa WebSocket create failed', error.message);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.subscribed = false;
    this.connectionTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === 0) socket.close();
    }, 15000);
    socket.onopen = () => {
      if (this.socket === socket) clearTimeout(this.connectionTimer);
    };
    socket.onmessage = event => this.handleSocketMessage(socket, event && event.data);
    socket.onerror = () => {};
    socket.onclose = event => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      clearInterval(this.pingTimer);
      this.socket = null;
      const wasSubscribed = this.subscribed;
      this.subscribed = false;
      if (wasSubscribed && this.configured() && !this.stopped)
        this.logger.warn('اتصال دونوفا قطع شد؛ تلاش مجدد', { code: event && event.code });
      this.sse.sendState();
      this.scheduleReconnect();
    };
    this.sse.sendState();
  }

  handleSocketMessage(socket, raw) {
    if (socket !== this.socket) return;
    const message = parseSocketData(raw);
    if (!message || typeof message !== 'object') return;
    if (message.event === 'pusher:connection_established') {
      try {
        socket.send(
          JSON.stringify({ event: 'pusher:subscribe', data: { channel: 'user.' + this.configStore.donofaKey } })
        );
      } catch {
        socket.close();
      }
      return;
    }
    if (message.event === 'pusher:subscription_succeeded') {
      this.subscribed = true;
      this.error = null;
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (socket === this.socket && socket.readyState === 1) {
          try {
            socket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          } catch {
            socket.close();
          }
        }
      }, 30000);
      this.logger.info('به دونوفا وصل شد');
      this.sse.sendState();
      return;
    }
    if (message.event === 'pusher:ping') {
      try {
        socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      } catch {
        socket.close();
      }
      return;
    }
    if (message.event === 'pusher:error' || message.event === 'pusher:subscription_error') {
      this.error = 'دونوفا اشتراک رویداد را رد کرد؛ کلید API را بررسی کنید';
      this.logger.warn('Donofa subscription failed');
      this.sse.sendState();
      try {
        socket.close();
      } catch {}
      return;
    }
    if (!this.subscribed) return;
    if (message.event === 'donate.created' || message.event === '.donate.created')
      this.handleActivity(parseSocketData(message.data));
    if (message.event === 'tts.created' || message.event === '.tts.created')
      this.handleTts(parseSocketData(message.data));
  }

  handleActivity(activity) {
    const tip = parseDonofaActivity(activity);
    if (!tip) return false;
    const cached = this.pendingTts.get(tip.stripe_pi_id);
    if (cached && cached.expires > Date.now() && !tip.audio_url) tip.audio_url = cached.url;
    this.pendingTts.delete(tip.stripe_pi_id);
    if (
      this.playedStore.isPlayed(tip.stripe_pi_id) ||
      this.queue.approved.some(item => item.stripe_pi_id === tip.stripe_pi_id) ||
      this.queue.pending.some(item => item.stripe_pi_id === tip.stripe_pi_id) ||
      (this.queue.playing && this.queue.playing.stripe_pi_id === tip.stripe_pi_id)
    )
      return false;
    this.logger.info('دونیت دونوفا دریافت شد', this.queue.tipSummary(tip));
    if (this.configStore.config.mode === 'companion') {
      this.playedStore.markPlayed(tip.stripe_pi_id);
      this.queue.showTip(tip);
    } else {
      this.queue.enqueueApproved(tip);
      this.queue.tryNext();
    }
    this.sse.sendState();
    return true;
  }

  handleTts(activity) {
    if (!activity || typeof activity !== 'object') return false;
    const data = activity.data && typeof activity.data === 'object' ? activity.data : activity;
    let id = donationId(
      data.donate_id || data.donation_id || data.donateId || data.donationId || data.donate?.id || data.donation?.id
    );
    const url = donofaAudioUrl(data.url || data.voice_url || data.tts_url);
    if (!url) return false;
    if (!id) {
      const candidates = [this.queue.playing, ...this.queue.approved].filter(
        t => t && t.source === 'donofa' && !t.audio_url
      );
      if (candidates.length !== 1) return false;
      id = candidates[0].stripe_pi_id.slice('donofa_'.length);
    }
    const fullId = 'donofa_' + id;
    const pending = this.queue.approved.find(item => item.stripe_pi_id === fullId);
    if (pending) {
      pending.audio_url = url;
      return true;
    }
    if (this.queue.playing && this.queue.playing.stripe_pi_id === fullId) {
      this.queue.playing.audio_url = url;
      this.sse.broadcast('overlay', { type: 'tts_update', id: fullId, url });
      return true;
    }
    if (this.pendingTts.size >= 100) this.pendingTts.delete(this.pendingTts.keys().next().value);
    this.pendingTts.set(fullId, { url, expires: Date.now() + 60000 });
    return true;
  }

  scheduleReconnect(delayMs = 5000) {
    clearTimeout(this.reconnectTimer);
    if (!this.stopped && this.configured() && !this.error)
      this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  resetConnection() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    clearInterval(this.pingTimer);
    this.pendingTts.clear();
    const socket = this.socket;
    this.socket = null;
    this.subscribed = false;
    this.error = null;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
    this.sse.sendState();
  }

  disconnect() {
    this.configStore.setDonofaKey('');
    this.configStore.config.donofa = { endpoint: 'ir' };
    this.resetConnection();
  }

  reloadAfterRestore() {
    this.resetConnection();
    if (this.configured()) this.connect();
  }

  stop() {
    this.stopped = true;
    this.resetConnection();
  }
}

module.exports = { DonofaClient, parseDonofaActivity, donofaAudioUrl, DONOFA_API, DONOFA_WS };

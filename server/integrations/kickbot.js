'use strict';
const { KB_WS, KB_API, LIMITS } = require('../constants');
const { cleanText, finite, httpsUrl } = require('../utils/validation');

class KickBotClient {
  constructor({ configStore, playedStore, queue, logger, sse }) {
    this.configStore = configStore;
    this.playedStore = playedStore;
    this.queue = queue;
    this.logger = logger;
    this.sse = sse;

    this.ws = null;
    this.reconnectTimer = null;
    this.pulseTimer = null;
    this.syncTimer = null;
    this.keepAliveCheck = null;
    this.stopped = false;
    this.connectionGeneration = 0;
    this.connTimer = null;
  }

  status() {
    const secret = this.configStore.getSecret();
    const streamerId = this.configStore.config.streamer_id;
    if (!secret || !streamerId) return 'unconfigured';
    if (this.ws && this.ws.readyState === 1) return 'connected';
    if (this.ws && this.ws.readyState === 0) return 'connecting';
    return 'reconnecting';
  }

  isConnected() {
    return !!(this.ws && this.ws.readyState === 1);
  }

  connect() {
    if (this.stopped) return;
    const secret = this.configStore.getSecret();
    const streamerId = this.configStore.config.streamer_id;
    if (!secret || !streamerId) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;

    try {
      this.ws = new WebSocket(KB_WS);
    } catch (e) {
      this.logger.error('WebSocket create failed', e.message);
      return this.scheduleReconnect();
    }

    const socket = this.ws;

    const connTimeout = setTimeout(() => {
      if (this.ws === socket && socket.readyState === 0) {
        try {
          socket.close();
        } catch {}
      }
    }, 10000);
    this.connTimer = connTimeout;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      clearTimeout(connTimeout);
      this.connTimer = null;
      this.logger.info('به کیک‌بات وصل شد', { channel: 'tipping_' + streamerId });
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'tipping_' + streamerId, authorization: secret }));
      clearInterval(this.pulseTimer);
      this.pulseTimer = setInterval(() => this.publish('pulse', {}), 3000);
      this.sse.sendState();
      this.syncQueue();
    };

    socket.onmessage = ev => {
      if (this.ws !== socket) return;
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      const d = m && m.data;
      if (!d || typeof d !== 'object') return;
      this.handleEvent(String(d.event_type || ''), d.payload && typeof d.payload === 'object' ? d.payload : {});
    };

    socket.onerror = () => {};

    socket.onclose = ev => {
      if (this.ws !== socket) return;
      this.ws = null;
      clearTimeout(connTimeout);
      this.connTimer = null;
      clearInterval(this.pulseTimer);
      this.logger.warn('اتصال کیک‌بات قطع شد، تلاش مجدد تا ۵ ثانیه دیگر', { code: ev.code });
      this.sse.sendState();
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    if (!this.stopped) {
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  startKeepAlive() {
    clearInterval(this.keepAliveCheck);
    clearInterval(this.syncTimer);
    this.keepAliveCheck = setInterval(() => {
      if (!this.ws || this.ws.readyState === 3) this.connect();
    }, 10000);

    this.syncTimer = setInterval(() => {
      if (this.isConnected()) this.syncQueue();
    }, 60000);
  }

  publish(event_type, payload) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const secret = this.configStore.getSecret();
    const streamerId = this.configStore.config.streamer_id;
    this.ws.send(
      JSON.stringify({
        channel: 'tipping_' + streamerId,
        authorization: secret,
        type: 'publish',
        data: { event_type, payload }
      })
    );
  }

  normalizeTip(p) {
    return {
      stripe_pi_id: String(p.stripe_pi_id || ''),
      tipper_name: cleanText(p.tipper_name, LIMITS.name),
      tip_message: cleanText(p.tip_message, LIMITS.message),
      amount_total: finite(p.amount_total, 0, 1e12, 0),
      approval_status: String(p.approval_status || ''),
      is_replay: !!p.is_replay,
      is_test: !!p.is_test,
      gif_url: httpsUrl(p.gif_url),
      audio_url: httpsUrl(p.audio_url),
      created_at: p.created_at
    };
  }

  handleEvent(type, raw) {
    if (type === 'pulse') return;
    const p = type.startsWith('tip_') ? this.normalizeTip(raw) : raw;
    if (type !== 'tip_play' && type !== 'tip_end') {
      this.logger.info('ایونت: ' + type, type.startsWith('tip_') ? this.queue.tipSummary(p) : p);
    }

    switch (type) {
      case 'tip_queue_config_updated':
        this.queue.queueMode = p.queue_mode ?? this.queue.queueMode;
        this.queue.queueDelay = finite(p.queue_delay, 0, 600, this.queue.queueDelay);
        this.queue.queueStatus = p.queue_status ?? this.queue.queueStatus;
        this.queue.tippingEnabled = p.is_active ?? this.queue.tippingEnabled;
        break;
      case 'queue_play':
        this.queue.queueStatus = 'play';
        this.queue.tryNext();
        break;
      case 'queue_pause':
        this.queue.queueStatus = 'pause';
        break;
      case 'queue_clear':
        this.queue.pending = [];
        this.queue.approved = [];
        break;
      case 'tip_initiated':
        if (!p.stripe_pi_id) break;
        if (p.approval_status === 'pending') this.queue.pending.push(p);
        else if (p.approval_status === 'approved') {
          this.queue.enqueueApproved(p);
          this.queue.tryNext();
        }
        break;
      case 'tip_approved': {
        const t = this.queue.pending.find(x => x.stripe_pi_id === p.stripe_pi_id);
        if (t) {
          this.queue.pending = this.queue.pending.filter(x => x.stripe_pi_id !== p.stripe_pi_id);
          this.queue.enqueueApproved(t);
          this.queue.tryNext();
        }
        break;
      }
      case 'tip_rejected':
        this.queue.pending = this.queue.pending.filter(x => x.stripe_pi_id !== p.stripe_pi_id);
        this.queue.approved = this.queue.approved.filter(x => x.stripe_pi_id !== p.stripe_pi_id);
        if (this.queue.playing && this.queue.playing.stripe_pi_id === p.stripe_pi_id) {
          this.sse.broadcast('overlay', { type: 'stop' });
          this.queue.finishPlaying(p.stripe_pi_id, true);
        }
        break;
      case 'tip_play':
        if (this.configStore.config.mode === 'companion') {
          const t = [...this.queue.approved, ...this.queue.pending].find(x => x.stripe_pi_id === p.stripe_pi_id);
          if (t && !this.playedStore.isPlayed(t.stripe_pi_id)) {
            this.playedStore.markPlayed(t.stripe_pi_id);
            this.queue.showTip(t);
          }
        }
        break;
    }

    if (this.queue.pending.length > 500) this.queue.pending = this.queue.pending.slice(-500);
    this.queue.trimApproved(500);
    this.sse.sendState();
  }

  async syncQueue() {
    const secret = this.configStore.getSecret();
    if (!secret) return;
    const generation = this.connectionGeneration;
    try {
      const r = await fetch(`${KB_API}/api/tip_queue_sync?secret_id=${encodeURIComponent(secret)}`, {
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) return;
      const j = await r.json();
      // A restore/disconnect that happened while this request was in flight must
      // win: never repopulate the queue with the previous account's tips.
      if (generation !== this.connectionGeneration) return;
      const list = (Array.isArray(j.tip_transactions) ? j.tip_transactions : [])
        .map(t => this.normalizeTip(t))
        .filter(t => t.stripe_pi_id);
      const pendIds = new Set(this.queue.pending.map(t => t.stripe_pi_id));
      const apprIds = new Set(this.queue.approved.map(t => t.stripe_pi_id));

      for (const t of list) {
        const id = t.stripe_pi_id;
        if ((this.queue.playing && this.queue.playing.stripe_pi_id === id) || this.playedStore.isPlayed(id)) continue;
        if (t.approval_status === 'approved') {
          if (pendIds.has(id)) {
            this.queue.pending = this.queue.pending.filter(x => x.stripe_pi_id !== id);
            this.queue.enqueueApproved(t);
          } else if (!apprIds.has(id)) {
            this.queue.enqueueApproved(t);
          }
        } else if (t.approval_status === 'pending' && !pendIds.has(id) && !apprIds.has(id)) {
          this.queue.pending.push(t);
        }
      }
      this.sse.sendState();
      this.queue.tryNext();
    } catch {}
  }

  disconnect() {
    this.configStore.setSecret('');
    this.configStore.config.streamer_id = null;
    this.configStore.saveConfig();
    this.resetConnection();
    // The queue is shared with Kick subscriptions and other tip providers.
    const belongsToKickBot = tip => (tip.source || (tip.is_local ? 'kick' : 'kickbot')) === 'kickbot' && !tip.is_test;
    this.queue.pending = this.queue.pending.filter(tip => !belongsToKickBot(tip));
    this.queue.approved = this.queue.approved.filter(tip => !belongsToKickBot(tip));
    this.sse.sendState();
    this.logger.info('اتصال کیک‌بات حذف شد');
  }

  resetConnection() {
    ++this.connectionGeneration;
    clearTimeout(this.connTimer);
    this.connTimer = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearInterval(this.pulseTimer);
    this.pulseTimer = null;
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try {
        socket.close();
      } catch {}
    }
    this.sse.sendState();
  }

  stop() {
    this.stopped = true;
    ++this.connectionGeneration;
    clearTimeout(this.connTimer);
    this.connTimer = null;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pulseTimer);
    clearInterval(this.syncTimer);
    clearInterval(this.keepAliveCheck);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

module.exports = {
  KickBotClient
};

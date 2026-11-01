'use strict';
const { createDonofaBridge: createCoreBridge } = require('../donofa');
const { DONOFA_API } = require('./donofa');
const { KICK_SUB_USD, LIMITS, UA } = require('../constants');
const { cleanText } = require('../utils/validation');
const { httpsRequest } = require('../utils/http-client');
const crypto = require('crypto');

function createDonofaRequest({ configStore, rateManager, httpRequest = httpsRequest }) {
  return async (method, pathname, body, key = configStore.getDonofaKey()) => {
    const endpoint = configStore.config.donofa?.endpoint === 'com' ? 'com' : 'ir';
    const url = DONOFA_API[endpoint] + pathname;
    const payload = body == null ? null : JSON.stringify(body);
    const routes = await rateManager.routesFor(url, true);
    let lastError;
    for (const proxy of routes) {
      try {
        const response = await httpRequest(
          url,
          {
            method,
            proxy,
            body: payload,
            headers: {
              Authorization: 'Api ' + key,
              Accept: 'application/json',
              'User-Agent': UA,
              ...(payload == null
                ? {}
                : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
            }
          },
          15000
        );
        let json = null;
        try {
          json = JSON.parse(response.text);
        } catch {}
        return { status: response.status, json };
      } catch (error) {
        lastError = error;
        // The bridge journals ambiguous mutations. Never resend a POST on another route, even after a timeout.
        if (method !== 'GET') throw error;
      }
    }
    throw lastError || new Error('Donofa is unreachable');
  };
}

function createDonofaBridge({
  dataDir,
  configStore,
  rateManager,
  logger,
  sse,
  WebSocketCtor = globalThis.WebSocket,
  request,
  httpRequest,
  now,
  pollMs
}) {
  const bridge = createCoreBridge({
    dataDir,
    getKey: () => configStore.getDonofaKey(),
    getSettings: () => ({
      timer: configStore.config.donofa?.timer === true,
      goal: configStore.config.donofa?.goal === true
    }),
    getRate: () => rateManager.currentRate(),
    request: request || createDonofaRequest({ configStore, rateManager, httpRequest }),
    log: (level, message, detail) => logger?.[level]?.(message, detail),
    onChange: () => sse?.sendState(),
    WebSocket: WebSocketCtor,
    now,
    pollMs
  });
  bridge.accountId = () =>
    crypto
      .createHash('sha256')
      .update(configStore.getDonofaKey() || 'unconfigured')
      .digest('hex');
  return bridge;
}

function createDonofaFeed({ bridge, rateManager }) {
  return (tip, { confirmed = false } = {}) => {
    if (!tip || tip.is_test || tip.is_replay) return false;
    if (tip.bridge_forwarded === true) return false;
    const source = String(tip.source || (tip.is_local ? 'kick' : 'kickbot')).toLowerCase();
    const kind = String(tip.kind || 'tip').toLowerCase();
    if (['donofa', 'command', 'commands', 'test'].includes(source) || kind === 'command') return false;
    if (!['tip', 'sub', 'gift', 'kicks'].includes(kind)) return false;
    const account = bridge.accountId?.();
    if (account) {
      if (tip.bridge_account && tip.bridge_account !== account) return false;
      tip.bridge_account = account;
    }
    if (source === 'kickbot' && !tip.captured && !confirmed) return false;
    const id = cleanText(tip.stripe_pi_id, 80).trim();
    if (!id) return false;
    const count = kind === 'gift' ? Math.max(1, Math.round(Number(tip.count) || 1)) : 1;
    const amount =
      kind === 'kicks' && Number.isFinite(tip.bridge_usd) ? tip.bridge_usd : Number(tip.amount_total || 0) / 100;
    const currency = String(tip.currency || 'USD').toUpperCase();
    const toman = tip.toman_override != null ? Number(tip.toman_override) : rateManager.tomanFor(amount, currency);
    const usd = kind === 'sub' || kind === 'gift' ? KICK_SUB_USD * count : currency === 'USD' ? amount : null;
    const accepted = bridge.add({
      id,
      kind,
      name: cleanText(tip.tipper_name, LIMITS.name).trim(),
      toman: Number.isFinite(toman) && toman > 0 ? toman : null,
      usd: Number.isFinite(usd) && usd > 0 ? usd : null,
      count
    });
    if (accepted) tip.bridge_forwarded = true;
    return accepted;
  };
}

module.exports = { createDonofaBridge, createDonofaRequest, createDonofaFeed };

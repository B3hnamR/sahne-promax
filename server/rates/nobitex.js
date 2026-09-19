'use strict';
const { NOBITEX, UA } = require('../constants');
const { httpsRequest } = require('../utils/http-client');

function parseNobitex(input) {
  let j;
  try {
    j = typeof input === 'object' && input !== null ? input : JSON.parse(input);
  } catch {
    throw new Error('nobitex json unparsable');
  }
  if (j.status !== 'ok') {
    throw new Error('nobitex status: ' + (j.status || 'unknown'));
  }

  // Nobitex orderbook provides lastTradePrice, bids, and asks in Iranian Rials (IRR)
  const p =
    j.lastTradePrice ||
    (j.bids && j.bids[0] && j.bids[0][0]) ||
    (j.asks && j.asks[0] && j.asks[0][0]);

  if (!p) throw new Error('nobitex: no price found in orderbook');

  const rials = Number(String(p).replace(/,/g, ''));
  if (!Number.isFinite(rials) || rials < 10000 || rials > 1e11) {
    throw new Error('nobitex price out of range: ' + String(p).slice(0, 20));
  }

  // Convert Iranian Rials to Toman (1 Toman = 10 Rials)
  const toman = Math.round(rials / 10);
  if (toman < 1000 || toman > 1e10) {
    throw new Error('nobitex toman out of range: ' + toman);
  }
  return toman;
}

async function fetchNobitex(proxy = '') {
  const attempt = async px => {
    const r = await httpsRequest(
      NOBITEX,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, proxy: px },
      10000
    );
    if (r.status !== 200) throw new Error('nobitex HTTP ' + r.status);
    return parseNobitex(r.text);
  };

  const cleanProxy = (proxy || '').trim();
  const order = ['', ...(cleanProxy ? [cleanProxy] : [])];
  let lastErr;
  for (const px of order) {
    try {
      return await attempt(px);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

module.exports = {
  fetchNobitex,
  parseNobitex
};

'use strict';
const { BAHA24, UA } = require('../constants');
const { httpsRequest } = require('../utils/http-client');

const FX_CODES = [
  'EUR',
  'GBP',
  'AED',
  'TRY',
  'CAD',
  'CHF',
  'RUB',
  'CNY',
  'INR',
  'SGD',
  'NOK',
  'SEK',
  'DKK',
  'AUD',
  'THB',
  'KWD',
  'MYR',
  'OMR',
  'JPY',
  'AZN',
  'AFN'
];

function sanitizeFx(fx) {
  const out = {};
  if (!fx || typeof fx !== 'object' || Array.isArray(fx)) return out;
  for (const code of FX_CODES) {
    const value = Number(fx[code]);
    if (Number.isFinite(value) && value >= 10 && value <= 1e9) out[code] = Math.round(value);
  }
  return out;
}

function parseBaha24(input) {
  let j;
  try {
    j = typeof input === 'object' && input !== null ? input : JSON.parse(input);
  } catch {
    throw new Error('baha24 json unparsable');
  }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
  if (!list) throw new Error('baha24: price list not found');
  const usd = list.find(x => x && String(x.symbol).toUpperCase() === 'USD');
  if (!usd) throw new Error('baha24: USD not in response');
  const value = Number(String(usd.sell).replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 1000 || value > 1e9) {
    throw new Error('baha24 sell out of range: ' + String(usd.sell).slice(0, 20));
  }
  const fx = {};
  for (const item of list) {
    const code = item && String(item.symbol || '').toUpperCase();
    if (!FX_CODES.includes(code)) continue;
    const rate = Number(String(item.sell).replace(/,/g, ''));
    if (Number.isFinite(rate) && rate >= 10 && rate <= 1e9) fx[code] = Math.round(rate);
  }
  return { usd: Math.round(value), fx };
}

// routes: ordered, de-duplicated proxies to try ('' = direct). When omitted, a direct request only.
async function fetchBaha24Quote(proxyOrRoutes = '') {
  const attempt = async px => {
    const r = await httpsRequest(
      BAHA24,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, proxy: px },
      10000
    );
    if (r.status !== 200) throw new Error('baha24 HTTP ' + r.status);
    return parseBaha24(r.text);
  };

  // baha24 is usually reachable directly: direct first (when not given an explicit order), proxies as retries
  const order = Array.isArray(proxyOrRoutes)
    ? proxyOrRoutes
    : ['', ...((proxyOrRoutes || '').trim() ? [(proxyOrRoutes || '').trim()] : [])];
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

async function fetchBaha24(proxyOrRoutes = '') {
  return (await fetchBaha24Quote(proxyOrRoutes)).usd;
}

module.exports = {
  FX_CODES,
  sanitizeFx,
  parseBaha24,
  fetchBaha24,
  fetchBaha24Quote
};

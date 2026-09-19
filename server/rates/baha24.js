'use strict';
const { BAHA24, UA } = require('../constants');
const { httpsRequest } = require('../utils/http-client');

async function fetchBaha24(proxy = '') {
  const attempt = async px => {
    const r = await httpsRequest(
      BAHA24,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, proxy: px },
      10000
    );
    if (r.status !== 200) throw new Error('baha24 HTTP ' + r.status);
    let j;
    try {
      j = JSON.parse(r.text);
    } catch {
      throw new Error('baha24 json unparsable');
    }
    const list = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
    const usd = list ? list.find(x => x && String(x.symbol).toUpperCase() === 'USD') : null;
    if (!usd) throw new Error('baha24: USD not in response');
    const v = Number(String(usd.sell).replace(/,/g, ''));
    if (!Number.isFinite(v) || v < 1000 || v > 1e9) {
      throw new Error('baha24 sell out of range: ' + String(usd.sell).slice(0, 20));
    }
    return Math.round(v);
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
  fetchBaha24
};

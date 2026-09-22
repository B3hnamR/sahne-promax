'use strict';
const { BONBAST, UA } = require('../constants');
const { httpsRequest } = require('../utils/http-client');
const { FX_CODES, sanitizeFx } = require('./baha24');

function parseBonbastFx(data) {
  const raw = {};
  for (const code of FX_CODES) {
    const value = Number(String((data && data[code.toLowerCase() + '1']) || '').replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 10 && value <= 1e9) raw[code] = Math.round(value);
  }
  return sanitizeFx(raw);
}

async function fetchBonbastFx(routes = ['']) {
  let lastError;
  for (const proxy of Array.isArray(routes) ? routes : [routes]) {
    try {
      const page = await httpsRequest(BONBAST, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        proxy
      });
      if (page.status !== 200) throw new Error('bonbast page HTTP ' + page.status);
      const cookie = []
        .concat(page.headers['set-cookie'] || [])
        .map(c => c.split(';')[0])
        .join('; ');
      const match = /param:\s*"([^"]+)"/.exec(page.text);
      if (!match) throw new Error('bonbast token not found');
      const body = 'param=' + encodeURIComponent(match[1]);
      const response = await httpsRequest(BONBAST + 'json', {
        method: 'POST',
        proxy,
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Referer: BONBAST,
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: cookie
        },
        body
      });
      if (response.status !== 200) throw new Error('bonbast data HTTP ' + response.status);
      let data;
      try {
        data = JSON.parse(response.text);
      } catch {
        throw new Error('bonbast json unparsable');
      }
      const fx = parseBonbastFx(data);
      if (!Object.keys(fx).length) throw new Error('bonbast currency rates missing');
      return fx;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('bonbast unavailable');
}

module.exports = { parseBonbastFx, fetchBonbastFx };

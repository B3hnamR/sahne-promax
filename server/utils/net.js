// Sahne ProMax — network helpers (pure, unit-tested): proxy routing and readable Kick errors.
// Ported from Sahne Plus 1.3.1 (server/server.js).
'use strict';

// Failures of the kind a filtered site produces in Iran: reset / refused / timeout / DNS / TLS handshake cut.
const NET_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  'EPIPE'
]);

function isNetError(e) {
  if (!e) return false;
  if (e.code && NET_CODES.has(String(e.code))) return true;
  if (/^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED)/.test(String(e.code || ''))) return true;
  return /^timeout$|proxy connect timeout|socket hang up|before secure TLS connection/i.test(String(e.message || ''));
}

// Chromium / Windows proxy answer ("PROXY 127.0.0.1:10809; DIRECT") -> "http://127.0.0.1:10809", otherwise ''.
// httpsRequest() speaks HTTP CONNECT only, so SOCKS and HTTPS proxies are ignored.
function parsePacProxy(s) {
  for (const part of String(s || '').split(';')) {
    const m = /^\s*PROXY\s+([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\]):(\d{1,5})\s*$/i.exec(part);
    if (m && Number(m[2]) > 0 && Number(m[2]) < 65536) return 'http://' + m[1] + ':' + m[2];
  }
  return '';
}

// Ordered, de-duplicated routes to try; '' means a direct connection.
function routeOrder({ manual = '', system = '', directFirst = false } = {}) {
  const proxies = [manual, system].map(s => String(s || '').trim()).filter(s => /^https?:\/\/\S+$/.test(s));
  const list = directFirst ? ['', ...proxies] : [...proxies, ''];
  return list.filter((v, i) => list.indexOf(v) === i);
}

// host:port of a proxy URL without credentials, for logs and messages
function routeLabel(px) {
  if (!px) return 'direct';
  try {
    return new URL(px).host || 'proxy';
  } catch {
    return 'proxy';
  }
}

// attempts: [{ route, err }] from resolveKickChannel() -> { error: short text for the status chip, hint: what to do }
function describeKickFailure(attempts) {
  const list = Array.isArray(attempts) ? attempts.filter(a => a && a.err) : [];
  const status = a => Number(a.err.httpStatus) || 0;
  if (list.some(a => status(a) === 404))
    return {
      error: 'کانال پیدا نشد',
      hint: 'اسم کانال را درست وارد کنید: فقط قسمتی که بعد از kick.com/ می‌آید، مثلاً amireyzed.'
    };
  const refused = list.find(a => status(a) === 403 || status(a) === 429);
  if (refused)
    return {
      error: 'kick.com درخواست را رد کرد (' + status(refused) + ')',
      hint: 'کیک اتصال از این IP را قبول نکرد؛ معمولاً IP سرور VPN است. سرور یا لوکیشن VPN را عوض کنید و دوباره «ذخیره» را بزنید.'
    };
  const direct = list.find(a => !a.route);
  const viaProxy = list.filter(a => a.route);
  if (
    direct &&
    isNetError(direct.err) &&
    viaProxy.every(a => isNetError(a.err) || /^proxy CONNECT/.test(String(a.err.message)))
  ) {
    const first = viaProxy.length
      ? 'از طریق پراکسی (' +
        viaProxy.map(a => routeLabel(a.route)).join('، ') +
        ') هم وصل نشد؛ مطمئن شوید VPN روشن و وصل است. '
      : 'kick.com در ایران فیلتر است و برنامه نتوانست به آن وصل شود. VPN را روشن کنید. ';
    return {
      error: 'kick.com در دسترس نیست (فیلتر)',
      hint:
        first +
        'اگر VPN روشن است و باز هم این خطا می‌آید، حالت TUN را در برنامه‌ی VPN روشن کنید، یا آدرس پراکسی HTTP آن را در کادر «پراکسی» (بخش نرخ دلار) بنویسید، مثلاً http://127.0.0.1:10809 برای v2rayN. این فقط برای شناسایی کانال لازم است؛ بعد از آن ساب‌ها معمولاً بدون VPN هم می‌آیند.'
    };
  }
  const last = list[list.length - 1];
  if (last && status(last))
    return {
      error: 'kick.com خطای HTTP ' + status(last) + ' داد',
      hint: 'ممکن است سرور کیک موقتاً مشکل داشته باشد؛ چند دقیقه بعد دوباره «ذخیره» را بزنید.'
    };
  if (last && last.err.kind === 'parse')
    return {
      error: 'جواب kick.com قابل خواندن نبود',
      hint: 'احتمالاً کیک صفحه‌ی بررسی امنیتی (Cloudflare) برگردانده است؛ سرور VPN را عوض کنید یا چند دقیقه بعد دوباره امتحان کنید.'
    };
  return {
    error: 'اتصال به kick.com ناموفق بود',
    hint: 'اینترنت و VPN را بررسی کنید و دوباره «ذخیره» را بزنید؛ جزئیات در صفحه‌ی لاگ است.'
  };
}

module.exports = {
  NET_CODES,
  isNetError,
  parsePacProxy,
  routeOrder,
  routeLabel,
  describeKickFailure
};

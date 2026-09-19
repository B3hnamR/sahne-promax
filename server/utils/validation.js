'use strict';
const path = require('path');
const crypto = require('crypto');
const { LIMITS, TYPES } = require('../constants');

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function typeOf(file) {
  const e = path.extname(String(file || '')).toLowerCase();
  for (const k in TYPES) if (TYPES[k].includes(e)) return k;
  return null;
}

function sniffOk(buf, ext) {
  if (!buf || buf.length < 12) return false;
  const h = buf.subarray(0, 12);
  const ascii = (o, s) => h.toString('latin1', o, o + s.length) === s;
  switch (ext) {
    case '.webm':
    case '.mkv':
      return h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3;
    case '.mp4':
    case '.mov':
    case '.m4a':
      return ascii(4, 'ftyp');
    case '.png':
      return h[0] === 0x89 && ascii(1, 'PNG');
    case '.jpg':
    case '.jpeg':
      return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
    case '.gif':
      return ascii(0, 'GIF8');
    case '.webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case '.wav':
      return ascii(0, 'RIFF') && ascii(8, 'WAVE');
    case '.ogg':
      return ascii(0, 'OggS');
    case '.mp3':
      return ascii(0, 'ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0);
    default:
      return false;
  }
}

function safeMediaName(orig) {
  const bn = String(orig || '')
    .split(/[\\/]/)
    .pop();
  const m = /\.([a-z0-9]{1,5})$/i.exec(bn);
  const ext = m ? '.' + m[1].toLowerCase() : '';
  let base = ext ? bn.slice(0, -ext.length) : bn;
  base = base
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[^\w.\-؀-ۿ ]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, LIMITS.fileName);
  if (!base || WIN_RESERVED.test(base)) base = 'media_' + crypto.randomBytes(3).toString('hex');
  return base + ext;
}

const toAsciiDigits = s =>
  String(s ?? '')
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));

function parseThreshold(name) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([tTkKmM]?)(?![a-zA-Z0-9])/.exec(toAsciiDigits(name));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = m[2].toUpperCase();
  if (u === 'M') return Math.round(n * 1000000);
  if (u === 'T' || u === 'K') return Math.round(n * 1000);
  return n >= 1000 ? Math.round(n) : null;
}

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .slice(0, max);
}

function normFa(s) {
  return toAsciiDigits(String(s ?? '').toLowerCase())
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْٰ‌]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function httpsUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' ? x.href : null;
  } catch {
    return null;
  }
}

const finite = (v, min, max, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

const intOrNull = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(max, Math.max(min, n)));
};

const isHex = s => /^#[0-9a-f]{6}$/i.test(String(s || ''));

function parseRange(rangeHdr, totalSize) {
  if (!rangeHdr || typeof rangeHdr !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHdr.trim());
  if (!m) return null;
  let start = null;
  let end = null;
  if (m[1] === '' && m[2] !== '') {
    const len = parseInt(m[2], 10);
    if (len <= 0) return null;
    start = Math.max(0, totalSize - len);
    end = totalSize - 1;
  } else if (m[1] !== '') {
    start = parseInt(m[1], 10);
    end = m[2] !== '' ? parseInt(m[2], 10) : totalSize - 1;
  } else {
    return null;
  }
  if (start < 0 || start >= totalSize || end < start) return null;
  end = Math.min(end, totalSize - 1);
  return { start, end, total: totalSize };
}

module.exports = {
  typeOf,
  sniffOk,
  safeMediaName,
  toAsciiDigits,
  parseThreshold,
  cleanText,
  normFa,
  httpsUrl,
  finite,
  intOrNull,
  isHex,
  parseRange
};

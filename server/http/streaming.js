'use strict';
const fs = require('fs');
const path = require('path');
const { MIME } = require('../constants');

function serveFile(req, res, fp, { csp = null, isImmutable = false } = {}) {
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }

    if (csp) res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const ext = path.extname(fp).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);

    // Conditional 304 caching
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      return res.end();
    }

    const cacheHeader = isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache';

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }

      let start;
      let end;
      if (!m[1] && m[2]) {
        start = Math.max(0, st.size - parseInt(m[2], 10));
        end = st.size - 1;
      } else {
        start = m[1] ? parseInt(m[1], 10) : 0;
        end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      }

      if (start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }

      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': cacheHeader
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheHeader
      });
      fs.createReadStream(fp).pipe(res);
    }
  });
}

function servePublic(req, res, pubDir, relPath, options = {}) {
  const fp = path.normalize(path.join(pubDir, relPath));
  if (!fp.startsWith(path.normalize(pubDir + path.sep))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  return serveFile(req, res, fp, options);
}

module.exports = {
  serveFile,
  servePublic
};

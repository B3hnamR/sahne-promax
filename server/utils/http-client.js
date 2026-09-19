'use strict';
const http = require('http');
const https = require('https');
const tls = require('tls');

function httpsRequest(urlStr, { method = 'GET', headers = {}, body = null, proxy = '' } = {}, timeoutMs = 15000) {
  const u = new URL(urlStr);
  const doRequest = socket =>
    new Promise((resolve, reject) => {
      const o = { method, host: u.hostname, path: u.pathname + u.search, headers: { Host: u.hostname, ...headers } };
      if (socket) {
        o.socket = socket;
        o.agent = false;
        o.servername = u.hostname;
        o.createConnection = () => tls.connect({ socket, servername: u.hostname });
      }
      const req = https.request(o, res => {
        const chunks = [];
        let n = 0;
        res.on('data', c => {
          n += c.length;
          if (n > 4 * 1024 * 1024) {
            req.destroy(new Error('response larger than 4 MB'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })
        );
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  if (!proxy) return doRequest(null);
  let pu;
  try {
    pu = new URL(proxy);
  } catch {
    return Promise.reject(new Error('bad proxy url'));
  }
  return new Promise((resolve, reject) => {
    const creq = http.request({
      host: pu.hostname,
      port: Number(pu.port) || 80,
      method: 'CONNECT',
      path: `${u.hostname}:${u.port || 443}`,
      headers: { Host: `${u.hostname}:${u.port || 443}` }
    });
    creq.setTimeout(timeoutMs, () => creq.destroy(new Error('proxy connect timeout')));
    creq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error('proxy CONNECT ' + res.statusCode));
      }
      doRequest(socket).then(resolve, reject);
    });
    creq.on('error', reject);
    creq.end();
  });
}

module.exports = {
  httpsRequest
};

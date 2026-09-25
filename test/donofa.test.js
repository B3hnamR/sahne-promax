'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { ConfigStore } = require('../server/config/store');
const { DonofaClient, parseDonofaActivity, donofaAudioUrl } = require('../server/integrations/donofa');
const { createServer } = require('../server/server');

test('Donofa parser accepts paid Toman and Rial and rejects invalid events', () => {
  const tip = parseDonofaActivity({
    data: { id: 'a_1', status: 'paid', amount: 450000, type: 'donation', name: 'Sara', currency: 'IRT' }
  });
  assert.equal(tip.stripe_pi_id, 'donofa_a_1');
  assert.equal(tip.toman_override, 450000);
  assert.equal(tip.is_local, true);
  assert.equal(parseDonofaActivity({ id: 'a', amount: 1000000, currency: 'IRR' }).toman_override, 100000);
  assert.equal(parseDonofaActivity({ id: 'a', amount: 100, status: 'pending' }), null);
  assert.equal(parseDonofaActivity({ id: 'a', amount: 0 }), null);
  assert.equal(parseDonofaActivity({ id: 'a', amount: 20, currency: 'USD' }), null);
  assert.equal(donofaAudioUrl('https://media.donofa.ir/a.mp3'), 'https://media.donofa.ir/a.mp3');
  assert.equal(donofaAudioUrl('https://cdn.example.com/a.mp3'), 'https://cdn.example.com/a.mp3');
  assert.equal(donofaAudioUrl('https://127.0.0.1/a.mp3'), null);
  assert.equal(donofaAudioUrl('https://localhost/a.mp3'), null);
  assert.equal(donofaAudioUrl('http://donofa.ir/a.mp3'), null);
});

test('Donofa websocket subscription, dedupe, exact TTS association and disconnect', () => {
  const sockets = [];
  class Socket {
    constructor() {
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(s) {
      this.sent.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: 1000 });
    }
  }
  const configStore = {
    donofaKey: 'examplekey',
    config: { donofa: { endpoint: 'ir' }, mode: 'standalone' },
    setDonofaKey(k) {
      this.donofaKey = k;
    }
  };
  const queue = {
    approved: [],
    pending: [],
    playing: null,
    enqueueApproved(t) {
      this.approved.push(t);
    },
    tryNext() {},
    tipSummary: t => ({ id: t.stripe_pi_id })
  };
  const broadcasts = [];
  const client = new DonofaClient({
    configStore,
    queue,
    playedStore: { isPlayed: () => false },
    logger: { info() {}, warn() {} },
    sse: { sendState() {}, broadcast: (...args) => broadcasts.push(args) },
    WebSocketCtor: Socket
  });
  client.connect();
  const socket = sockets[0];
  socket.readyState = 1;
  socket.onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  assert.equal(socket.sent[0].data.channel, 'user.examplekey');
  socket.onmessage({ data: JSON.stringify({ event: 'pusher:subscription_succeeded' }) });
  assert.equal(client.status(), 'connected');
  const emit = (event, data) => socket.onmessage({ data: JSON.stringify({ event, data: JSON.stringify(data) }) });
  emit('.donate.created', { id: 'one', status: 'paid', amount: 100000 });
  emit('.donate.created', { id: 'two', status: 'paid', amount: 200000 });
  emit('.donate.created', { id: 'one', status: 'paid', amount: 100000 });
  assert.equal(queue.approved.length, 2);
  emit('.tts.created', { donate_id: 'two', url: 'https://media.donofa.ir/two.mp3' });
  assert.equal(queue.approved[0].audio_url, null);
  assert.match(queue.approved[1].audio_url, /two\.mp3/);
  assert.equal(client.handleTts({ url: 'https://media.donofa.ir/ambiguous.mp3' }), true);
  assert.match(queue.approved[0].audio_url, /ambiguous\.mp3/);
  queue.playing = queue.approved.shift();
  queue.playing.audio_url = null;
  emit('.tts.created', { donate_id: 'one', url: 'https://media.donofa.ir/late.mp3' });
  assert.equal(broadcasts[0][1].id, 'donofa_one');
  client.disconnect();
  assert.equal(configStore.donofaKey, '');
  assert.equal(client.status(), 'unconfigured');
  assert.equal(socket.readyState, 3);
  client.stop();
});

test('Donofa key is hidden from public config and excluded from portable backups', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-donofa-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ConfigStore({ dataDir: dir });
  store.setDonofaKey('donofatestkey');
  store.saveConfig();
  assert.equal(store.publicConfig().donofa.configured, true);
  assert.equal(JSON.stringify(store.publicConfig()).includes('donofatestkey'), false);
  const { exportBackup } = require('../server/features/backup');
  const zip = await exportBackup(dir, store);
  const central = zip.readUInt32LE(zip.length - 22 + 16);
  const compressedLength = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  const nameLength = zip.readUInt16LE(local + 26);
  assert.equal(zip.subarray(local + 30, local + 30 + nameLength).toString(), 'config.json');
  const start = local + 30 + nameLength;
  const configBytes = zlib.inflateRawSync(zip.subarray(start, start + compressedLength));
  const portable = JSON.parse(configBytes.toString());
  assert.equal(JSON.stringify(portable).includes('donofatestkey'), false);
  assert.equal(portable.donofa.reconnectRequired, true);
});

test('Donofa setup, simulation and disconnect preserve other providers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-donofa-http-'));
  const port = 18000 + Math.floor(Math.random() * 300);
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ port, rate: { auto: false }, kick: { enabled: false } })
  );
  const srv = createServer({
    dataDir: dir,
    publicDir: path.join(__dirname, '..', 'public'),
    appVersion: 'test',
    testHooks: { offline: true, verifyDonofaKey: async () => ({ ok: true }) }
  });
  await srv.start();
  t.after(async () => {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const req = (method, route, body) =>
    new Promise((resolve, reject) => {
      const data = body == null ? null : JSON.stringify(body);
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          path: route,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        },
        res => {
          let raw = '';
          res.on('data', part => (raw += part));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        }
      );
      r.on('error', reject);
      r.end(data);
    });
  assert.equal((await req('POST', '/api/donofa/setup', { key: 'short' })).status, 400);
  assert.equal((await req('POST', '/api/donofa/setup', { key: 'donofatestkey', endpoint: 'ir' })).status, 200);
  assert.equal((await req('GET', '/api/config')).body.config.donofa.configured, true);
  const simulated = await req('POST', '/api/rules/test', {
    provider: 'donofa',
    kind: 'tip',
    amount: 500000,
    currency: 'IRT',
    name: 'Sara'
  });
  assert.equal(simulated.status, 200);
  assert.equal(simulated.body.ok, true);
  srv.playbackQueue.approved.push({ source: 'kickbot' }, { source: 'donofa' });
  assert.equal((await req('POST', '/api/donofa/disconnect')).status, 200);
  assert.deepEqual(
    srv.playbackQueue.approved.map(x => x.source),
    ['kickbot']
  );
  assert.equal((await req('GET', '/api/config')).body.config.donofa.configured, false);
});

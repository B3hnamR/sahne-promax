'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { createServer } = require('../server/server');
const { ConfigStore } = require('../server/config/store');
const { RateManager } = require('../server/rates/manager');
const { StreamElementsClient } = require('../server/integrations/streamelements');
const { KickChatClient } = require('../server/integrations/kick-chat');
const { KickBotClient } = require('../server/integrations/kickbot');
const {
  createZipArchive,
  extractZipArchive,
  exportBackup,
  exportBackupToFile,
  importBackup,
  importBackupFromFile
} = require('../server/features/backup');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-backend-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const logger = { info() {}, warn() {}, error() {} };
const sse = { sendState() {}, broadcast() {} };

test('Nobitex USD rate is visible before optional foreign FX completes', async () => {
  let releaseQuote;
  const quote = new Promise(resolve => {
    releaseQuote = resolve;
  });
  const configStore = {
    config: { rate: { auto: true, manual: null, value: 0, source: null, proxy: '', fx: {} } },
    debouncedSave() {}
  };
  const rate = new RateManager({
    configStore,
    logger,
    sse,
    fetchNobitexFn: async () => 91000,
    fetchBaha24QuoteFn: () => quote
  });
  const pending = rate.refreshRate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rate.currentRate(), 91000);
  assert.equal(configStore.config.rate.source, 'nobitex');
  releaseQuote({ usd: 92000, fx: { EUR: 100000 } });
  await pending;
  assert.equal(rate.rateFor('EUR'), 100000);
});

test('stale StreamElements close cannot clear the replacement subscription', () => {
  const sockets = [];
  class Socket {
    constructor() {
      this.readyState = 0;
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    send() {}
  }
  const client = new StreamElementsClient({
    configStore: { seToken: 'token', config: { se: { channelId: 'abc', username: 'streamer' } } },
    rateManager: {},
    queue: {},
    playedStore: {},
    logger,
    sse,
    WebSocketCtor: Socket
  });
  client.connect();
  sockets[0].readyState = 1;
  sockets[0].onmessage({ data: JSON.stringify({ type: 'response' }) });
  assert.equal(client.status(), 'connected');
  client.resetConnection();
  client.connect();
  sockets[1].readyState = 1;
  sockets[1].onmessage({ data: JSON.stringify({ type: 'response' }) });
  sockets[0].onclose({ code: 1000 });
  assert.equal(client.status(), 'connected');
  client.stop();
});

test('stale Kick chat close cannot disconnect a replacement socket', t => {
  const original = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0;
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    send() {}
  };
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const client = new KickChatClient({
    configStore: { config: { kick: { enabled: true, channel: 'demo', chatroomId: 123 } } },
    queue: {},
    rateManager: {},
    logger,
    sse
  });
  t.after(() => client.stop());
  client.connect();
  sockets[0].readyState = 1;
  sockets[0].onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  assert.equal(client.status(), 'connected');
  client.resetConnection();
  client.connect();
  sockets[1].readyState = 1;
  sockets[1].onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  sockets[0].onclose();
  assert.equal(client.status(), 'connected');
});

test('an older asynchronous config save cannot overwrite a newer synchronous save', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  const originalWrite = fs.promises.writeFile;
  let release;
  const hold = new Promise(resolve => {
    release = resolve;
  });
  fs.promises.writeFile = async function (...args) {
    if (String(args[0]).endsWith('.1.tmp')) await hold;
    return originalWrite.apply(this, args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWrite;
  });
  store.config.mode = 'companion';
  const pending = store.saveConfigAsync();
  store.config.mode = 'standalone';
  store.saveConfig();
  release();
  await pending;
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).mode, 'standalone');
});

test('malformed backup config is rejected without changing live files', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.mode = 'companion';
  store.saveConfig();
  const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  const zip = createZipArchive({ 'config.json': Buffer.from('{invalid'), 'media/new.mp4': Buffer.from('media') });
  await assert.rejects(importBackup(dir, zip, { configStore: store, logger, sse }), /valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'media', 'new.mp4')), false);
});

test('backup omits credentials and restore reports connections requiring re-entry', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.setSecret('kickbot-secret');
  store.config.streamer_id = 42;
  store.setSeToken('a.' + Buffer.from(JSON.stringify({ user: 'demo' })).toString('base64url') + '.signature');
  store.config.se = { channelId: 'abc123', username: 'demo' };
  store.saveConfig();
  const backup = await exportBackup(dir, store);
  const saved = JSON.parse(extractZipArchive(backup)['config.json'].toString('utf8'));
  assert.equal(saved.secret_id, undefined);
  assert.equal(saved.secret_id_enc, undefined);
  assert.equal(saved.se_token, undefined);
  assert.equal(saved.se_token_enc, undefined);
  const result = await importBackup(dir, backup, { configStore: store, logger, sse });
  assert.deepEqual(result.reconnectRequired, { kickbot: true, streamelements: true });
  assert.equal(store.getSecret(), '');
  assert.equal(store.seToken, '');
});

test('streamed backup round-trips large media and passes ZIP integrity checks', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  const media = crypto.randomBytes(4 * 1024 * 1024);
  fs.writeFileSync(path.join(dir, 'media', 'large.mp4'), media);
  const archive = await exportBackupToFile(dir, store);
  t.after(() => fs.rmSync(archive.filePath, { force: true }));
  const result = await importBackupFromFile(dir, archive.filePath, { configStore: store, logger, sse });
  assert.equal(result.mediaFiles, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'media', 'large.mp4')), media);
});

test('HTTP restore reinitializes the restored Kick chat connection', async t => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    send() {}
  };
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = tempDir(t);
  const app = createServer({ dataDir: dir, testHooks: { offline: true } });
  app.configStore.config.port = port;
  app.saveConfig();
  await app.start();
  t.after(() => app.stop());
  const config = app.configStore.serializedConfig();
  config.kick = { ...config.kick, enabled: true, channel: 'demo', chatroomId: 123, resolvedFor: 'demo' };
  config.rate = { ...config.rate, auto: false };
  const zip = createZipArchive({ 'config.json': JSON.stringify(config) });
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(origin + '/api/restore', { method: 'POST', headers: { Origin: origin }, body: zip });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.reconnectRequired, { kickbot: false, streamelements: false });
  const chat = sockets.find(socket => socket.url.includes('pusher'));
  assert.ok(chat, 'restored Kick chat starts without an app restart');
  chat.readyState = 1;
  chat.onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  const state = await (await fetch(origin + '/api/config')).json();
  assert.equal(state.state.kick.status, 'connected');
});

test('a reset discards an in-flight KickBot queue sync', async () => {
  let releaseSync;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    new Promise(resolve => {
      releaseSync = () =>
        resolve({
          ok: true,
          json: async () => ({
            tip_transactions: [{ stripe_pi_id: 'pi_old', approval_status: 'approved', amount_total: 100 }]
          })
        });
    });
  try {
    const queue = {
      pending: [],
      approved: [],
      playing: null,
      enqueueApproved(t) {
        this.approved.push(t);
      },
      trimApproved() {},
      tryNext() {}
    };
    const client = new KickBotClient({
      configStore: { getSecret: () => 'secret', config: { streamer_id: 1, mode: 'standalone' } },
      playedStore: { isPlayed: () => false },
      queue,
      logger,
      sse
    });
    const pending = client.syncQueue();
    client.resetConnection();
    releaseSync();
    await pending;
    assert.deepEqual(queue.approved, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('restarting KickBot keepalive does not stack intervals', t => {
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  const active = new Set();
  global.setInterval = (fn, ms) => {
    const handle = realSet(fn, ms);
    active.add(handle);
    return handle;
  };
  global.clearInterval = handle => {
    active.delete(handle);
    realClear(handle);
  };
  const client = new KickBotClient({
    configStore: { getSecret: () => '', config: { streamer_id: null, mode: 'standalone' } },
    playedStore: { isPlayed: () => false },
    queue: {},
    logger,
    sse
  });
  t.after(() => {
    client.stop();
    for (const handle of active) realClear(handle);
    active.clear();
    global.setInterval = realSet;
    global.clearInterval = realClear;
  });
  client.startKeepAlive();
  client.startKeepAlive();
  assert.equal(active.size, 2);
});

test('a stale KickBot socket cannot deliver a tip', t => {
  const original = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0;
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    send() {}
  };
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const handled = [];
  const client = new KickBotClient({
    configStore: { getSecret: () => 'secret', config: { streamer_id: 1, mode: 'standalone' } },
    playedStore: { isPlayed: () => false },
    queue: { pending: [], approved: [], trimApproved() {}, tryNext() {} },
    logger,
    sse
  });
  t.after(() => client.stop());
  client.handleEvent = (type, payload) => handled.push([type, payload]);
  client.connect();
  sockets[0].readyState = 1;
  const stale = sockets[0];
  client.resetConnection();
  stale.onmessage({ data: JSON.stringify({ data: { event_type: 'tip_initiated', payload: {} } }) });
  assert.deepEqual(handled, []);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const zlib = require('node:zlib');
const { createServer } = require('../server/server');
const { ConfigStore } = require('../server/config/store');
const { HistoryStore } = require('../server/config/history');
const { RateManager } = require('../server/rates/manager');
const { StreamElementsClient } = require('../server/integrations/streamelements');
const { KickChatClient } = require('../server/integrations/kick-chat');
const { KickBotClient } = require('../server/integrations/kickbot');
const {
  createZipArchive,
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

function firstEntryData(zip) {
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const end = zip.indexOf(Buffer.from('PK\x07\x08', 'latin1'), start);
  assert.notEqual(end, -1, 'data descriptor present');
  return zlib.inflateRawSync(zip.subarray(start, end));
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
  const exported = JSON.parse(firstEntryData(backup).toString('utf8'));
  assert.equal(exported.secret_id, undefined);
  assert.equal(exported.secret_id_enc, undefined);
  assert.equal(exported.se_token, undefined);
  assert.equal(exported.se_token_enc, undefined);
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

test('Baha24 fallback publishes USD before a slow Bonbast FX lookup', async () => {
  let releaseFx;
  const bonbast = new Promise(resolve => {
    releaseFx = resolve;
  });
  const configStore = {
    config: { rate: { auto: true, manual: null, value: 0, source: null, proxy: '', fx: {} } },
    debouncedSave() {}
  };
  const rate = new RateManager({
    configStore,
    logger,
    sse,
    fetchNobitexFn: async () => {
      throw new Error('nobitex down');
    },
    fetchBaha24QuoteFn: async () => ({ usd: 92000, fx: {} }),
    fetchBonbastFxFn: () => bonbast,
    bonbastMinIntervalMs: 0
  });
  const pending = rate.refreshRate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(configStore.config.rate.value, 92000);
  assert.equal(configStore.config.rate.source, 'baha24');
  releaseFx({});
  await pending;
});

test('stopping the rate manager discards an in-flight refresh', async () => {
  let releaseQuote;
  const quote = new Promise(resolve => {
    releaseQuote = resolve;
  });
  let saves = 0;
  const configStore = {
    config: { rate: { auto: true, manual: null, value: 0, source: null, proxy: '', fx: {} } },
    debouncedSave() {
      saves++;
    }
  };
  const rate = new RateManager({ configStore, logger, sse, fetchNobitexFn: () => quote });
  const pending = rate.refreshRate();
  rate.stop();
  releaseQuote(91000);
  await pending;
  assert.equal(configStore.config.rate.value, 0);
  assert.equal(saves, 0);
});

test('a refresh without new FX emits a single admin rate event', async () => {
  const events = [];
  const configStore = {
    config: { rate: { auto: true, manual: null, value: 0, source: null, proxy: '', fx: {} } },
    debouncedSave() {}
  };
  const rate = new RateManager({
    configStore,
    logger,
    sse: {
      sendState() {},
      broadcast(role, message) {
        events.push(message.type);
      }
    },
    fetchNobitexFn: async () => 91000,
    fetchBaha24QuoteFn: async () => ({ usd: 92000, fx: {} }),
    fetchBonbastFxFn: async () => {
      throw new Error('bonbast down');
    },
    bonbastMinIntervalMs: 0
  });
  await rate.refreshRate();
  assert.equal(events.filter(type => type === 'rate').length, 1);
});

test('restore asks to reconnect providers that existed only on this installation', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.setSecret('live-secret');
  store.config.streamer_id = 99;
  store.saveConfig();
  const zip = createZipArchive({ 'config.json': JSON.stringify({ mode: 'standalone' }) });
  const result = await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.deepEqual(result.reconnectRequired, { kickbot: true, streamelements: false });
  assert.equal(store.getSecret(), '');
});

test('restore keeps media files that are not in the backup', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'keep.mp4'), Buffer.from('local-only'));
  fs.writeFileSync(path.join(dir, 'media', 'shared.mp4'), Buffer.from('old-version'));
  const zip = createZipArchive({
    'config.json': JSON.stringify(store.serializedConfig()),
    'media/shared.mp4': Buffer.from('backup-version')
  });
  await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.equal(fs.readFileSync(path.join(dir, 'media', 'keep.mp4'), 'utf8'), 'local-only');
  assert.equal(fs.readFileSync(path.join(dir, 'media', 'shared.mp4'), 'utf8'), 'backup-version');
});

test('restore keeps the port the server is currently listening on', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.port = 29964;
  store.saveConfig();
  const zip = createZipArchive({
    'config.json': JSON.stringify({ ...store.serializedConfig(), port: 29965 })
  });
  const result = await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).port, 29964);
});

test('a stage-cleanup failure does not turn a committed restore into an error', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.mode = 'companion';
  store.saveConfig();
  const zip = createZipArchive({ 'config.json': JSON.stringify(store.serializedConfig()) });
  const originalRm = fs.promises.rm;
  fs.promises.rm = async function (target, opts) {
    if (String(target).includes('.restore-')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return originalRm.call(fs.promises, target, opts);
  };
  t.after(() => {
    fs.promises.rm = originalRm;
  });
  const result = await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).mode, 'companion');
});

test('a failed rollback keeps the staged previous files for recovery', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.mode = 'companion';
  store.saveConfig();
  const zip = createZipArchive({ 'config.json': JSON.stringify({ mode: 'standalone' }) });
  const originalRename = fs.renameSync;
  fs.renameSync = function (from, to) {
    const f = String(from);
    if (f.includes('.restore-') && f.endsWith('config.json'))
      throw Object.assign(new Error('install failed'), { code: 'EACCES' });
    if (f.includes('rollback') && f.endsWith('config.json'))
      throw Object.assign(new Error('rollback failed'), { code: 'EACCES' });
    return originalRename.call(fs, from, to);
  };
  t.after(() => {
    fs.renameSync = originalRename;
  });
  await assert.rejects(importBackup(dir, zip, { configStore: store, logger, sse }), /install failed/);
  const stages = fs.readdirSync(dir).filter(name => name.startsWith('.restore-'));
  assert.equal(stages.length, 1, 'failed rollback preserves the staging directory');
  const kept = JSON.parse(fs.readFileSync(path.join(dir, stages[0], 'rollback', 'config.json'), 'utf8'));
  assert.equal(kept.mode, 'companion');
});

function localHeaderFlags(zip, entryName) {
  const name = Buffer.from(entryName, 'utf8');
  const index = zip.indexOf(name);
  assert.notEqual(index, -1, 'entry name present in archive');
  assert.equal(zip.readUInt32LE(index - 30), 0x04034b50);
  return zip.readUInt16LE(index - 24);
}

test('zip entries with non-ASCII names set the UTF-8 name flag', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'فارسی.mp4'), Buffer.from('x'));
  const archive = await exportBackupToFile(dir, store);
  t.after(() => fs.rmSync(archive.filePath, { force: true }));
  const zip = fs.readFileSync(archive.filePath);
  assert.equal(localHeaderFlags(zip, 'media/فارسی.mp4') & 0x0800, 0x0800);
});

test('archives with case-only duplicate media names are rejected', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  const zip = createZipArchive({
    'config.json': JSON.stringify(store.serializedConfig()),
    'media/A.bin': Buffer.from('a'),
    'media/a.bin': Buffer.from('b')
  });
  await assert.rejects(importBackup(dir, zip, { configStore: store, logger, sse }), /duplicate/i);
});

test('export enforces the total-size limit while streaming', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'a.bin'), Buffer.alloc(700, 1));
  fs.writeFileSync(path.join(dir, 'media', 'b.bin'), Buffer.alloc(700, 2));
  const originalLstat = fs.promises.lstat;
  fs.promises.lstat = async function (target) {
    const stat = await originalLstat.call(fs.promises, target);
    if (String(target).includes('media')) return { size: 400, isFile: () => true };
    return stat;
  };
  t.after(() => {
    fs.promises.lstat = originalLstat;
  });
  await assert.rejects(exportBackupToFile(dir, store, { maxTotalBytes: 1024 }), /total size/i);
});

test('export warns about media files it cannot include', async t => {
  const dir = tempDir(t);
  const warnings = [];
  const store = new ConfigStore({
    dataDir: dir,
    logger: (level, message, data) => warnings.push({ level, message, data })
  });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  const oddName = 'a\u200Bb.mp4'; // zero-width space: legal on NTFS, rewritten by safeMediaName
  fs.writeFileSync(path.join(dir, 'media', oddName), Buffer.from('x'));
  const archive = await exportBackupToFile(dir, store);
  t.after(() => fs.rmSync(archive.filePath, { force: true }));
  assert.ok(
    warnings.some(entry => entry.data && entry.data.name === oddName),
    'the original name is logged'
  );
  const zip = fs.readFileSync(archive.filePath);
  assert.notEqual(zip.indexOf(Buffer.from('media/ab.mp4', 'utf8')), -1, 'sanitized entry is included');
});

test('export includes non-canonical media under a sanitized name and rewrites the config reference', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'Clip.MP4'), Buffer.from('clip'));
  store.config.files = [{ id: 'f1', file: 'Clip.MP4' }];
  const archive = await exportBackupToFile(dir, store);
  t.after(() => fs.rmSync(archive.filePath, { force: true }));
  const zip = fs.readFileSync(archive.filePath);
  assert.notEqual(zip.indexOf(Buffer.from('media/Clip.mp4', 'utf8')), -1, 'sanitized media entry present');
  const exported = JSON.parse(firstEntryData(zip).toString('utf8'));
  assert.equal(exported.files[0].file, 'Clip.mp4');
});

test('restore accepts archives whose media names are not canonical and rewrites references', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  const config = { ...store.serializedConfig(), files: [{ id: 'f1', file: 'Clip.MP4', type: 'video', size: 4 }] };
  const zip = createZipArchive({ 'config.json': JSON.stringify(config), 'media/Clip.MP4': Buffer.from('clip') });
  const result = await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'media', 'Clip.mp4'), 'utf8'), 'clip');
  assert.equal(store.config.files[0].file, 'Clip.mp4');
});

test('portable backups strip proxy credentials', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.rate.proxy = 'http://user:pass@127.0.0.1:8080';
  store.saveConfig();
  const backup = await exportBackup(dir, store);
  const exported = JSON.parse(firstEntryData(backup).toString('utf8'));
  assert.equal(exported.rate.proxy, 'http://127.0.0.1:8080');

  store.config.rate.proxy = 'user:secretpass@127.0.0.1:10809';
  store.saveConfig();
  const second = await exportBackup(dir, store);
  const exportedSecond = JSON.parse(firstEntryData(second).toString('utf8'));
  assert.equal(exportedSecond.rate.proxy, '127.0.0.1:10809');
});

test('history clear discards an in-flight async save', async t => {
  const dir = tempDir(t);
  const store = new HistoryStore(dir, { logger: () => {} });
  store.entries = [{ id: 'old', at: Date.now(), name: 'Ali', toman: 1 }];
  const originalWrite = fs.promises.writeFile;
  let release;
  const hold = new Promise(resolve => {
    release = resolve;
  });
  fs.promises.writeFile = async function (...args) {
    if (String(args[0]).endsWith('history.json.1.tmp')) await hold;
    return originalWrite.apply(this, args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWrite;
  });
  const pending = store.saveAsync();
  store.clear();
  release();
  await pending;
  assert.equal(fs.existsSync(path.join(dir, 'history.json')), false);
});

test('cross-site pages cannot trigger a backup export, and exports clean up after themselves', async t => {
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
  const origin = `http://127.0.0.1:${port}`;

  const blocked = await fetch(origin + '/api/backup', { headers: { Origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  const blockedFetchSite = await fetch(origin + '/api/backup', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(blockedFetchSite.status, 403);

  const ok = await fetch(origin + '/api/backup');
  assert.equal(ok.status, 200);
  await ok.arrayBuffer();
  const leftovers = () => fs.readdirSync(dir).filter(name => name.startsWith('.backup-export-'));
  for (let i = 0; i < 50 && leftovers().length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(leftovers(), []);
});

test('replacing the KickBot widget URL reconnects immediately', async t => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const sockets = [];
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    send(data) {
      this.sent.push(data);
    }
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://widgets.kickbot.com/')) {
      return { json: async () => ({ nodes: [{ data: [{ streamer_db_id: 1 }, 98765] }] }) };
    }
    return realFetch(url, options);
  };
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
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
  const origin = `http://127.0.0.1:${port}`;
  const secretA = 'a'.repeat(32) + '%3A' + 'b'.repeat(32);
  const secretB = 'c'.repeat(32) + '%3A' + 'd'.repeat(32);

  const first = await fetch(origin + '/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ url: 'https://widgets.kickbot.com/external/tipping/' + secretA })
  });
  assert.equal(first.status, 200);
  assert.equal(sockets.length, 1);

  const second = await fetch(origin + '/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ url: 'https://widgets.kickbot.com/external/tipping/' + secretB })
  });
  assert.equal(second.status, 200);
  assert.equal(sockets.length, 2, 'a replacement socket is created without waiting for the reconnect timer');
});

test('stopping the rate manager discards an in-flight Baha24 fallback refresh', async () => {
  let releaseQuote;
  const quote = new Promise(resolve => {
    releaseQuote = resolve;
  });
  let saves = 0;
  const configStore = {
    config: { rate: { auto: true, manual: null, value: 0, source: null, proxy: '', fx: {} } },
    debouncedSave() {
      saves++;
    }
  };
  const rate = new RateManager({
    configStore,
    logger,
    sse,
    fetchNobitexFn: async () => {
      throw new Error('nobitex down');
    },
    fetchBaha24QuoteFn: () => quote
  });
  const pending = rate.refreshRate();
  await new Promise(resolve => setImmediate(resolve));
  rate.stop();
  releaseQuote({ usd: 92000, fx: {} });
  await pending;
  assert.equal(configStore.config.rate.value, 0);
  assert.equal(saves, 0);
});

test('a media file that cannot be re-homed keeps the staging directory', async t => {
  const dir = tempDir(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.saveConfig();
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'keep.mp4'), Buffer.from('local-only'));
  const zip = createZipArchive({ 'config.json': JSON.stringify(store.serializedConfig()) });
  const originalRename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (String(from).includes('rollback') && String(from).endsWith('keep.mp4'))
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    return originalRename.call(fs, from, to);
  };
  t.after(() => {
    fs.renameSync = originalRename;
  });
  const result = await importBackup(dir, zip, { configStore: store, logger, sse });
  assert.equal(result.ok, true);
  const stages = fs.readdirSync(dir).filter(name => name.startsWith('.restore-'));
  assert.equal(stages.length, 1, 'the staging directory with the un-rehomed file is preserved');
  assert.equal(fs.readFileSync(path.join(dir, stages[0], 'rollback', 'media', 'keep.mp4'), 'utf8'), 'local-only');
});

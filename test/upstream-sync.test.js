'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { Writable } = require('stream');
const { PlaybackQueue } = require('../server/playback/queue');
const { WaitingStore } = require('../server/playback/waiting-store');
const { KickBotClient } = require('../server/integrations/kickbot');
const { DonofaClient } = require('../server/integrations/donofa');
const { streamDownload } = require('../electron/download-core');
const { createServer } = require('../server/server');
const { ConfigStore } = require('../server/config/store');
const { HistoryStore } = require('../server/config/history');

const logger = { info() {}, warn() {}, error() {} };

test('captured donation waits after the last Browser Source closes and survives a restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-waiting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const played = new Set();
  const playedStore = { isPlayed: id => played.has(id), markPlayed: id => played.add(id) };
  const store = new WaitingStore(dir, playedStore, logger);
  let overlays = 1;
  let finishCapture;
  const capture = new Promise(resolve => (finishCapture = resolve));
  let queue;
  const sse = {
    clientCount: () => overlays,
    sendState: () => queue.persistWaiting(),
    broadcast() {}
  };
  queue = new PlaybackQueue({
    configStore: { config: { mode: 'standalone', appearance: { maxDuration: 90 }, app: {} } },
    playedStore,
    waitingStore: store,
    mediaDir: dir,
    logger,
    sse,
    rateManager: { currentRate: () => 0, tomanOf: () => 0, tomanFor: () => 0 },
    captureFn: () => capture,
    publishFn() {}
  });
  queue.enqueueApproved({ stripe_pi_id: 'pi_paid', tipper_name: 'Ali', amount_total: 100, source: 'kickbot' });
  const running = queue.tryNext();
  queue.enqueueApproved({ stripe_pi_id: 'sub_abcdef123456', source: 'kick', is_local: true, kind: 'sub' });
  queue.enqueueApproved({ stripe_pi_id: 'pi_later', tipper_name: 'Later', amount_total: 200, source: 'kickbot' });
  overlays = 0;
  finishCapture('ok');
  await running;
  assert.equal(played.has('pi_paid'), false);
  assert.deepEqual(
    queue.approved.map(tip => tip.stripe_pi_id),
    ['sub_abcdef123456', 'pi_paid', 'pi_later']
  );
  assert.equal(queue.approved[1].captured, true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(store.file, 'utf8')).map(tip => tip.stripe_pi_id),
    ['sub_abcdef123456', 'pi_paid']
  );
  queue.stop();
  const restored = new WaitingStore(dir, playedStore, logger).load();
  assert.deepEqual(
    restored.map(tip => tip.stripe_pi_id),
    ['sub_abcdef123456', 'pi_paid']
  );
  assert.equal(restored[1].captured, true);
});

test('recording opt-out keeps live totals and top donors without persisting private alerts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-live-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = new HistoryStore(dir);
  t.after(() => history.stop());
  history.add({ id: 'off', name: 'Ali', toman: 1000, played: true }, { persist: false });
  assert.equal(history.entries.length, 0);
  assert.equal(history.getEntries().length, 0);
  assert.equal(history.totals().toman, 1000);
  assert.equal(history.getTop('daily')[0].toman, 1000);
  assert.equal(history.getTop('all')[0].toman, 1000);
  assert.equal(fs.existsSync(history.file), false);

  history.add({ id: 'on', name: 'Ali', toman: 2000, played: true });
  history.saveSync();
  assert.equal(history.totals().toman, 3000);
  assert.equal(history.getTop('weekly')[0].toman, 3000);
  assert.equal(history.getTop('all')[0].toman, 3000);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(history.file, 'utf8')).entries.map(entry => entry.id),
    ['on']
  );
  assert.deepEqual(
    history.getEntries().map(entry => entry.id),
    ['on']
  );
});

test('waiting store keeps paid local alerts but rejects test and malformed entries', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-waiting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const playedStore = { isPlayed: () => false };
  const store = new WaitingStore(dir, playedStore, logger);
  store.save([
    { stripe_pi_id: 'se_abc', source: 'streamelements', is_local: true, kind: 'tip' },
    { stripe_pi_id: 'sub_abcdef123456', source: 'kick', is_local: true, kind: 'sub' },
    { stripe_pi_id: 'donofa_abc', source: 'donofa', is_local: true, kind: 'tip' },
    { stripe_pi_id: 'se_test', source: 'streamelements', is_local: true, is_test: true },
    { stripe_pi_id: '../bad', source: 'kickbot', captured: true }
  ]);
  assert.deepEqual(
    store.load().map(tip => tip.stripe_pi_id),
    ['se_abc', 'sub_abcdef123456', 'donofa_abc']
  );
  store.clear();
  assert.equal(fs.existsSync(store.file), false);
});

test('Donofa audio arriving after the donation updates the saved waiting alert', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-donofa-waiting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const playedStore = { isPlayed: () => false };
  const store = new WaitingStore(dir, playedStore, logger);
  const queue = {
    approved: [
      {
        stripe_pi_id: 'donofa_abc',
        source: 'donofa',
        is_local: true,
        kind: 'tip',
        currency: 'IRT',
        amount_total: 100000,
        audio_url: null
      }
    ],
    playing: null,
    persistWaiting() {
      store.save(this.approved);
    }
  };
  queue.persistWaiting();
  const client = new DonofaClient({
    configStore: { donofaKey: '', config: { donofa: { endpoint: 'ir' } } },
    queue,
    playedStore,
    logger,
    sse: { broadcast() {} }
  });
  assert.equal(client.handleTts({ donate_id: 'abc', url: 'https://media.donofa.ir/abc.mp3' }), true);
  const restored = new WaitingStore(dir, playedStore, logger).load();
  assert.equal(restored[0].audio_url, 'https://media.donofa.ir/abc.mp3');
});

test('KickBot queue settings event retains its fields and resumes playback', () => {
  const queue = {
    pending: [],
    approved: [],
    queueMode: 'auto',
    queueDelay: 2,
    queueStatus: 'pause',
    tippingEnabled: true,
    tryNext() {
      this.resumed = true;
    },
    trimApproved() {},
    tipSummary: x => x
  };
  const client = new KickBotClient({
    configStore: { config: {}, getSecret: () => '' },
    playedStore: {},
    queue,
    logger,
    sse: { sendState() {} }
  });
  client.handleEvent('tip_queue_config_updated', {
    queue_mode: 'manual',
    queue_delay: 9,
    queue_status: 'play',
    is_active: false
  });
  assert.equal(queue.queueMode, 'manual');
  assert.equal(queue.queueDelay, 9);
  assert.equal(queue.queueStatus, 'play');
  assert.equal(queue.tippingEnabled, false);
  assert.equal(queue.resumed, true);
});

test('credential storage status reflects each credential actually written', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-secrets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const token = ['e30', Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url'), 'a'.repeat(40)].join('.');
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      secret_id_enc: 'encrypted-kickbot',
      streamer_id: 1,
      se_token: token,
      se: { channelId: 'channel' }
    })
  );
  const store = new ConfigStore({
    dataDir: dir,
    logger() {},
    secretStore: {
      available: () => true,
      decrypt: () => 'kickbot-secret',
      encrypt: value =>
        value === token
          ? (() => {
              throw new Error('SE encryption failed');
            })()
          : 'encrypted'
    }
  });
  assert.equal(store.secretStorage, 'os');
  assert.equal(store.seSecretStorage, 'plain');
  store.saveConfig();
  assert.equal(store.publicConfig().kickbot.secretStorage, 'os');
  assert.equal(store.publicConfig().streamelements.secretStorage, 'plain');
  const persisted = JSON.parse(fs.readFileSync(store.cfgPath, 'utf8'));
  assert.equal(persisted.secret_id_enc, 'encrypted');
  assert.equal(persisted.se_token, token);
});

test('download without progress and blocked disk writes both time out', async () => {
  const idle = new ReadableStream({ pull() {} });
  const sink = () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
  await assert.rejects(streamDownload(idle, sink(), { maxBytes: 100, stallMs: 25 }), /waiting for data timed out/);
  const oneChunk = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    }
  });
  const blocked = new Writable({ highWaterMark: 1, write() {} });
  await assert.rejects(streamDownload(oneChunk, blocked, { maxBytes: 100, stallMs: 25 }), /writing to disk timed out/);
  const closing = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final() {}
  });
  await assert.rejects(
    streamDownload(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        }
      }),
      closing,
      { maxBytes: 100, stallMs: 25 }
    ),
    /writing to disk timed out/
  );
});

test('a long media report extends only the matching active alert', t => {
  const queue = new PlaybackQueue({
    configStore: { config: { mode: 'standalone' } },
    playedStore: { isPlayed: () => false, markPlayed() {} },
    mediaDir: '',
    logger,
    sse: { clientCount: () => 0, sendState() {}, broadcast() {} },
    rateManager: { currentRate: () => 0 },
    captureFn: async () => 'ok'
  });
  t.after(() => queue.stop());
  queue.playing = { stripe_pi_id: 'active' };
  queue.armPlayTimeout('active', 1);
  const before = queue.playTimeoutAt;
  queue.extendPlaying('old', 300);
  assert.equal(queue.playTimeoutAt, before);
  queue.extendPlaying('active', 300);
  assert.ok(queue.playTimeoutAt > before + 200000);
  queue.extendPlaying('active', 5000);
  assert.ok(queue.playTimeoutAt <= Date.now() + 3615000, 'extension is bounded to one hour plus grace');
});

test('file ranges, history switch and media extension work through the local API', async t => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promax-port-'));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false },
      files: [{ id: 'aaaaaaaaaa', file: 'clip.webm', name: 'clip', minToman: 100, maxToman: 1000 }]
    })
  );
  const server = createServer({ dataDir: dir, appVersion: 'test', testHooks: { offline: true } });
  await server.start();
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const post = (route, body, method = 'POST') =>
    fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  const invalidPatch = await post('/api/file', { id: 'aaaaaaaaaa', minToman: 2000 }, 'PATCH');
  assert.equal(invalidPatch.status, 400);
  assert.equal((await invalidPatch.json()).code, 'invalid_amount_range');
  const invalidBatch = await post('/api/config', {
    appearance: { textSize: 50 },
    files: [{ id: 'aaaaaaaaaa', minToman: 2000 }]
  });
  assert.equal(invalidBatch.status, 400);
  assert.equal(server.configStore.config.files[0].minToman, 100);
  assert.notEqual(server.configStore.config.appearance.textSize, 50);
  assert.equal((await post('/api/config', { app: { recordHistory: false } })).status, 200);
  assert.equal(server.configStore.config.app.recordHistory, false);
  server.playbackQueue.showTip({
    stripe_pi_id: 'local_1',
    tipper_name: 'No history',
    amount_total: 100,
    currency: 'USD',
    toman_override: 5000,
    source: 'kick',
    is_local: true,
    kind: 'tip'
  });
  assert.equal(server.historyStore.entries.length, 0, 'disabled recording leaves the ledger untouched');
  const top = await fetch(`http://127.0.0.1:${port}/api/top?range=daily`).then(response => response.json());
  assert.equal(top.donors[0].toman, 5000, 'top donors continue updating in memory');
  const history = await fetch(`http://127.0.0.1:${port}/api/history`).then(response => response.json());
  assert.equal(history.entries.length, 0);
  assert.equal(history.today.toman, 5000);
  server.playbackQueue.stop();
  server.playbackQueue.playing = { stripe_pi_id: 'active' };
  server.playbackQueue.armPlayTimeout('active', 1);
  const before = server.playbackQueue.playTimeoutAt;
  assert.equal((await post('/api/extend', { id: 'active', seconds: 180 })).status, 200);
  assert.ok(server.playbackQueue.playTimeoutAt > before + 100000);
  server.playbackQueue.playing = null;
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ConfigStore } = require('../server/config/store');
const { createHttpRouter } = require('../server/http/router');
const { KickBotClient } = require('../server/integrations/kickbot');
const { StreamElementsClient } = require('../server/integrations/streamelements');
const { DEFAULT_CONFIG } = require('../server/constants');

const oldSecret = 'a'.repeat(32) + ':' + 'b'.repeat(32);
const newSecret = 'c'.repeat(32) + ':' + 'd'.repeat(32);
const token = user =>
  'header.' + Buffer.from(JSON.stringify({ user, extra: 'long-enough-payload' })).toString('base64url') + '.signature';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-provider-save-'));
  const store = new ConfigStore({
    dataDir: dir,
    logger() {},
    secretStore: { available: () => true, encrypt: value => Buffer.from(value).toString('base64') }
  });
  store.setSecret(oldSecret);
  store.setSeToken(token('old'));
  Object.assign(store.config, {
    streamer_id: 42,
    se: { channelId: 'old123', username: 'old', provider: 'kick' },
    mode: 'companion',
    kick: { ...store.config.kick, enabled: true, channel: 'old', chatroomId: 123 },
    rate: { ...store.config.rate, auto: false, manual: 100000 }
  });
  assert.equal(store.saveConfig(), true);
  const disk = () => JSON.parse(fs.readFileSync(store.cfgPath, 'utf8'));
  const effects = [];
  const effect =
    name =>
    (...args) =>
      effects.push({ name, args, disk: disk() });
  const logger = { info: effect('log'), warn: effect('warn'), error: effect('error') };
  const sse = { sendState: effect('state'), broadcastAppearance: effect('appearance'), broadcast: effect('broadcast') };
  const rateManager = {
    scheduleRate: effect('rate schedule'),
    refreshRate: effect('rate refresh'),
    currentRate: () => 100000,
    tomanFor: amount => amount * 100000
  };
  const meldManager = {
    reloadLayers: async reason => {
      effects.push({ name: 'meld', reason });
      return true;
    }
  };
  const queue = {
    makeTestTip: () => ({ stripe_pi_id: 'test_preview', is_test: true }),
    pending: [{ source: 'kickbot' }, { source: 'streamelements' }, { source: 'kick' }],
    approved: [
      { source: 'kickbot' },
      {},
      { source: 'kickbot', is_replay: true },
      { source: 'streamelements' },
      { source: 'donofa' },
      { is_local: true }
    ]
  };
  const kickBotClient = new KickBotClient({ configStore: store, queue, logger, sse });
  kickBotClient.ws = { readyState: 1, close: effect('kickbot close') };
  t.mock.method(kickBotClient, 'connect', effect('kickbot connect'));
  const streamElementsClient = new StreamElementsClient({ configStore: store, queue, logger, sse });
  const donofaBridge = { reset: async commit => commit() };
  streamElementsClient.socket = { readyState: 1, close: effect('se close') };
  t.mock.method(streamElementsClient, 'verifyToken', async value => {
    assert.equal(value, token('new'));
    return { ok: true, channelId: 'new456', username: 'new', provider: 'twitch' };
  });
  t.mock.method(streamElementsClient, 'connect', effect('se connect'));
  const server = http.createServer(
    createHttpRouter({
      configStore: store,
      mediaDir: dir,
      logger,
      sse,
      playbackQueue: queue,
      kickBotClient,
      streamElementsClient,
      kickChatClient: { resetConnection: effect('kick reset') },
      rateManager,
      meldManager,
      donofaBridge
    })
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  store.config.port = server.address().port;
  assert.equal(store.saveConfig(), true);
  t.after(async () => {
    store.stop();
    kickBotClient.stop();
    streamElementsClient.stop();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const request = (route, body = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: store.config.port,
          path: route,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        res => {
          let raw = '';
          res.on('data', chunk => (raw += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  return {
    store,
    disk,
    effects,
    queue,
    kickBotClient,
    streamElementsClient,
    request,
    rateManager,
    meldManager,
    donofaBridge
  };
}

test('Donofa account removal cannot proceed when its bridge cannot safely reset', async t => {
  const { store, request, effects, donofaBridge } = await fixture(t);
  store.setDonofaKey('oldDonofaKey');
  assert.equal(store.saveConfig(), true);
  donofaBridge.reset = async () => false;
  const result = await request('/api/donofa/disconnect');
  assert.equal(result.status, 500);
  assert.equal(result.body.code, 'settings_save_failed');
  assert.equal(store.getDonofaKey(), 'oldDonofaKey');
  assert.equal(JSON.parse(fs.readFileSync(store.cfgPath)).donofa_key_enc != null, true);
  assert.deepEqual(effects, []);
});

test('KickBot verification rejects missing IDs and unsuccessful HTTP responses without changing accounts', async t => {
  const { store, request, effects } = await fixture(t);
  const before = store.getSecret();
  for (const response of [
    { json: async () => ({ message: 'Widget not found' }) },
    { ok: false, status: 403, json: async () => ({ nodes: [{ data: [{ streamer_db_id: 1 }, 99] }] }) }
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => response);
    const result = await request('/api/setup', { url: newSecret });
    mocked.mock.restore();
    assert.ok(result.status >= 400);
    assert.equal(store.getSecret(), before);
    assert.equal(store.config.streamer_id, 42);
    assert.equal(
      effects.some(effect => effect.name === 'kickbot connect'),
      false
    );
  }
});

test('Meld reload reaches the manager and failed rate refresh is not reported as success', async t => {
  const { request, effects, rateManager, meldManager } = await fixture(t);
  assert.deepEqual((await request('/api/meld-reload')).body, { ok: true });
  assert.equal(effects.find(effect => effect.name === 'meld').reason, 'manual');
  meldManager.reloadLayers = async () => false;
  assert.deepEqual((await request('/api/meld-reload')).body, { ok: false });
  rateManager.refreshRate = async () => null;
  const failed = (await request('/api/refresh-rate')).body;
  assert.equal(failed.ok, false);
  assert.ok(failed.error);
  rateManager.refreshRate = async () => 125000;
  assert.equal((await request('/api/refresh-rate')).body.ok, true);
});

test('normal Appearance preview selects media with the same picker as live alerts', async t => {
  const { store, effects, request } = await fixture(t);
  fs.writeFileSync(path.join(store.dataDir, 'sample.png'), Buffer.from([137, 80, 78, 71]));
  store.config.files = [{ id: 'media', file: 'sample.png', name: 'Sample', type: 'image', enabled: true, minToman: 0 }];
  const result = await request('/api/preview', { amount: 10, name: 'Viewer' });
  assert.equal(result.body.ok, true);
  const event = effects.find(effect => effect.name === 'broadcast');
  assert.equal(event.args[0], 'preview');
  assert.equal(event.args[1].tip.media.url, '/media/sample.png');
});

for (const [route, body, provider, setup] of [
  ['/api/setup', { url: newSecret }, 'kickbot', true],
  ['/api/disconnect-kickbot', {}, 'kickbot', false],
  ['/api/se/setup', { token: token('new') }, 'se', true],
  ['/api/se/disconnect', {}, 'se', false]
]) {
  test(`${route} preserves credentials, sockets and queues on failed save; retry commits before effects`, async t => {
    const { store, disk, effects, queue, kickBotClient, streamElementsClient, request } = await fixture(t);
    if (route === '/api/setup') {
      t.mock.method(globalThis, 'fetch', async url => {
        assert.match(url, /widgets\.kickbot\.com\/external\/tipping\//);
        return { json: async () => ({ nodes: [{ data: [{ streamer_db_id: 1 }, 99] }] }) };
      });
    }
    const root = store.config;
    const se = store.config.se;
    const before = structuredClone(store.config);
    const bytes = fs.readFileSync(store.cfgPath, 'utf8');
    const pending = queue.pending;
    const approved = queue.approved;
    const ws = kickBotClient.ws;
    const socket = streamElementsClient.socket;
    const generation = kickBotClient.connectionGeneration;
    const storage = [store.secretStorage, store.seSecretStorage];
    const rename = fs.renameSync;
    let blocked = true;
    t.mock.method(fs, 'renameSync', function (...args) {
      if (blocked && args[0] === store.cfgPath + '.sync.tmp') throw new Error('disk failure');
      return rename.apply(this, args);
    });

    const failed = await request(route, body);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.code, 'settings_save_failed');
    assert.equal(store.getSecret(), oldSecret);
    assert.equal(store.seToken, token('old'));
    assert.equal(store.config, root);
    assert.equal(store.config.se, se);
    assert.deepEqual(store.config, before);
    assert.deepEqual([store.secretStorage, store.seSecretStorage], storage);
    assert.equal(fs.readFileSync(store.cfgPath, 'utf8'), bytes);
    assert.equal(queue.pending, pending);
    assert.equal(queue.approved, approved);
    assert.equal(kickBotClient.ws, ws);
    assert.equal(streamElementsClient.socket, socket);
    assert.equal(kickBotClient.connectionGeneration, generation);
    assert.deepEqual(effects, []);

    blocked = false;
    const saved = await request(route, body);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true);
    const committed = disk();
    assert.ok(effects.some(item => item.name === provider + ' close'));
    assert.ok(effects.some(item => item.name === 'state'));
    assert.ok(effects.some(item => item.name === 'log'));
    for (const item of effects) assert.deepEqual(item.disk, committed, item.name + ' runs after commit');
    if (provider === 'kickbot') {
      assert.equal(store.getSecret(), setup ? newSecret : '');
      assert.equal(committed.streamer_id, setup ? 99 : null);
      assert.equal(store.secretStorage, setup ? 'os' : 'none');
      assert.equal(committed.secret_id_enc, setup ? Buffer.from(newSecret).toString('base64') : undefined);
      if (setup) {
        assert.ok(effects.some(item => item.name === 'kickbot connect'));
        assert.equal(queue.pending, pending);
        assert.equal(queue.approved, approved);
      } else {
        assert.deepEqual(
          queue.pending,
          pending.filter(tip => tip.source !== 'kickbot')
        );
        assert.deepEqual(queue.approved, [approved[2], approved[3], approved[4], approved[5]]);
      }
    } else {
      assert.equal(store.seToken, setup ? token('new') : '');
      assert.deepEqual(
        committed.se,
        setup ? { channelId: 'new456', username: 'new', provider: 'twitch' } : DEFAULT_CONFIG.se
      );
      assert.equal(store.seSecretStorage, setup ? 'os' : 'none');
      assert.equal(committed.se_token_enc, setup ? Buffer.from(token('new')).toString('base64') : undefined);
      assert.equal(queue.pending, pending);
      if (setup) {
        assert.ok(effects.some(item => item.name === 'se connect'));
        assert.equal(queue.approved, approved);
      } else
        assert.deepEqual(
          queue.approved,
          approved.filter(tip => tip.source !== 'streamelements')
        );
    }
    assert.ok(!JSON.stringify(saved.body).includes(setup && provider === 'kickbot' ? newSecret : token('new')));
  });
}

test('direct KickBot disconnect requires save success and returns a boolean', async t => {
  const { store, effects, queue, kickBotClient } = await fixture(t);
  const save = store.saveConfig.bind(store);
  const pending = queue.pending;
  const approved = queue.approved;
  const socket = kickBotClient.ws;
  const storage = store.secretStorage;
  for (const result of [false, undefined]) {
    const mock = t.mock.method(store, 'saveConfig', () => result);
    assert.equal(kickBotClient.disconnect(), false);
    mock.mock.restore();
    assert.equal(store.getSecret(), oldSecret);
    assert.equal(store.config.streamer_id, 42);
    assert.equal(store.secretStorage, storage);
    assert.equal(kickBotClient.ws, socket);
    assert.equal(kickBotClient.connectionGeneration, 0);
    assert.equal(queue.pending, pending);
    assert.equal(queue.approved, approved);
    assert.deepEqual(effects, []);
  }
  assert.equal(save(), true);
  assert.equal(kickBotClient.disconnect(), true);
  assert.equal(kickBotClient.ws, null);
  assert.equal(store.getSecret(), '');
});

test('reset settings restarts Kick chat and rate scheduling only after successful commit', async t => {
  const { store, disk, effects, request } = await fixture(t);
  const before = structuredClone(store.config);
  const save = store.saveConfig;
  const mock = t.mock.method(store, 'saveConfig', () => false);
  const failed = await request('/api/reset-settings');
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, 'settings_save_failed');
  assert.deepEqual(store.config, before);
  assert.deepEqual(effects, []);
  mock.mock.restore();
  assert.equal(store.saveConfig, save);

  const saved = await request('/api/reset-settings');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.deepEqual(store.config.kick, DEFAULT_CONFIG.kick);
  assert.deepEqual(store.config.rate, DEFAULT_CONFIG.rate);
  assert.equal(store.config.mode, 'standalone');
  assert.deepEqual(
    effects.map(item => item.name),
    ['kick reset', 'rate schedule', 'rate refresh', 'log', 'appearance', 'state']
  );
  assert.deepEqual(effects.find(item => item.name === 'rate refresh').args, [false]);
  for (const item of effects) assert.deepEqual(item.disk, disk(), item.name + ' sees committed defaults');
  assert.equal(store.getSecret(), oldSecret);
  assert.equal(store.seToken, token('old'));
});

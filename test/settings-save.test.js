// Offline regressions for the modular settings commit boundary and browser save helper.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { ConfigStore } = require('../server/config/store');
const { createHttpRouter } = require('../server/http/router');
const { GoalManager } = require('../server/features/goal');

const credentials = {
  secret_id: 'a'.repeat(32) + ':' + 'b'.repeat(32),
  se_token:
    'header.' +
    Buffer.from(JSON.stringify({ user: 'demo', extra: 'long-enough-payload' })).toString('base64url') +
    '.signature',
  donofa_key: 'old-donofa-key'
};

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-save-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...credentials,
      streamer_id: 42,
      se: { channelId: 'abc123', username: 'demo' },
      mode: 'companion',
      appearance: { textSize: 30 },
      rate: { auto: false, manual: 100000, proxy: '' },
      kick: { enabled: false, channel: 'original', chatroomId: 123, resolvedFor: 'original' },
      goal: { currentToman: 1000, targetToman: 2000, subCount: 2 },
      app: { autostart: false, updateCheck: false },
      files: [{ id: '1234567890', file: 'sample.png', name: 'Sample', minToman: 1000 }]
    })
  );
  const store = new ConfigStore({
    dataDir: dir,
    logger() {},
    secretStore: { available: () => true, encrypt: value => Buffer.from(value).toString('base64') }
  });
  const effects = [];
  const effect =
    name =>
    (...args) =>
      effects.push({ name, args });
  const logger = { info: effect('log'), warn: effect('warn'), error: effect('error'), getRecentLogs: () => [] };
  const sse = {
    sendState: effect('state'),
    broadcast: effect('broadcast'),
    broadcastAppearance: effect('appearance'),
    getState: () => ({})
  };
  const goalManager = new GoalManager({ configStore: store, logger, sse });
  const context = {
    dataDir: dir,
    publicDir: path.join(__dirname, '..', 'public'),
    mediaDir: dir,
    configStore: store,
    logger,
    sse,
    goalManager,
    rateManager: {
      currentRate: () => 100000,
      scheduleRate: effect('rate schedule'),
      refreshRate: effect('rate refresh')
    },
    kickChatClient: {
      resetConnection: effect('kick reset'),
      startKeepAlive: effect('kick keepalive'),
      resolveKickChannel: async () => {
        effects.push({ name: 'kick resolve' });
        return true;
      },
      connect: effect('kick connect'),
      kickState: { connected: false }
    },
    donofaBridge: {
      start: effect('bridge start'),
      refresh: effect('bridge refresh'),
      publicState: () => ({ configured: true })
    },
    appVersion: 'test'
  };
  const server = http.createServer(createHttpRouter(context));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  store.config.port = server.address().port;
  t.after(async () => {
    store.stop();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const request = (method, route, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: store.config.port,
          path: route,
          method,
          headers: { 'Content-Type': 'application/json' }
        },
        res => {
          let raw = '';
          res.on('data', chunk => (raw += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
        }
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return { dir, configPath, store, effects, request };
}

for (const failure of ['write', 'rename']) {
  test(`settings ${failure} failure preserves disk, active settings, credentials and effects; retry commits`, async t => {
    const { configPath, store, effects, request } = await fixture(t);
    const before = structuredClone(store.publicConfig());
    const root = store.config;
    const file = store.config.files[0];
    const diskBefore = fs.readFileSync(configPath, 'utf8');
    const saveMethod = failure === 'write' ? 'writeFileSync' : 'renameSync';
    const original = fs[saveMethod];
    let block = true,
      attempts = 0;
    t.mock.method(fs, saveMethod, function (...args) {
      if (args[0] === configPath + '.sync.tmp') {
        attempts++;
        if (block) throw Object.assign(new Error('disk failure at ' + configPath), { code: 'ENOSPC' });
      }
      return original.apply(this, args);
    });
    const body = {
      mode: 'standalone',
      showAlertWithoutMedia: false,
      appearance: { textSize: 45 },
      profiles: { special: { textSize: 50 } },
      app: { updateCheck: true, recordHistory: false },
      goal: { title: 'Edited goal', currentToman: 0 },
      donofa: { timer: true, goal: true, endpoint: 'com' },
      kick: { enabled: true, channel: 'https://kick.com/@Edited' },
      rate: { auto: true, manual: 120000 },
      chatCommands: { enabled: true },
      files: [
        { id: file.id, name: 'Edited' },
        { id: file.id, volume: 20 }
      ]
    };
    const cases = [
      ['POST', '/api/config', body],
      ['PATCH', '/api/file', { id: file.id, name: 'Edited', minToman: 2000 }],
      ['POST', '/api/reset-settings', {}],
      ['PUT', '/api/rules', { enabled: true, items: [] }],
      ['POST', '/api/goal', { title: 'Edited goal', currentToman: 0 }],
      ['POST', '/api/goal/reset', { targetToman: 3000 }]
    ];
    for (const [method, route, payload] of cases) {
      const response = await request(method, route, payload);
      assert.equal(response.status, 500, route);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.code, 'settings_save_failed');
      assert.match(response.body.error, /ذخیره نشد/);
      assert.ok(!JSON.stringify(response.body).includes(configPath), 'no disk paths disclosed');
      assert.deepEqual(store.publicConfig(), before, route + ' leaves live config untouched');
      assert.equal(store.config, root, 'root object identity retained');
      assert.equal(store.config.files[0], file, 'failed file draft never replaces active entry');
      assert.equal(fs.readFileSync(configPath, 'utf8'), diskBefore);
      assert.deepEqual(effects, [], 'no state, goal, appearance, reconnect, scheduler or success log effects');
    }
    assert.equal(attempts, cases.length, 'one persistence attempt per handler');
    block = false;
    const retry = await request('POST', '/api/config', body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.ok, true);
    assert.equal(store.config, root);
    assert.equal(store.config.files[0].name, 'Edited');
    assert.equal(store.config.files[0].volume, 20, 'repeated ids build on staged edits');
    assert.equal(store.config.appearance.textSize, 45);
    assert.equal(store.config.kick.channel, 'edited');
    assert.equal(store.config.kick.chatroomId, null);
    assert.equal(store.config.goal.completedCelebrated, false);
    assert.equal(store.config.donofa.endpoint, 'ir', 'bridge flags cannot replace listener endpoint');
    assert.equal(retry.body.config.donofa.timer, true);
    assert.equal(retry.body.config.donofa.goal, true);
    for (const name of [
      'kick reset',
      'kick resolve',
      'kick connect',
      'rate schedule',
      'rate refresh',
      'bridge start',
      'appearance',
      'state'
    ])
      assert.ok(
        effects.some(effect => effect.name === name),
        name + ' runs after persistence'
      );
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.appearance.textSize, 45);
    for (const [key, value] of Object.entries(credentials)) {
      assert.equal(saved[key], undefined, 'available OS encryption retained');
      assert.equal(Buffer.from(saved[key + '_enc'], 'base64').toString(), value);
      assert.ok(!JSON.stringify(retry.body).includes(value), 'credentials not exposed to controller');
    }
    const patch = await request('PATCH', '/api/file', { id: file.id, minToman: 2000 });
    assert.equal(patch.body.file.minToman, 2000);
    const reset = await request('POST', '/api/reset-settings', {});
    assert.equal(reset.body.ok, true);
    assert.equal(store.config.files[0].minToman, 2000, 'reset preserves files');
    assert.equal(store.config.app.updateCheck, true, 'reset preserves app settings');
    for (const [method, route, payload] of cases.slice(3)) {
      const response = await request(method, route, payload);
      assert.equal(response.status, 200, route + ' retries successfully');
      assert.equal(response.body.ok, true);
    }
  });
}

test('invalid batch remains atomic and duplicate-id validation is preserved', async t => {
  const { store, effects, request, configPath } = await fixture(t);
  const before = structuredClone(store.config);
  const bytes = fs.readFileSync(configPath, 'utf8');
  const response = await request('POST', '/api/config', {
    appearance: { textSize: 50 },
    files: [
      { id: '1234567890', minToman: 5000 },
      { id: '1234567890', maxToman: 2000 }
    ]
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'invalid_amount_range');
  assert.deepEqual(store.config, before);
  assert.deepEqual(effects, []);
  assert.equal(fs.readFileSync(configPath, 'utf8'), bytes);
});

test('existing Donofa accounts default bridge off and refresh uses the independent bridge', async t => {
  const { store, effects, request } = await fixture(t);
  assert.equal(store.publicConfig().donofa.configured, true);
  assert.equal(store.publicConfig().donofa.timer, false);
  assert.equal(store.publicConfig().donofa.goal, false);
  const response = await request('POST', '/api/donofa/refresh');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.donofaBridge.configured, true);
  assert.deepEqual(
    effects.map(effect => effect.name),
    ['bridge refresh']
  );
});

test('saveConfig reports failure before a first config exists and supports retry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-save-start-'));
  const store = new ConfigStore({ dataDir: dir });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(store.cfgPath + '.sync.tmp');
  assert.equal(store.saveConfig(), false);
  fs.rmdirSync(store.cfgPath + '.sync.tmp');
  assert.equal(store.saveConfig(), true);
  assert.ok(fs.existsSync(store.cfgPath));
});

test('a failed settings commit invalidates older async snapshots without losing live state', async t => {
  const { store, configPath } = await fixture(t);
  let release;
  const hold = new Promise(resolve => {
    release = resolve;
  });
  const originalWrite = fs.promises.writeFile;
  t.mock.method(fs.promises, 'writeFile', async function (...args) {
    await hold;
    return originalWrite.apply(this, args);
  });
  const pending = store.saveConfigAsync();
  const originalRename = fs.renameSync;
  t.mock.method(fs, 'renameSync', function (...args) {
    if (args[0] === configPath + '.sync.tmp') throw new Error('rename blocked');
    return originalRename.apply(this, args);
  });
  const bytes = fs.readFileSync(configPath, 'utf8');
  assert.equal(store.commitSettings({ ...store.config, mode: 'standalone' }), false);
  release();
  await pending;
  assert.equal(store.config.mode, 'companion');
  assert.equal(fs.readFileSync(configPath, 'utf8'), bytes, 'older async write cannot overtake failed commit');
});

function browserApi(fetch) {
  const feedback = { textContent: '', className: '', classList: { remove() {} } };
  const context = vm.createContext({
    window: {},
    document: { querySelector: () => feedback },
    fetch,
    setTimeout() {},
    clearTimeout() {}
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
  vm.runInContext(source.replace(/^export /gm, ''), context);
  return { context, feedback };
}

test('settingsRequest rejects disk, HTTP, malformed JSON, invalid result and network failures without throwing', async () => {
  const responses = [
    async () => ({ ok: false, json: async () => ({ ok: false, code: 'settings_save_failed', error: 'Disk full' }) }),
    async () => ({ ok: false, json: async () => ({ ok: true }) }),
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      }
    }),
    async () => ({ ok: true, json: async () => null }),
    async () => ({ ok: true, json: async () => ({ error: 'no success' }) }),
    async () => {
      throw new Error('offline');
    }
  ];
  for (const fetch of responses) {
    const { context, feedback } = browserApi(fetch);
    const result = await vm.runInContext("settingsRequest('/api/config', {mode: 'companion'})", context);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    const saved = await vm.runInContext("saveSettings({mode: 'companion'})", context);
    assert.equal(saved, false);
    assert.match(feedback.className, /err/);
    assert.ok(feedback.textContent);
  }
});

test('settings helpers preserve methods, JSON payloads and successful response fields', async () => {
  const requests = [];
  const { context, feedback } = browserApi(async (route, options) => {
    requests.push({ route, ...options });
    return { ok: true, json: async () => ({ ok: true, file: { id: '1234567890' } }) };
  });
  assert.equal(await vm.runInContext("saveSettings({mode: 'companion'})", context), true);
  const result = await vm.runInContext("patch('/api/file', {id: '1234567890'})", context);
  assert.equal(result.file.id, '1234567890');
  await vm.runInContext("settingsRequest('/api/rules', {items: []}, 'PUT')", context);
  assert.deepEqual(
    requests.map(request => request.method),
    ['POST', 'PATCH', 'PUT']
  );
  assert.deepEqual(JSON.parse(requests[0].body), { mode: 'companion' });
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.equal(feedback.className, '', 'save helper does not claim UI success');
});

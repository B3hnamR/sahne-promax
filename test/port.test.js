'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { parseSeActivity, StreamElementsClient } = require('../server/integrations/streamelements');
const { parseBaha24, FX_CODES } = require('../server/rates/baha24');
const { parseBonbastFx } = require('../server/rates/bonbast');
const { ConfigStore } = require('../server/config/store');
const { createZipArchive, importBackupFromFile } = require('../server/features/backup');
const { parseRange } = require('../server/utils/validation');
const { createServer } = require('../server');

const jwt = ['e30', Buffer.from(JSON.stringify({ sub: 'channel' })).toString('base64url'), 'signature'].join('.');
const token = jwt + 'abcdefghijklmnopqrstuvwxyz0123456789';

test('StreamElements tips normalize currency and enter the paid-tip queue once', async () => {
  const tip = parseSeActivity({
    _id: 'abc123',
    type: 'tip',
    data: { amount: 5.25, currency: 'eur', displayName: 'Viewer', message: 'hi' }
  });
  assert.equal(tip.stripe_pi_id, 'se_abc123');
  assert.equal(tip.currency, 'EUR');
  assert.equal(tip.amount_total, 525);
  assert.equal(tip.is_local, true);
  assert.equal(parseSeActivity({ _id: 'follow', type: 'follow', data: {} }), null);

  const approved = [];
  const sent = [];
  class Socket {
    constructor() {
      this.readyState = 0;
    }
    send(value) {
      sent.push(JSON.parse(value));
    }
    close() {
      this.readyState = 3;
    }
  }
  const configStore = {
    seToken: token,
    config: { se: { channelId: 'channel123', username: 'Streamer' }, mode: 'standalone' }
  };
  const queue = {
    approved,
    pending: [],
    playing: null,
    tipSummary: t => ({ id: t.stripe_pi_id }),
    enqueueApproved: t => approved.push(t),
    tryNext: () => {}
  };
  const client = new StreamElementsClient({
    configStore,
    queue,
    playedStore: { isPlayed: () => false },
    rateManager: {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    sse: { sendState: () => {} },
    WebSocketCtor: Socket,
    fetchProfile: async () => ({ _id: 'channel123', username: 'Streamer', provider: 'kick' })
  });
  assert.equal((await client.verifyToken(token)).channelId, 'channel123');
  client.connect();
  const socket = client.socket;
  socket.readyState = 1;
  client.handleSocketMessage(socket, JSON.stringify({ type: 'welcome' }));
  assert.equal(sent[0].data.token, token);
  client.handleSocketMessage(socket, JSON.stringify({ type: 'response', data: {} }));
  assert.equal(client.status(), 'connected');
  client.handleSocketMessage(
    socket,
    JSON.stringify({
      type: 'message',
      topic: 'channel.activities',
      data: {
        _id: 'abc123',
        type: 'tip',
        data: { amount: 5.25, currency: 'eur', displayName: 'Viewer' }
      }
    })
  );
  assert.equal(approved.length, 1);
  assert.equal(approved[0].currency, 'EUR');
  assert.equal(client.handleActivity({ _id: 'abc123', type: 'tip', data: { amount: 5.25 } }), false);
  client.stop();
});

test('FX parsers retain upstream currency coverage and reject missing rates', () => {
  assert.ok(FX_CODES.includes('MYR') && FX_CODES.includes('OMR'));
  const quote = parseBaha24([
    { symbol: 'USD', sell: '220,000' },
    { symbol: 'EUR', sell: '255,000' },
    { symbol: 'MYR', sell: '49,000' },
    { symbol: 'OMR', sell: '570,000' }
  ]);
  assert.equal(quote.usd, 220000);
  assert.equal(quote.fx.EUR, 255000);
  assert.equal(quote.fx.MYR, 49000);
  assert.equal(parseBonbastFx({ eur1: '256,000', omr1: '571,000' }).OMR, 571000);
  assert.equal(parseBonbastFx({ xyz1: '100' }).XYZ, undefined);
});

test('secret storage reports providers separately and reload clears removed credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-port-'));
  try {
    const store = new ConfigStore({
      dataDir: dir,
      secretStore: { available: () => true, encrypt: v => 'enc:' + v, decrypt: v => v.slice(4) }
    });
    store.setSecret('kick-secret');
    store.config.streamer_id = 'streamer';
    store.setSeToken(token);
    store.config.se = { channelId: 'channel123', username: 'Streamer', provider: 'kick' };
    store.saveConfig();
    assert.equal(store.publicConfig().kickbot.secretStorage, 'os');
    assert.equal(store.publicConfig().streamelements.secretStorage, 'os');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ se: { channelId: null }, streamer_id: null }));
    store.config = store.loadConfig();
    assert.equal(store.getSecret(), '');
    assert.equal(store.seToken, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup import bounds the declared uncompressed config size; reversed byte ranges are rejected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-backup-bound-'));
  try {
    const archivePath = path.join(dir, 'archive.zip');
    fs.writeFileSync(archivePath, createZipArchive({ 'config.json': Buffer.alloc(9 * 1024 * 1024, 65) }));
    await assert.rejects(importBackupFromFile(dir, archivePath, { configStore: {}, logger: {}, sse: {} }), /too large/);
    assert.equal(parseRange('bytes=5-4', 20), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('StreamElements setup and disconnect keep the JWT out of public API responses', async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-se-api-'));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ port, kick: { enabled: false }, rate: { auto: false } })
  );
  class Socket {
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.readyState = 3;
    }
  }
  const srv = createServer({
    dataDir: dir,
    testHooks: {
      offline: true,
      WebSocketCtor: Socket,
      fetchStreamElementsProfile: async () => ({ _id: 'channel123', username: 'Streamer', provider: 'kick' })
    }
  });
  await srv.start();
  const url = `http://127.0.0.1:${port}`;
  try {
    const setup = await fetch(url + '/api/se/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    assert.equal(setup.status, 200);
    const snapshot = await (await fetch(url + '/api/config')).json();
    assert.equal(snapshot.config.streamelements.configured, true);
    assert.equal(snapshot.state.se.configured, true);
    assert.ok(!JSON.stringify(snapshot).includes(token));
    const disconnected = await fetch(url + '/api/se/disconnect', { method: 'POST' });
    assert.equal(disconnected.status, 200);
    assert.equal((await (await fetch(url + '/api/config')).json()).config.streamelements.configured, false);
    srv.configStore.setSeToken(token);
    srv.configStore.config.se = { channelId: 'channel123', username: 'Streamer' };
    srv.configStore.saveConfig();
    srv.clearData();
    const saved = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    assert.ok(!saved.includes(token));
    assert.ok(!saved.includes('se_token'));
  } finally {
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

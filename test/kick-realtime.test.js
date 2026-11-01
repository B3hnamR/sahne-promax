'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { KickChatClient, pusherUrl, parseKickRealtime, KICK_PUSHER_KEYS } = require('../server/integrations/kick-chat');
const { DEFAULT_CONFIG, KICK_REALTIME_API, KICK_REALTIME_RETRY } = require('../server/constants');

const discovered = { key: 'abcdef0123456789abcd', cluster: 'eu' };
const answer = (creds = discovered) => ({
  status: 200,
  text: JSON.stringify({
    data: { connections: [{ provider: 'pusher', credentials: { app_key: creds.key, cluster: creds.cluster } }] }
  })
});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, opts = {}) {
  const sockets = [];
  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
    message(event, data) {
      this.onmessage({ data: JSON.stringify({ event, data }) });
    }
  }
  let saves = 0;
  const queued = [],
    support = [],
    requests = [],
    routes = [];
  const configStore = {
    config: structuredClone(DEFAULT_CONFIG),
    saveConfig() {
      saves++;
    }
  };
  Object.assign(configStore.config.kick, { channel: 'demo', chatroomId: 123, channelId: 456 });
  const client = new KickChatClient({
    configStore,
    queue: {
      approved: [],
      enqueueApproved(tip) {
        queued.push(tip);
      },
      tryNext() {},
      showTip(tip) {
        queued.push(tip);
      }
    },
    rateManager: {
      currentRate: () => 100000,
      async routesFor(...args) {
        routes.push(args);
        return [''];
      }
    },
    logger: { info() {}, warn() {} },
    sse: { sendState() {} },
    WebSocketCtor: Socket,
    onSupport: tip => support.push(tip),
    httpsRequestFn: async (...args) => {
      requests.push(args);
      return answer();
    },
    ...opts
  });
  t.after(() => client.stop());
  return { client, configStore, sockets, queued, support, requests, routes, saves: () => saves };
}

test('stale channel lookups cannot overwrite a newer channel or persist after stop', async t => {
  const waiting = new Map();
  const { client, configStore, saves } = fixture(t, {
    httpsRequestFn: url => new Promise(resolve => waiting.set(url.split('/').pop(), resolve))
  });
  const kick = configStore.config.kick;
  kick.channel = 'alice';
  kick.resolvedFor = null;
  const alice = client.resolveKickChannel();
  await tick();
  client.resetConnection();
  kick.channel = 'bob';
  const bob = client.resolveKickChannel();
  await tick();
  waiting.get('bob')({ status: 200, text: JSON.stringify({ id: 2, chatroom: { id: 200 } }) });
  assert.equal(await bob, true);
  waiting.get('alice')({ status: 200, text: JSON.stringify({ id: 1, chatroom: { id: 100 } }) });
  assert.equal(await alice, false);
  assert.equal(kick.channel, 'bob');
  assert.equal(kick.chatroomId, 200);
  assert.equal(saves(), 1);
  kick.channel = 'charlie';
  const charlie = client.resolveKickChannel();
  await tick();
  client.stop();
  waiting.get('charlie')({ status: 200, text: JSON.stringify({ id: 3, chatroom: { id: 300 } }) });
  assert.equal(await charlie, false);
  assert.equal(kick.chatroomId, 200);
  assert.equal(saves(), 1);
});

test('KICK gifts feed the bridge once at exact store value without creating an alert', t => {
  const { client, sockets, support, queued } = fixture(t);
  client.connect();
  const event = { id: 'gift-123', sender: { username: 'Viewer' }, gift: { amount: 1 } };
  sockets[0].message('App\\Events\\KicksGifted', JSON.stringify(event));
  sockets[0].message('App\\Events\\KicksGifted', event);
  assert.equal(support.length, 1);
  assert.equal(support[0].stripe_pi_id, 'kicks_gift-123');
  assert.equal(support[0].bridge_usd, 0.0105);
  assert.equal(support[0].kind, 'kicks');
  assert.equal(support[0].count, 1);
  assert.equal(queued.length, 0);
  client.handleKicks(null);
  client.handleKicks({ amount: 0 });
  assert.equal(support.length, 1);
});

function rejectSocket(sock, code = 4001, stringify = false) {
  const data = { code, message: 'App key not in this cluster' };
  sock.message('pusher:error', stringify ? JSON.stringify(data) : data);
  sock.onclose();
}

test('Kick realtime validates Pusher URLs and untrusted provider responses', () => {
  assert.equal(KICK_PUSHER_KEYS[0].key, '34bf7a0ff419a2a775b9');
  assert.equal(KICK_PUSHER_KEYS[1].key, '32cbd69e4b950bf97679');
  assert.ok(KICK_PUSHER_KEYS.every(c => pusherUrl(c.key, c.cluster)));
  assert.equal(DEFAULT_CONFIG.kick.pusherKey, null);
  assert.equal(DEFAULT_CONFIG.kick.pusherCluster, null);
  assert.equal(
    pusherUrl(KICK_PUSHER_KEYS[0].key, 'us2'),
    'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.4.0&flash=false'
  );
  for (const [key, cluster] of [
    ['', 'us2'],
    [null, 'us2'],
    ['ABCDEF0123456789ABCD', 'us2'],
    ['abcdef0123456789abc', 'us2'],
    ['abcdef0123456789abcd/x', 'us2'],
    [discovered.key, ''],
    [discovered.key, 'US2'],
    [discovered.key, 'us2.evil.com/'],
    [discovered.key, 'a'.repeat(21)]
  ])
    assert.equal(pusherUrl(key, cluster), null);
  assert.deepEqual(parseKickRealtime(answer().text), discovered);
  assert.deepEqual(
    parseKickRealtime(
      JSON.stringify({
        data: {
          connections: [
            { provider: 'centrifugo', credentials: { url: 'wss://example.com' } },
            { provider: 'pusher', credentials: { app_key: 'ABCDEF0123456789ABCD', cluster: 'US2' } }
          ]
        }
      })
    ),
    { key: discovered.key, cluster: 'us2' }
  );
  for (const text of [
    '',
    'not json',
    '<html>cloudflare</html>',
    'null',
    '[]',
    '{"data":null}',
    '{"data":{"connections":"x"}}',
    '{"data":{"connections":[null,{"provider":"pusher"}]}}',
    '{"data":{"connections":[{"provider":"pusher","credentials":"key"}]}}',
    '{"data":{"connections":[{"provider":"pusher","credentials":{"app_key":"../../x","cluster":"us2"}}]}}',
    '{"data":{"connections":[{"provider":"centrifugo","credentials":{"url":"wss://example.com"}}]}}'
  ])
    assert.equal(parseKickRealtime(text), null, text);
});

test('known keys connect synchronously offline and cached validated credentials take priority', t => {
  const f = fixture(t);
  assert.equal(f.client.connect(), undefined);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].url, pusherUrl(KICK_PUSHER_KEYS[0].key, 'us2'));
  f.client.connect();
  assert.equal(f.sockets.length, 1);
  assert.equal(f.requests.length, 0);
  f.client.resetConnection();
  Object.assign(f.configStore.config.kick, { pusherKey: discovered.key, pusherCluster: discovered.cluster });
  f.client.connect();
  assert.equal(f.sockets[1].url, pusherUrl(discovered.key, discovered.cluster));
  assert.equal(f.requests.length, 0);
  f.client.resetConnection();
  f.configStore.config.kick.pusherCluster = 'us2.evil.com/';
  f.client.connect();
  assert.equal(f.sockets[2].url, pusherUrl(KICK_PUSHER_KEYS[0].key, 'us2'));
});

test('Pusher key rejection skips known keys, discovers via network routes, and persists the cache', async t => {
  const f = fixture(t);
  f.client.connect();
  rejectSocket(f.sockets[0], 4001, true);
  f.client.connect();
  assert.equal(f.sockets[1].url, pusherUrl(KICK_PUSHER_KEYS[1].key, 'us2'));
  assert.equal(f.requests.length, 0, 'fallback works without Kick access');
  rejectSocket(f.sockets[1], 4003);
  const pending = f.client.connect();
  assert.equal(f.client.connect(), pending, 'single flight connection');
  await pending;
  assert.equal(f.sockets[2].url, pusherUrl(discovered.key, discovered.cluster));
  assert.deepEqual(f.routes, [[KICK_REALTIME_API, false]]);
  assert.equal(f.requests.length, 1);
  const [url, options, timeout] = f.requests[0];
  assert.equal(url, KICK_REALTIME_API);
  assert.equal(options.method, 'POST');
  assert.equal(options.proxy, '');
  assert.equal(timeout, 10000);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(options.body));
  const body = JSON.parse(options.body);
  assert.equal(body.client.type, 'web');
  assert.match(body.client.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(body.capabilities.accepted_providers, [{ provider: 'pusher' }]);
  assert.equal(f.configStore.config.kick.pusherKey, discovered.key);
  assert.equal(f.configStore.config.kick.pusherCluster, discovered.cluster);
  assert.equal(f.saves(), 1);
  f.client.resetConnection();
  f.client.connect();
  assert.equal(f.sockets[3].url, pusherUrl(discovered.key, discovered.cluster));
  assert.equal(f.requests.length, 1, 'cached discovery remains synchronous');
});

test('discovery tries proxy routes for HTTP, parsing and network failures', async t => {
  const calls = [];
  const f = fixture(t, {
    kickPusherKeys: [],
    rateManager: {
      currentRate: () => 0,
      routesFor: async () => ['', 'http://localhost:1234', 'http://localhost:2345', 'http://localhost:3456']
    },
    httpsRequestFn: async (url, opts) => {
      calls.push(opts.proxy);
      if (calls.length === 1) return { status: 403, text: 'blocked' };
      if (calls.length === 2) return { status: 200, text: '<html>not JSON</html>' };
      if (calls.length === 3) throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
      return answer();
    }
  });
  await f.client.connect();
  assert.equal(calls.length, 4);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.saves(), 1);
});

test('rejected discovery credentials stop route retries, throttle, and retry immediately after settings reset', async t => {
  let now = 0;
  let calls = 0;
  const f = fixture(t, {
    kickPusherKeys: [],
    now: () => now,
    rateManager: { routesFor: async () => ['', 'http://localhost:1234'] },
    httpsRequestFn: async () => {
      calls++;
      return answer();
    }
  });
  f.client.kickRejected.add(discovered.key);
  await f.client.connect();
  assert.equal(calls, 1, 'the same refused app is definitive across routes');
  assert.equal(f.sockets.length, 0);
  assert.equal(f.client.status(), 'error');
  assert.match(f.client.kickState.hint, /VPN/);
  assert.equal(f.saves(), 0);
  await f.client.connect();
  assert.equal(calls, 1);
  now = KICK_REALTIME_RETRY - 1;
  await f.client.connect();
  assert.equal(calls, 1);
  now++;
  await f.client.connect();
  assert.equal(calls, 2);
  f.client.resetConnection();
  await f.client.connect();
  assert.equal(calls, 3);
  assert.ok(f.client.kickRejected.has(discovered.key), 'saving does not resurrect a refused key');
});

test('route discovery failure is handled without unhandled rejections or sockets', async t => {
  let calls = 0;
  const f = fixture(t, {
    kickPusherKeys: [],
    rateManager: {
      routesFor: async () => {
        calls++;
        throw new Error('route lookup failed');
      }
    }
  });
  await f.client.connect();
  await f.client.connect();
  assert.equal(calls, 1);
  assert.equal(f.client.status(), 'error');
  assert.equal(f.sockets.length, 0);
});

test('late discoveries cannot change config or open sockets after reset, stop or disabling Kick', async t => {
  for (const action of ['reset', 'stop', 'disable']) {
    let release;
    const f = fixture(t, {
      kickPusherKeys: [],
      httpsRequestFn: () =>
        new Promise(resolve => {
          release = resolve;
        })
    });
    const pending = f.client.connect();
    await tick();
    if (action === 'reset') f.client.resetConnection();
    if (action === 'stop') f.client.stop();
    if (action === 'disable') f.configStore.config.kick.enabled = false;
    release(answer());
    await pending;
    assert.equal(f.sockets.length, 0, action);
    assert.equal(f.saves(), 0, action);
    assert.equal(f.configStore.config.kick.pusherKey, null, action);
  }
});

test('reset permits a new lookup without letting the old flight clear or replace it', async t => {
  const releases = [];
  const f = fixture(t, { kickPusherKeys: [], httpsRequestFn: () => new Promise(resolve => releases.push(resolve)) });
  const old = f.client.connect();
  await tick();
  f.client.resetConnection();
  const current = f.client.connect();
  await tick();
  releases[0](answer(KICK_PUSHER_KEYS[0]));
  await old;
  assert.equal(f.client.connect(), current);
  assert.equal(f.sockets.length, 0);
  releases[1](answer());
  await current;
  assert.equal(f.sockets.length, 1);
  assert.equal(f.configStore.config.kick.pusherKey, discovered.key);
  assert.equal(f.saves(), 1);
});

test('transient errors do not reject keys and stale socket events do not touch replacement state', t => {
  const f = fixture(t);
  f.client.connect();
  const old = f.sockets[0];
  old.message('pusher:error', { code: 4201 });
  assert.equal(f.client.kickRejected.size, 0);
  f.client.resetConnection();
  f.client.connect();
  const current = f.sockets[1];
  current.readyState = 1;
  current.message('pusher:connection_established');
  assert.deepEqual(
    current.sent.map(m => m.data.channel),
    ['chatrooms.123.v2', 'chatroom_123', 'channel.456']
  );
  old.message('pusher:error', { code: 4001 });
  old.message('App\\Events\\SubscriptionEvent', { username: 'stale' });
  old.onclose();
  assert.equal(f.client.kickRejected.size, 0);
  assert.equal(f.client.status(), 'connected');
  assert.equal(f.support.length, 0);
  current.message('pusher:ping');
  assert.equal(current.sent.at(-1).event, 'pusher:pong');
  f.client.stop();
  current.message('App\\Events\\SubscriptionEvent', { username: 'stopped' });
  current.onclose();
  assert.equal(f.client.kickCloseTimer, null);
  assert.equal(f.support.length, 0);
});

test('real sub/gift support is deduped before overlay gating; tests and chat commands are not support', t => {
  const f = fixture(t);
  f.client.connect();
  const sock = f.sockets[0];
  f.configStore.config.kick.showNewSubs = false;
  const sub = { username: 'viewer', months: 6 };
  sock.message('App\\Events\\SubscriptionEvent', JSON.stringify(sub));
  sock.message('App\\Events\\SubscriptionEvent', sub);
  assert.equal(f.queued.length, 0);
  assert.equal(f.support.length, 1);
  assert.equal(f.support[0].source, 'kick');
  assert.equal(f.support[0].count, 1);
  assert.equal(f.support[0].months, 6);
  assert.equal(f.support[0].kind, 'sub');
  sock.message('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'gifter', gifted_usernames: ['a', 'b'] });
  sock.message('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'gifter', gifted_usernames: ['b', 'a'] });
  assert.equal(f.support.length, 2);
  assert.equal(f.support[1].kind, 'gift');
  assert.equal(f.support[1].count, 2);
  assert.equal(f.queued.length, 1);
  f.client.handleSub('preview', 1, true);
  f.client.handleGift('preview', ['x'], true);
  assert.equal(f.support.length, 2);
  assert.equal(f.queued.length, 3);
  Object.assign(f.configStore.config.chatCommands, {
    enabled: true,
    userCooldownSec: 0,
    globalCooldownSec: 0,
    entries: [{ command: 'dance', fileId: 'dance-file' }]
  });
  f.configStore.config.files.push({ id: 'dance-file', file: 'dance.mp4' });
  const chat = { id: 'message-1', content: '!dance', sender: { username: 'viewer' } };
  sock.message('App\\Events\\ChatMessageEvent', chat);
  sock.message('App\\Events\\ChatMessageEvent', chat);
  assert.equal(f.queued.length, 4);
  assert.equal(f.queued[3].kind, 'command');
  assert.equal(f.queued[3].commandFileId, 'dance-file');
  assert.equal(f.support.length, 2);
});

test('a failing optional support callback does not suppress alerts', t => {
  const f = fixture(t, {
    onSupport: () => {
      throw new Error('bridge unavailable');
    }
  });
  f.client.handleSub('viewer');
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0].source, 'kick');
});

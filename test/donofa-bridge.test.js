// Adapted from upstream's Donofa bridge tests. The separate donofa.test.js covers the inbound ProMax listener.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDonofaBridge: createCoreBridge, readGoal, readTimer } = require('../server/donofa');
const { createDonofaBridge, createDonofaRequest, createDonofaFeed } = require('../server/integrations/donofa-bridge');

const KEY = '0f3e2a10-1b2c-4d5e-8f90-a1b2c3d4e5f6';
function fakeDonofa(over = {}) {
  const d = {
    goal: {
      id: 12,
      title: 'Goal',
      unit: 'IRT',
      initial: 0,
      progress: 1000000,
      total: 100000000,
      is_active: true,
      sources: { sub: { kick: false } },
      ...over.goal
    },
    timer: {
      status: 'running',
      remaining: 3600,
      rates: { donation: { amount: 10000, seconds: 1, enabled: true }, 'sub:kick': { enabled: false } },
      ...over.timer
    },
    calls: [],
    fail: {}
  };
  d.request = async (method, p, body, key = KEY) => {
    d.calls.push(method + ' ' + p);
    if (key !== KEY) return { status: 401, json: {} };
    const fail = d.fail[method + ' ' + p];
    if (fail === 'throw') throw new Error('timeout');
    if (typeof fail === 'number') return { status: fail, json: {} };
    const g = d.goal;
    let result;
    if (method === 'GET' && p === '/api/v2/goals/default') result = { goal: { ...g } };
    else if (method === 'GET' && p === '/api/v2/timer') result = { timer: { ...d.timer } };
    else if (method === 'POST' && p === '/api/v2/goals/' + g.id) {
      if (body && 'initial' in body) g.initial = Number(body.initial); // changing initial never moves progress
      result = { goal: { ...g } };
    } else if (method === 'POST' && p === '/api/v2/goals/' + g.id + '/reset') {
      g.progress = g.initial;
      result = { goal: { ...g } };
    } else if (method === 'POST' && p === '/api/v2/timer/extend') {
      if (['running', 'paused'].includes(d.timer.status)) d.timer.remaining += body.seconds;
      result = {};
    } else return { status: 404, json: {} };
    if (fail === 'lost') throw new Error('timeout');
    return { status: 200, json: result };
  };
  return d;
}
function bridge(t, d, extra = {}) {
  const dir = extra.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-donofa-'));
  const logs = [];
  const b = createCoreBridge({
    dataDir: dir,
    getKey: () => extra.key || KEY,
    getSettings: () => extra.settings || { timer: true, goal: true },
    getRate: () => (extra.rate === undefined ? 100000 : extra.rate),
    request: (...args) => d.request(...args),
    log: (...args) => logs.push(args),
    WebSocket: null,
    pollMs: 3600000,
    ...extra.options
  });
  t.after(() => {
    b.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { b, dir, logs };
}
const add = (b, id = 'pi_1', extra = {}) => b.add({ id, kind: 'tip', name: 'Ali', toman: 100000, ...extra });
const posts = d => d.calls.filter(c => c.startsWith('POST'));

test('account reset preserves queued supports if journal clearing or credential persistence fails', async t => {
  const d = fakeDonofa();
  const { b, dir } = bridge(t, d);
  add(b, 'old-account-support');
  let committed = 0;
  const rename = fs.renameSync;
  const failing = t.mock.method(fs, 'renameSync', (...args) => {
    if (args[1] === path.join(dir, 'donofa.json')) throw new Error('disk full');
    return rename(...args);
  });
  assert.equal(
    await b.reset(() => {
      committed++;
      return true;
    }),
    false
  );
  assert.equal(committed, 0);
  assert.equal(b._state().queue[0].id, 'old-account-support');
  failing.mock.restore();
  assert.equal(await b.reset(() => false), false);
  assert.equal(b._state().queue[0].id, 'old-account-support');
  assert.equal(
    await b.reset(() => {
      throw new Error('restore rename failed');
    }),
    false
  );
  assert.equal(b._state().queue[0].id, 'old-account-support');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'donofa.json'))).queue[0].id, 'old-account-support');
  assert.equal(
    await b.reset(() => {
      committed++;
      return true;
    }),
    true
  );
  assert.equal(committed, 1);
  assert.equal(b._state().queue.length, 0);
});

test('failed old-account goal repair blocks reset without discarding its recovery marker', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  b._state().restore = { id: 12, initial: 0 };
  d.fail['POST /api/v2/goals/12'] = 500;
  let committed = false;
  assert.equal(
    await b.reset(() => {
      committed = true;
      return true;
    }),
    false
  );
  assert.equal(committed, false);
  assert.deepEqual(b._state().restore, { id: 12, initial: 0 });
  delete d.fail['POST /api/v2/goals/12'];
  assert.equal(await b.reset(), true);
});

test('bridge polling does not start before explicit startup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const d = fakeDonofa();
  const { b } = bridge(t, d, { options: { pollMs: 1000 } });
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(d.calls.length, 0);
  b.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(d.calls.length > 0);
});

test('delayed playback and pending captures never credit a replacement bridge account', t => {
  let account = 'a'.repeat(64);
  const events = [];
  const feed = createDonofaFeed({
    bridge: {
      accountId: () => account,
      add: event => {
        events.push(event);
        return true;
      }
    },
    rateManager: { tomanFor: amount => amount * 100000 }
  });
  const paid = { stripe_pi_id: 'se_one', source: 'streamelements', amount_total: 100, currency: 'USD', is_local: true };
  assert.equal(feed(paid), true);
  assert.equal(feed(paid), false);
  const pending = { stripe_pi_id: 'pi_pending', amount_total: 100, currency: 'USD' };
  assert.equal(feed(pending), false);
  account = 'b'.repeat(64);
  assert.equal(feed(paid), false);
  pending.captured = true;
  assert.equal(feed(pending), false);
  assert.equal(events.length, 1);
  const { normalizeWaiting } = require('../server/playback/waiting-store');
  assert.equal(normalizeWaiting(paid).bridge_account, 'a'.repeat(64));
  assert.equal(normalizeWaiting(paid).bridge_forwarded, true);
});

test('readGoal / readTimer keep only fields needed by the bridge', () => {
  const g = readGoal({ id: 7, unit: 'irt', initial: '1000', sources: { sub: { kick: true } } });
  assert.deepEqual([g.unit, g.initial, g.subKick, g.active], ['IRT', 1000, true, true]);
  assert.equal(readGoal(null), null);
  const timer = readTimer({
    status: 'paused',
    rates: { donation: { amount: 10000, seconds: 1 }, 'sub:kick': { enabled: true } }
  });
  assert.deepEqual(timer.rate, { amount: 10000, seconds: 1 });
  assert.equal(timer.subKick, true);
  assert.equal(readTimer({ rates: { donation: { amount: 0, seconds: 1 } } }).rate, null);
});

test('a tip updates timer and goal once and restores initial', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  assert.equal(add(b, 'pi_1', { toman: 300000 }), true);
  assert.equal(add(b), false);
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress, d.goal.initial], [3630, 1300000, 0]);
  assert.equal(b._state().queue.length, 0);
  assert.equal(b._state().restore, null);
  await b.flush();
  assert.equal(d.goal.progress, 1300000);
  assert.equal(b.publicState().status, 'connected');
  assert.deepEqual([b.publicState().recent[0].seconds, b.publicState().recent[0].goal], [30, 300000]);
});

test('USD-valued gift subs use the exchange rate and carry fractional seconds', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  add(b, 'gift_a', { kind: 'gift', toman: null, usd: 4.99 * 3, count: 3 });
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress], [3749, 2497000]);
  add(b, 'gift_b', { kind: 'gift', toman: null, usd: 4.99, count: 1 });
  await b.flush();
  assert.equal(d.timer.remaining, 3799);
});

test('a missing USD rate keeps the sub queued instead of counting zero', async t => {
  const d = fakeDonofa();
  let rate = 0;
  const { b } = bridge(t, d, { options: { getRate: () => rate } });
  add(b, 'sub_1', { kind: 'sub', toman: null, usd: 4.99 });
  await b.flush();
  assert.deepEqual([d.timer.remaining, b._state().queue.length], [3600, 1]);
  rate = 100000;
  await b.flush();
  assert.deepEqual([d.timer.remaining, b._state().queue.length], [3649, 0]);
});

test('Donofa Kick-sub switches are reported without suppressing bridge subs', async t => {
  const d = fakeDonofa({
    goal: { sources: { sub: { kick: true } } },
    timer: {
      rates: {
        donation: { amount: 10000, seconds: 1, enabled: true },
        'sub:kick': { enabled: true }
      }
    }
  });
  const { b } = bridge(t, d);
  add(b, 'sub_1', { kind: 'sub', toman: 500000 });
  add(b);
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress], [3660, 1600000]);
  assert.equal(b.publicState().goal.subKick, true);
  assert.equal(b.publicState().timer.subKick, true);
  assert.equal(b.publicState().recent.find(x => x.kind === 'sub').timerNote, null);
});

test('finished timers, disabled rates and switches do not block goal updates', async t => {
  for (const [over, settings, note] of [
    [{ timer: { status: 'finished' } }, undefined, 'no-timer'],
    [{ timer: { rates: { donation: { amount: 10000, seconds: 1, enabled: false } } } }, undefined, 'no-rate'],
    [{}, { timer: false, goal: true }, 'off']
  ]) {
    const d = fakeDonofa(over);
    const { b } = bridge(t, d, { settings });
    add(b);
    await b.flush();
    assert.ok(!posts(d).includes('POST /api/v2/timer/extend'));
    assert.equal(d.goal.progress, 1100000);
    assert.equal(b.publicState().recent[0].timerNote, note);
  }
});

test('piece goals count subs, not monetary tips', async t => {
  const d = fakeDonofa({ goal: { unit: 'piece', progress: 4, total: 100 } });
  const { b } = bridge(t, d);
  add(b, 'gift', { kind: 'gift', usd: 4.99 * 5, count: 5 });
  add(b, 'sub', { kind: 'sub', usd: 4.99, count: 1 });
  add(b);
  await b.flush();
  assert.equal(d.goal.progress, 10);
});

test('explicit failed responses stay queued and retry only unfinished parts', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  d.fail['POST /api/v2/timer/extend'] = 500;
  add(b, 'pi_1', { toman: 200000 });
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress, b.publicState().status], [3600, 1000000, 'error']);
  delete d.fail['POST /api/v2/timer/extend'];
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress], [3620, 1200000]);
  d.fail['POST /api/v2/goals/12/reset'] = 500;
  add(b, 'pi_2');
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress, d.goal.initial], [3630, 1200000, 1300000]);
  delete d.fail['POST /api/v2/goals/12/reset'];
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress, d.goal.initial], [3630, 1300000, 0]);
});

test('a reset with a lost response is verified, not added twice', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  d.fail['POST /api/v2/goals/12/reset'] = 'lost';
  add(b);
  await b.flush();
  delete d.fail['POST /api/v2/goals/12/reset'];
  await b.flush();
  assert.deepEqual([d.goal.progress, d.goal.initial, b._state().queue.length], [1100000, 0, 0]);
});

test('failed initial restoration is repaired after restart without adding the support again', async t => {
  const d = fakeDonofa();
  const original = d.request;
  let failed = false;
  d.request = async (m, p, body, key) => {
    if (!failed && m === 'POST' && p === '/api/v2/goals/12' && body.initial === 0) {
      failed = true;
      return { status: 500, json: {} };
    }
    return original(m, p, body, key);
  };
  const { b, dir } = bridge(t, d);
  add(b);
  await b.flush();
  assert.deepEqual([d.goal.progress, d.goal.initial, b._state().queue.length], [1100000, 1100000, 0]);
  b.stop();
  const { b: restarted } = bridge(t, d, { dir });
  await restarted.flush();
  assert.deepEqual([d.goal.progress, d.goal.initial], [1100000, 0]);
});

test('a rejected API key exposes an error and retains the queued support', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d, { key: 'rejected-key' });
  add(b);
  await b.flush();
  assert.equal(b.publicState().status, 'error');
  assert.match(b.publicState().error, /API Key/);
  assert.equal(b.publicState().queue, 1);
});

test('factory reads existing secret/endpoint and opt-in switches without exposing the key', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-donofa-'));
  const d = fakeDonofa();
  const configStore = { getDonofaKey: () => KEY, config: { donofa: { endpoint: 'com' } } };
  const b = createDonofaBridge({
    dataDir: dir,
    configStore,
    rateManager: { currentRate: () => 100000 },
    request: d.request,
    WebSocketCtor: null,
    pollMs: 3600000
  });
  t.after(() => {
    b.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  b.start();
  await b.refresh();
  await b.flush();
  assert.equal(add(b), false);
  assert.equal(d.calls.length, 0, 'existing listener accounts do not trigger bridge traffic');
  assert.deepEqual([b.publicState().timerOn, b.publicState().goalOn], [false, false]);
  configStore.config.donofa.timer = configStore.config.donofa.goal = true;
  add(b);
  await b.flush();
  assert.deepEqual([d.timer.remaining, d.goal.progress], [3610, 1100000]);
  assert.ok(!JSON.stringify(b.publicState()).includes(KEY));
  assert.ok(!fs.readFileSync(path.join(dir, 'donofa.json'), 'utf8').includes(KEY));
});

test('lost reset plus failed verification is settled from progress on the next flush', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  d.fail['POST /api/v2/goals/12/reset'] = 'lost';
  const original = d.request;
  let gets = 0;
  d.request = async (m, p, body, key) => {
    if (m === 'GET' && p === '/api/v2/goals/default' && ++gets >= 4) {
      d.request = original;
      throw new Error('timeout');
    }
    return original(m, p, body, key);
  };
  add(b);
  await b.flush();
  assert.equal(d.goal.progress, 1100000);
  assert.ok(b._state().inflight.goal);
  delete d.fail['POST /api/v2/goals/12/reset'];
  await b.flush();
  assert.deepEqual(
    [d.goal.progress, d.goal.initial, b._state().queue.length, b._state().inflight.goal],
    [1100000, 0, 0, null]
  );
});

test('restart after an ambiguous timer POST never extends it twice', async t => {
  const d = fakeDonofa();
  const original = d.request;
  d.request = async (m, p, body, key) => {
    const result = await original(m, p, body, key);
    if (m === 'POST' && p === '/api/v2/timer/extend') throw new Error('killed');
    return result;
  };
  const { b, dir } = bridge(t, d);
  add(b);
  await b.flush();
  assert.equal(d.timer.remaining, 3610);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'donofa.json'))).inflight.timer);
  b.stop();
  d.request = original;
  const { b: restarted } = bridge(t, d, { dir });
  await restarted.flush();
  assert.deepEqual(
    [d.timer.remaining, d.goal.progress, restarted.publicState().recent[0].seconds],
    [3610, 1100000, 10]
  );
});

test('a Donofa donation arriving while initial is raised is folded into the reset target', async t => {
  const d = fakeDonofa();
  const { b } = bridge(t, d);
  const original = d.request;
  let raised = false;
  d.request = async (m, p, body, key) => {
    const result = await original(m, p, body, key);
    if (m === 'POST' && p === '/api/v2/goals/12' && body.initial > 0 && !raised) {
      raised = true;
      d.goal.progress += 50000;
    }
    return result;
  };
  add(b);
  await b.flush();
  assert.deepEqual([d.goal.progress, d.goal.initial], [1150000, 0]);
});

test('completed goals stay closed while the timer still receives time', async t => {
  const d = fakeDonofa({ goal: { progress: 100000000, status: 'completed' } });
  const { b } = bridge(t, d);
  add(b);
  await b.flush();
  assert.deepEqual([d.goal.progress, d.timer.remaining], [100000000, 3610]);
  assert.ok(!posts(d).includes('POST /api/v2/goals/12/reset'));
  assert.equal(b.publicState().recent[0].goalNote, 'completed');
});

test('reset waits for a running flush whose requests retain the starting key', async t => {
  const d = fakeDonofa();
  let key = KEY;
  const seen = [];
  let release, entered;
  const gate = new Promise(r => {
    release = r;
  });
  const ready = new Promise(r => {
    entered = r;
  });
  const { b } = bridge(t, d, {
    options: {
      getKey: () => key,
      request: async (m, p, body, k) => {
        seen.push(k);
        if (m === 'POST' && p === '/api/v2/timer/extend') {
          entered();
          await gate;
        }
        return d.request(m, p, body, k);
      }
    }
  });
  add(b);
  const flushing = b.flush();
  await ready;
  key = 'another-account';
  const resetting = b.reset();
  release();
  await flushing;
  await resetting;
  assert.ok(seen.length > 3 && seen.every(k => k === KEY));
  assert.equal(d.goal.progress, 1100000);
  assert.equal(b._state().queue.length, 0);
});

test('null socket frames and stale sockets after reset are ignored', async t => {
  const sockets = [];
  class FakeWS {
    constructor() {
      this.readyState = 1;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.onclose?.();
    }
  }
  const d = fakeDonofa();
  const { b } = bridge(t, d, { options: { WebSocket: FakeWS } });
  b.start();
  const old = sockets[0];
  assert.doesNotThrow(() => old.onmessage({ data: 'null' }));
  assert.doesNotThrow(() => old.onmessage({ data: '"str"' }));
  await b.reset();
  b.start();
  const current = sockets[1];
  current.onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  assert.equal(b.publicState().live, true);
  old.onclose();
  old.onmessage({ data: JSON.stringify({ event: 'pusher:connection_established' }) });
  assert.equal(b.publicState().live, true);
  assert.equal(old.sent.length, 0);
  b.stop();
  current.onmessage({ data: JSON.stringify({ event: 'timer.updated', data: { remaining: 99999 } }) });
  assert.notEqual(b.publicState().timer?.remaining, 99999);
  assert.equal(add(b, 'after-stop'), false);
});

test('goal completion is durable before initial restoration saves and a crash interrupts flush', async t => {
  const d = fakeDonofa();
  const { b, dir } = bridge(t, d);
  const original = d.request;
  let snapshot;
  d.request = async (m, p, body, key) => {
    if (m === 'POST' && p === '/api/v2/goals/12' && body.initial === 0)
      snapshot = fs.readFileSync(path.join(dir, 'donofa.json'), 'utf8');
    return original(m, p, body, key);
  };
  add(b);
  await b.flush();
  const saved = JSON.parse(snapshot);
  assert.equal(saved.queue[0].goal, 'done', 'restoration cannot save todo with no inflight marker');
  assert.equal(saved.inflight.goal, null);
  b.stop();
  fs.writeFileSync(path.join(dir, 'donofa.json'), snapshot); // simulate death at the restore request
  const { b: restarted } = bridge(t, d, { dir });
  await restarted.flush();
  assert.equal(d.goal.progress, 1100000);
  assert.equal(d.goal.initial, 0);
});

test('a stale refresh response or rejection cannot repopulate state after reset', async t => {
  for (const fail of [false, true]) {
    const d = fakeDonofa();
    let release;
    const gate = new Promise(r => {
      release = r;
    });
    const { b } = bridge(t, d, {
      options: {
        request: async (...args) => {
          await gate;
          if (fail) throw new Error('old-account error');
          return d.request(...args);
        }
      }
    });
    const refreshing = b.refresh();
    await b.reset();
    release();
    await refreshing;
    assert.equal(b.publicState().goal, null);
    assert.equal(b.publicState().timer, null);
    assert.equal(b.publicState().error, null);
  }
});

test('reset clears delayed donation refreshes and stop never recreates a deleted journal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let socket;
  class FakeWS {
    constructor() {
      this.readyState = 1;
      socket = this;
    }
    send() {}
    close() {
      this.onclose?.();
    }
  }
  const d = fakeDonofa();
  const { b, dir } = bridge(t, d, { options: { WebSocket: FakeWS } });
  b.start();
  await b.flush();
  socket.onmessage({ data: JSON.stringify({ event: 'donate.created' }) });
  await b.reset();
  d.calls.length = 0;
  t.mock.timers.tick(3000);
  await Promise.resolve();
  assert.equal(d.calls.length, 0);
  b.stop();
  fs.rmSync(path.join(dir, 'donofa.json'), { force: true });
  t.mock.timers.tick(7200000);
  await b.flush();
  await b.refresh();
  assert.equal(fs.existsSync(path.join(dir, 'donofa.json')), false);
});

test('failed pre-POST journal writes prevent mutation and a later retry still sends the support', async t => {
  for (const timer of [true, false]) {
    const d = fakeDonofa();
    const { b, dir } = bridge(t, d, { settings: { timer, goal: true } });
    add(b);
    fs.mkdirSync(path.join(dir, 'donofa.json.tmp'));
    await b.flush();
    assert.equal(posts(d).length, 0);
    assert.match(b.publicState().error, /could not be saved/);
    assert.equal(b._state().inflight.timer, null);
    assert.equal(b._state().inflight.goal, null);
    fs.rmSync(path.join(dir, 'donofa.json.tmp'), { recursive: true });
    await b.flush();
    assert.deepEqual([d.timer.remaining, d.goal.progress], [timer ? 3610 : 3600, 1100000]);
  }
});

test('an in-flight request completing after stop cannot recreate a cleared journal or send another POST', async t => {
  const d = fakeDonofa();
  let release, entered;
  const gate = new Promise(r => {
    release = r;
  });
  const ready = new Promise(r => {
    entered = r;
  });
  const { b, dir } = bridge(t, d, {
    options: {
      request: async (m, p, body, key) => {
        if (m === 'POST' && p === '/api/v2/timer/extend') {
          entered();
          await gate;
        }
        return d.request(m, p, body, key);
      }
    }
  });
  add(b);
  const flushing = b.flush();
  await ready;
  b.stop();
  fs.rmSync(path.join(dir, 'donofa.json'), { force: true });
  release();
  await flushing;
  assert.equal(fs.existsSync(path.join(dir, 'donofa.json')), false);
  assert.deepEqual(posts(d), ['POST /api/v2/timer/extend']);
});

test('all 1000 remembered support ids survive restart', async t => {
  const d = fakeDonofa();
  const { b, dir } = bridge(t, d);
  b.stop();
  fs.writeFileSync(
    path.join(dir, 'donofa.json'),
    JSON.stringify({ sent: Array.from({ length: 1000 }, (_, n) => 'id_' + n) })
  );
  const { b: restarted } = bridge(t, d, { dir });
  assert.equal(add(restarted, 'id_999'), false);
  assert.equal(add(restarted, 'id_0'), false);
});

test('transport honors endpoint, proxy, explicit key and JSON byte length', async () => {
  const calls = [];
  const configStore = { getDonofaKey: () => KEY, config: { donofa: { endpoint: 'com' } } };
  const request = createDonofaRequest({
    configStore,
    rateManager: {
      routesFor: async (url, direct) => {
        assert.equal(url, 'https://api.donofa.com/api/v2/timer/extend');
        assert.equal(direct, true);
        return ['http://proxy:8080'];
      }
    },
    httpRequest: async (...args) => {
      calls.push(args);
      return { status: 200, text: '{"ok":true}' };
    }
  });
  assert.deepEqual(await request('POST', '/api/v2/timer/extend', { seconds: 5 }, 'old-key'), {
    status: 200,
    json: { ok: true }
  });
  const [url, options, timeout] = calls[0];
  assert.equal(url, 'https://api.donofa.com/api/v2/timer/extend');
  assert.equal(options.proxy, 'http://proxy:8080');
  assert.equal(options.headers.Authorization, 'Api old-key');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(options.body));
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(timeout, 15000);
});

test('GET retries route failures but not HTTP responses or alternate hosts', async () => {
  let calls = 0;
  const options = {
    configStore: { getDonofaKey: () => KEY, config: { donofa: { endpoint: 'ir' } } },
    rateManager: { routesFor: async () => ['', 'http://proxy:8080'] },
    httpRequest: async url => {
      assert.ok(url.startsWith('https://api.donofa.ir/'));
      if (++calls === 1) throw new Error('timeout');
      return { status: 403, text: 'not json' };
    }
  };
  assert.deepEqual(await createDonofaRequest(options)('GET', '/api/v2/timer'), { status: 403, json: null });
  assert.equal(calls, 2);
  calls = 1;
  await createDonofaRequest(options)('GET', '/api/v2/timer');
  assert.equal(calls, 2, 'an HTTP response is returned without route failover');
});

test('POST never retries another route after any ambiguous failure', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']) {
    let calls = 0;
    const error = Object.assign(new Error('timeout'), { code });
    const request = createDonofaRequest({
      configStore: { getDonofaKey: () => KEY, config: { donofa: { endpoint: 'com' } } },
      rateManager: { routesFor: async () => ['', 'http://proxy:8080'] },
      httpRequest: async () => {
        calls++;
        throw error;
      }
    });
    await assert.rejects(request('POST', '/api/v2/timer/extend', { seconds: 1 }), error);
    assert.equal(calls, 1, code);
  }
});

test('feed excludes inbound Donofa, commands, tests, replays and unconfirmed KickBot tips', () => {
  const accepted = [];
  const feed = createDonofaFeed({
    bridge: {
      add: ev => {
        accepted.push(ev);
        return true;
      }
    },
    rateManager: { tomanFor: amount => amount * 100000 }
  });
  const tip = { stripe_pi_id: 'pi_1', amount_total: 200, tipper_name: 'Ali', currency: 'USD', source: 'kickbot' };
  for (const change of [
    {},
    { source: 'donofa' },
    { source: 'command' },
    { source: 'commands' },
    { source: 'test' },
    { kind: 'command' },
    { is_test: true },
    { is_replay: true }
  ]) {
    assert.equal(feed({ ...tip, ...change }), false);
  }
  assert.equal(feed({ ...tip, captured: true }), true);
  assert.equal(feed({ ...tip }, { confirmed: true }), true);
  assert.equal(feed({ ...tip, source: 'streamelements' }), true);
  assert.deepEqual(accepted[0], { id: 'pi_1', name: 'Ali', kind: 'tip', count: 1, toman: 200000, usd: 2 });
});

test('feed uses cleaned ids, gift counts, one sub regardless of months, foreign FX and exact KICKs USD', () => {
  const accepted = [];
  const feed = createDonofaFeed({
    bridge: {
      add: ev => {
        accepted.push(ev);
        return true;
      }
    },
    rateManager: { tomanFor: (amount, currency) => amount * (currency === 'EUR' ? 120000 : 100000) }
  });
  const tip = { stripe_pi_id: ' id_1 ', tipper_name: ' A\u0000li ', source: 'kick', is_local: true, amount_total: 0 };
  feed({ ...tip, kind: 'sub', count: 12, toman_override: 500000 });
  feed({ ...tip, kind: 'gift', count: 3, toman_override: 1500000 });
  feed({ ...tip, source: 'streamelements', amount_total: 200, currency: 'EUR' });
  feed({ ...tip, kind: 'kicks', amount_total: 1, bridge_usd: 0.0105, currency: 'USD' });
  assert.deepEqual([accepted[0].id, accepted[0].name, accepted[0].count, accepted[0].usd], ['id_1', 'Ali', 1, 4.99]);
  assert.deepEqual([accepted[1].count, accepted[1].usd], [3, 4.99 * 3]);
  assert.deepEqual([accepted[2].toman, accepted[2].usd], [240000, null]);
  assert.deepEqual([accepted[3].toman, accepted[3].usd], [1050, 0.0105]);
});

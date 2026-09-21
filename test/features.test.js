// Sahne ProMax 2.2 — queue priority, milestone confetti, chat commands, goal countdown (run with `node --test`).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const { PlaybackQueue } = require('../server/playback/queue');
const { sanitizeChatCommands, sanitizeGoal } = require('../server/utils/sanitizers');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Queue priority (unit)
// ---------------------------------------------------------------------------

function bareQueue() {
  return new PlaybackQueue({
    configStore: { config: {} },
    playedStore: { isPlayed: () => false, markPlayed: () => {} },
    mediaDir: '',
    logger: { info() {}, warn() {}, error() {} },
    sse: { broadcast() {}, sendState() {}, clientCount: () => 0 },
    rateManager: { currentRate: () => 0, tomanOf: () => 0 },
    captureFn: async () => 'ok',
    publishFn: () => {}
  });
}

test('queue priority: subs/gift-subs jump ahead of tips, FIFO inside each class', () => {
  const q = bareQueue();
  q.enqueueApproved({ stripe_pi_id: 't1', kind: 'tip' });
  q.enqueueApproved({ stripe_pi_id: 's1', kind: 'sub' });
  q.enqueueApproved({ stripe_pi_id: 't2', kind: 'tip' });
  q.enqueueApproved({ stripe_pi_id: 'g1', kind: 'gift' });
  q.enqueueApproved({ stripe_pi_id: 's2', kind: 'sub' });
  assert.deepEqual(
    q.approved.map(t => t.stripe_pi_id),
    ['s1', 'g1', 's2', 't1', 't2'],
    'priority entries keep their arrival order and stay ahead of tips'
  );

  // a replay is never a priority entry (replayLast still unshifts to the very front)
  q.enqueueApproved({ stripe_pi_id: 'r1', kind: 'sub', is_replay: true });
  assert.deepEqual(
    q.approved.map(t => t.stripe_pi_id),
    ['s1', 'g1', 's2', 't1', 't2', 'r1'],
    'replays append like regular traffic'
  );

  // capture retry path uses push() directly and must not be re-prioritized
  const retried = q.approved.pop();
  q.approved.push(retried);
  assert.equal(q.approved[q.approved.length - 1].stripe_pi_id, 'r1');
});

test('queue flood cap: oldest tips are dropped first, subs survive a tips flood', () => {
  const q = bareQueue();
  // 3 priority alerts arrive between 600 tips (pushed straight like KickBot sync does)
  for (let i = 0; i < 200; i++) q.enqueueApproved({ stripe_pi_id: 't' + i, kind: 'tip' });
  q.enqueueApproved({ stripe_pi_id: 's1', kind: 'sub' });
  for (let i = 200; i < 400; i++) q.enqueueApproved({ stripe_pi_id: 't' + i, kind: 'tip' });
  q.enqueueApproved({ stripe_pi_id: 'g1', kind: 'gift' });
  for (let i = 400; i < 600; i++) q.enqueueApproved({ stripe_pi_id: 't' + i, kind: 'tip' });
  q.enqueueApproved({ stripe_pi_id: 's2', kind: 'sub' });
  assert.equal(q.approved.length, 603);

  q.trimApproved(500);
  assert.equal(q.approved.length, 500, 'capped to max');
  const ids = q.approved.map(t => t.stripe_pi_id);
  assert.ok(ids.includes('s1') && ids.includes('g1') && ids.includes('s2'), 'every sub/gift survived the tips flood');
  assert.ok(!ids.includes('t0') && !ids.includes('t102'), 'the oldest tips were dropped first');
  assert.ok(ids.includes('t599'), 'the newest tip stays');

  // a pure tips overflow behaves like the old slice(-max)
  const q2 = bareQueue();
  for (let i = 0; i < 600; i++) q2.enqueueApproved({ stripe_pi_id: 'x' + i, kind: 'tip' });
  q2.trimApproved(500);
  assert.equal(q2.approved[0].stripe_pi_id, 'x100', 'oldest 100 tips dropped');
  assert.equal(q2.approved.length, 500);

  // more priority entries than the cap: the oldest priority entries are dropped only then
  const q3 = bareQueue();
  for (let i = 0; i < 600; i++) q3.enqueueApproved({ stripe_pi_id: 'p' + i, kind: 'sub' });
  q3.trimApproved(500);
  assert.equal(q3.approved.length, 500);
  assert.equal(q3.approved[0].stripe_pi_id, 'p100', 'oldest subs dropped only as a last resort');
});

// ---------------------------------------------------------------------------
// sanitizeChatCommands (unit)
// ---------------------------------------------------------------------------

test('chat commands sanitizer: valid entries only, orphan files dropped, clamps', () => {
  const files = [{ id: 'aaaaaaaaaa' }, { id: 'bbbbbbbbbb' }];
  const out = sanitizeChatCommands(
    {
      enabled: true,
      prefix: '!!',
      globalCooldownSec: 9999,
      userCooldownSec: -5,
      maxPerMinute: 0,
      entries: [
        { command: 'Dance', fileId: 'aaaaaaaaaa' }, // normalized to lowercase
        { command: 'dance', fileId: 'bbbbbbbbbb' }, // duplicate → dropped
        { command: 'bad token!', fileId: 'aaaaaaaaaa' }, // invalid charset → dropped
        { command: 'ghost', fileId: 'cccccccccc' }, // orphan file → dropped
        { command: 'sub', fileId: 'bbbbbbbbbb' } // ok
      ]
    },
    { enabled: false, prefix: '!', globalCooldownSec: 5, userCooldownSec: 30, maxPerMinute: 10, entries: [] },
    files
  );
  assert.equal(out.enabled, true);
  assert.equal(out.prefix, '!!');
  assert.equal(out.globalCooldownSec, 600, 'clamped to max 600s');
  assert.equal(out.userCooldownSec, 0, 'clamped to min 0');
  assert.equal(out.maxPerMinute, 1, 'clamped to min 1');
  assert.deepEqual(out.entries, [
    { command: 'dance', fileId: 'aaaaaaaaaa', enabled: true },
    { command: 'sub', fileId: 'bbbbbbbbbb', enabled: true }
  ]);
  // invalid prefix falls back to the current one
  assert.equal(sanitizeChatCommands({ prefix: 'ab' }, { prefix: '!' }, files).prefix, '!');
  assert.equal(sanitizeChatCommands({ prefix: '?' }, { prefix: '!' }, files).prefix, '?');
});

test('goal sanitizer: countdown + confetti fields validated and clamped', () => {
  const out = sanitizeGoal(
    { mode: 'timed', deadline: 1800000000000, milestoneToman: 250000, confettiOnComplete: false },
    { mode: 'amount', deadline: null, milestoneToman: 0, confettiOnComplete: true, confettiOnFirstSub: true }
  );
  assert.equal(out.mode, 'timed');
  assert.equal(out.deadline, 1800000000000);
  assert.equal(out.milestoneToman, 250000);
  assert.equal(out.confettiOnComplete, false);
  assert.equal(sanitizeGoal({ mode: 'bogus' }, { mode: 'timed' }).mode, 'timed', 'unknown mode ignored');
  assert.equal(sanitizeGoal({ deadline: '' }, { deadline: 123 }).deadline, null, 'empty clears the deadline');
  assert.equal(sanitizeGoal({ deadline: 'soon' }, { deadline: null }).deadline, null);
});

// ---------------------------------------------------------------------------
// Integration: server boot helper
// ---------------------------------------------------------------------------

async function bootServer(t, { captureTip } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-feat-'));
  const port = 8300 + Math.floor(Math.random() * 400);
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ port, rate: { auto: false }, kick: { enabled: false }, app: { autostart: false } })
  );
  const srv = createServer({
    dataDir: dir,
    publicDir: path.join(__dirname, '..', 'public'),
    appVersion: 'test',
    testHooks: { offline: true, captureTip: captureTip || (async () => 'ok') }
  });
  await srv.start();
  srv.playbackQueue.queueDelay = 0;
  const streams = [];
  t.after(async () => {
    for (const r of streams) r.destroy();
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const openSse = role =>
    new Promise((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port, path: `/events?role=${role}` }, res => {
        res.setEncoding('utf8');
        const events = [];
        let buf = '';
        res.on('data', chunk => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = frame.split('\n').find(l => l.startsWith('data: '));
            if (line) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {}
            }
          }
        });
        res.egg = { events };
        resolve({ status: res.statusCode, res, events });
      });
      r.on('error', reject);
      streams.push(r);
    });

  const req = (method, p, body) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          path: p,
          method,
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
          }
        },
        res => {
          let d = '';
          res.on('data', c => (d += c));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(d);
            } catch {}
            resolve({ status: res.statusCode, body: d, json });
          });
        }
      );
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

  return { srv, port, req, openSse };
}

async function uploadMedia(port, name, bytes) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/upload?name=' + encodeURIComponent(name),
        method: 'PUT',
        headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/octet-stream' }
      },
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
      }
    );
    r.on('error', reject);
    r.end(bytes);
  });
}

// ---------------------------------------------------------------------------
// Integration: chat commands
// ---------------------------------------------------------------------------

test('chat commands end to end: mapped file plays, cooldowns and flood cap hold (2.2)', async t => {
  const { srv, req, openSse, port } = await bootServer(t);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('command clip')]);
  const up = await uploadMedia(port, 'command.webm', webm);
  assert.equal(up.status, 200);
  const fileId = up.json.entry.id;

  // invalid entry shapes are dropped server-side
  const cfg = await req('POST', '/api/config', {
    chatCommands: {
      enabled: true,
      prefix: '!',
      globalCooldownSec: 0,
      userCooldownSec: 30,
      maxPerMinute: 10,
      entries: [
        { command: 'dance', fileId },
        { command: 'ghost', fileId: 'ffffffffff' },
        { command: 'bad!', fileId }
      ]
    }
  });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.config.chatCommands.entries.length, 1, 'only the valid entry survives');
  assert.equal(cfg.json.config.chatCommands.entries[0].command, 'dance');

  const { events } = await openSse('overlay');
  await sleep(120);
  const plays = () => events.filter(e => e.type === 'play');
  const celebrates = () => events.filter(e => e.type === 'celebrate');

  // 1. the command plays the mapped file
  srv.testHooks.chatMessage({ id: 'm1', content: '!dance', sender: { username: 'viewer1' } });
  await sleep(200);
  assert.equal(plays().length, 1, 'command alert played');
  assert.match(plays()[0].tip.media.url, /command\.webm/);
  assert.equal(plays()[0].tip.toman, 0, 'commands never carry money');

  // clear the way for the next one
  await req('POST', '/api/control/skip');
  await sleep(120);

  // 2. per-user cooldown blocks the same viewer
  srv.testHooks.chatMessage({ id: 'm2', content: '!dance', sender: { username: 'viewer1' } });
  await sleep(200);
  assert.equal(plays().length, 1, 'user cooldown holds');
  assert.equal(srv.testHooks.queueLength(), 0);

  // 3. a different viewer is allowed
  srv.testHooks.chatMessage({ id: 'm3', content: '!dance', sender: { username: 'viewer2' } });
  await sleep(200);
  assert.equal(plays().length, 2, 'other viewers are not blocked by the per-user cooldown');
  await req('POST', '/api/control/skip');
  await sleep(120);

  // 4. unknown commands and other prefixes do nothing
  srv.testHooks.chatMessage({ id: 'm4', content: '!nope', sender: { username: 'viewer3' } });
  srv.testHooks.chatMessage({ id: 'm5', content: 'dance', sender: { username: 'viewer4' } });
  await sleep(150);
  assert.equal(plays().length, 2, 'unknown command / missing prefix ignored');
  assert.equal(celebrates().length, 0, 'chat commands never celebrate');
  assert.equal(srv.testHooks.queueLength(), 0);

  // 5. disabled → nothing at all
  await req('POST', '/api/config', { chatCommands: { enabled: false } });
  srv.testHooks.chatMessage({ id: 'm6', content: '!dance', sender: { username: 'viewer5' } });
  await sleep(150);
  assert.equal(plays().length, 2, 'disabled commands are off');
});

// ---------------------------------------------------------------------------
// Integration: milestone confetti
// ---------------------------------------------------------------------------

test('milestone confetti: goal complete once, big donation threshold, first sub of the day (2.2)', async t => {
  const { srv, req, openSse } = await bootServer(t);
  const { events } = await openSse('overlay');
  await sleep(120);
  const reasons = () => events.filter(e => e.type === 'celebrate').map(e => e.reason);

  const goalRes = await req('POST', '/api/goal', {
    targetToman: 100000,
    currentToman: 0,
    autoIncrement: true,
    confettiOnComplete: true,
    confettiOnFirstSub: true,
    milestoneToman: 0,
    mode: 'amount',
    deadline: null
  });
  assert.equal(goalRes.status, 200);

  const tip = (id, toman, extra = {}) => ({
    stripe_pi_id: id,
    tipper_name: 'Ali',
    amount_total: 0,
    toman_override: toman,
    approval_status: 'approved',
    is_local: true,
    kind: 'tip',
    ...extra
  });

  // inject one alert and finish it, so the queue is free for the next
  const playTip = async t => {
    srv.testHooks.injectTip(t);
    await sleep(180);
    await req('POST', '/api/done', { id: t.stripe_pi_id });
    await sleep(100);
  };

  // below target: no celebration
  await playTip(tip('c1', 50000));
  assert.deepEqual(reasons(), []);

  // crossing the target celebrates exactly once
  await playTip(tip('c2', 60000));
  assert.deepEqual(reasons(), ['goal_complete']);

  // further donations do not re-celebrate the same completion
  await playTip(tip('c3', 5000));
  assert.deepEqual(reasons(), ['goal_complete']);

  // resetting re-arms the celebration
  await req('POST', '/api/goal/reset', {});
  await sleep(120);
  await playTip(tip('c4', 150000));
  assert.deepEqual(reasons(), ['goal_complete', 'goal_complete'], 'reset arms the next completion');

  // big-donation threshold (0 = off by default)
  await req('POST', '/api/goal', { milestoneToman: 200000 });
  await sleep(80);
  await playTip(tip('c5', 250000));
  assert.deepEqual(reasons(), ['goal_complete', 'goal_complete', 'big_donation']);

  // first sub of the day: real (non-test) sub alerts celebrate once, then stay quiet
  await playTip(tip('s1', 0, { kind: 'sub' }));
  await playTip(tip('s2', 0, { kind: 'sub' }));
  assert.deepEqual(
    reasons(),
    ['goal_complete', 'goal_complete', 'big_donation', 'first_sub'],
    'only the first sub of the day celebrates'
  );

  // test traffic never celebrates nor consumes the day state
  const before = reasons().length;
  await playTip(tip('s3', 0, { kind: 'sub', is_test: true }));
  assert.equal(reasons().length, before, 'test subs stay silent');

  // confetti can be turned off
  await req('POST', '/api/goal', { confettiOnComplete: false, milestoneToman: 0 });
  await req('POST', '/api/goal/reset', {});
  await sleep(120);
  await playTip(tip('c6', 200000)); // completes the goal, but the confetti is off
  const after = events.filter(e => e.type === 'celebrate').length;
  await playTip(tip('c7', 100000));
  assert.equal(events.filter(e => e.type === 'celebrate').length, after, 'complete confetti is off');
});

// ---------------------------------------------------------------------------
// Integration: goal countdown
// ---------------------------------------------------------------------------

test('goal countdown: timed mode fields, expiry, clearing (2.2)', async t => {
  const { req } = await bootServer(t);
  const get = async () => (await req('GET', '/api/goal')).json.goal;

  const fresh = await get();
  assert.equal(fresh.mode, 'amount', 'default mode is amount');
  assert.equal(fresh.deadline, null);
  assert.equal(fresh.remainingMs, null);
  assert.equal(fresh.expired, false);
  assert.ok(typeof fresh.serverNow === 'number');

  const deadline = Date.now() + 3600 * 1000;
  await req('POST', '/api/goal', { mode: 'timed', deadline });
  const timed = await get();
  assert.equal(timed.mode, 'timed');
  assert.equal(timed.deadline, deadline);
  assert.ok(timed.remainingMs > 3500 * 1000 && timed.remainingMs <= 3600 * 1000);
  assert.equal(timed.expired, false);

  // a deadline in the past reports expired with remainingMs 0
  await req('POST', '/api/goal', { deadline: Date.now() - 1000 });
  const past = await get();
  assert.equal(past.expired, true);
  assert.equal(past.remainingMs, 0);

  // switching back to amount clears the deadline
  await req('POST', '/api/goal', { mode: 'amount', deadline: null });
  const back = await get();
  assert.equal(back.mode, 'amount');
  assert.equal(back.deadline, null);
  assert.equal(back.expired, false);

  // the widget page ships the timer element and survives the CSP-less fetch
  const page = await req('GET', '/goal');
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('goal-timer'), 'widget html has the countdown element');
});

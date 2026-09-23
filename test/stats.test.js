// Sahne ProMax 2.3.0 — history ledger, top donors and live counters (run with `node --test`).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const { HistoryStore } = require('../server/config/history');
const { ConfigStore } = require('../server/config/store');
const { importBackupFromFile } = require('../server/features/backup');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function tmpStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-hist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new HistoryStore(dir, { logger: () => {} });
}

// ---------------------------------------------------------------------------
// HistoryStore (unit)
// ---------------------------------------------------------------------------

test('history store: entries, day/donor aggregates, prune, reload, clear', t => {
  const store = tmpStore(t);
  const r1 = store.add({ id: 'a1', name: 'Ali', kind: 'tip', usd: 5, toman: 500000, media: 'a.webm' });
  store.add({ id: 'a2', name: 'ali ', kind: 'tip', toman: 500000 }); // case/space-insensitive donor merge
  store.add({ id: 's1', name: 'Sara', kind: 'sub', toman: 250000, months: 2 });
  store.add({ id: 'g1', name: 'Ali', kind: 'gift', toman: 0, count: 5 });
  store.add({ id: 't1', name: 'Tester', kind: 'tip', toman: 999, test: true });
  store.add({ id: 'r1', name: 'Replay', kind: 'sub', toman: 111, replay: true });

  const day = store.day(r1.day);
  assert.equal(day.alerts, 4, 'test/replay alerts stay out of the day totals');
  assert.equal(day.toman, 1250000);
  assert.equal(day.tips, 2);
  assert.equal(day.subs, 1);
  assert.equal(day.gifts, 5);

  const totals = store.totals();
  assert.equal(totals.toman, 1250000);
  assert.equal(totals.alerts, 4);

  const all = store.getTop('all', 10);
  assert.deepEqual(
    all.map(d => d.name),
    ['ali', 'Sara'],
    'donor names group case-insensitively (latest spelling wins, trimmed)'
  );
  assert.equal(all[0].toman, 1000000, 'Ali merged across spellings');
  assert.equal(all[0].count, 2);
  assert.deepEqual(all[0].rank, 1);

  assert.deepEqual(
    store.getTop('daily', 10).map(d => d.name),
    ['ali', 'Sara'],
    'daily includes everything from today'
  );

  // an entry outside the weekly window only shows up all-time
  store.add({ id: 'old', name: 'Old', kind: 'tip', toman: 9000000, at: Date.now() - 30 * 86400000 });
  assert.ok(!store.getTop('weekly', 10).some(d => d.name === 'Old'), 'old entry outside the weekly window');
  assert.equal(store.getTop('all', 10)[0].name, 'Old', 'all-time keeps it');

  // entries are newest-first and day-filterable
  const entries = store.getEntries({ limit: 10 });
  assert.equal(entries[0].id, 'old');
  assert.equal(store.getEntries({ limit: 10, day: r1.day }).length, 6);
  assert.equal(store.getEntries({ limit: 2 }).length, 2);

  // raw entries are bounded, aggregates are not
  for (let i = 0; i < 20050; i++) store.add({ id: 'x' + i, name: 'D', kind: 'tip', toman: 1 });
  assert.equal(store.entries.length, 20000, 'entries keep the newest 20k');
  assert.equal(store.entries[0].id, 'x50');
  assert.equal(store.totals().toman, 20050 + 1250000 + 9000000);
  assert.equal(store.getTop('all', 5).find(d => d.name === 'D').toman, 20050, 'donor sums survive pruning');

  // persistence round-trip
  store.stop(); // flush pending debounce
  const again = new HistoryStore(path.dirname(store.file), { logger: () => {} });
  assert.equal(again.entries.length, 20000);
  assert.equal(again.totals().alerts, 20055);

  again.clear();
  assert.equal(again.entries.length, 0);
  assert.equal(again.totals().alerts, 0);
  assert.equal(again.getTop('all', 5).length, 0);
});

// ---------------------------------------------------------------------------
// Integration: server boot helper
// ---------------------------------------------------------------------------

async function bootServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-stats-'));
  const port = 8500 + Math.floor(Math.random() * 300);
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ port, rate: { auto: false }, kick: { enabled: false }, app: { autostart: false } })
  );
  const srv = createServer({
    dataDir: dir,
    publicDir: path.join(__dirname, '..', 'public'),
    appVersion: 'test',
    testHooks: { offline: true, captureTip: async () => 'ok' }
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

  const rawReq = (method, p, buffer, contentType) =>
    new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          path: p,
          method,
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            'Content-Type': contentType || 'application/octet-stream',
            'Content-Length': buffer.length
          }
        },
        res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
        }
      );
      r.on('error', reject);
      r.end(buffer);
    });

  return { srv, port, req, rawReq, openSse };
}

// ---------------------------------------------------------------------------
// Integration: counters + history + top
// ---------------------------------------------------------------------------

test('counters, history API/SSE and top donors end to end (2.3.0)', async t => {
  const { srv, req, openSse } = await bootServer(t);
  const overlay = await openSse('overlay');
  const admin = await openSse('admin');
  await sleep(120);

  await req('POST', '/api/goal', {
    targetToman: 5000000,
    currentToman: 0,
    autoIncrement: true,
    confettiOnFirstSub: true,
    showCounters: true
  });

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
  const play = async tp => {
    srv.testHooks.injectTip(tp);
    await sleep(150);
    await req('POST', '/api/done', { id: tp.stripe_pi_id });
    await sleep(80);
  };

  await play(tip('h1', 300000));
  await play(tip('h2', 200000, { kind: 'sub' }));
  await play(tip('h3', 0, { kind: 'gift', count: 3 }));
  await play(tip('h4', 50000));
  assert.equal(overlay.events.filter(e => e.type === 'play').length, 4, 'every alert reached the overlay');

  // live counters on the goal
  const g = (await req('GET', '/api/goal')).json.goal;
  assert.equal(g.subCount, 1);
  assert.equal(g.subsToday, 1);
  assert.equal(g.giftSubCount, 3);
  assert.equal(g.giftCount, 1);
  assert.equal(g.showCounters, true);

  // history API
  const hist = (await req('GET', '/api/history?limit=50')).json;
  assert.equal(hist.entries.length, 4);
  assert.equal(hist.entries[0].id, 'h4', 'newest first');
  assert.equal(hist.today.alerts, 4);
  assert.equal(hist.today.toman, 550000);
  assert.equal(hist.today.subs, 1);
  assert.equal(hist.today.gifts, 3);
  assert.equal(hist.totals.toman, 550000);
  assert.equal(hist.days[0].alerts, 4, 'day summary present');

  // the admin stream got a live update per alert
  const updates = admin.events.filter(e => e.type === 'history_update');
  assert.ok(updates.length >= 4, 'history_update pushed per alert');
  assert.equal(updates[updates.length - 1].dayTotals.toman, 550000);
  assert.equal(updates[updates.length - 1].totals.toman, 550000);

  // top donors
  const top = (await req('GET', '/api/top?range=all')).json;
  assert.equal(top.range, 'all');
  assert.equal(top.donors.length, 1);
  assert.equal(top.donors[0].name, 'Ali');
  assert.equal(top.donors[0].toman, 550000);
  assert.equal(top.donors[0].rank, 1);
  assert.equal((await req('GET', '/api/top?range=daily')).json.donors.length, 1);
  assert.equal((await req('GET', '/api/top?range=bogus')).json.range, 'all', 'unknown range falls back to all');

  // test traffic never pollutes the aggregates
  await play(tip('h5', 999999, { is_test: true }));
  const hist2 = (await req('GET', '/api/history')).json;
  assert.equal(hist2.today.toman, 550000, 'test alert not counted');
  assert.equal(hist2.entries.length, 5, 'but kept in the raw list');
  assert.equal(hist2.entries[0].test, true);
  assert.equal((await req('GET', '/api/top?range=all')).json.donors[0].toman, 550000);

  // reset zeroes the counters too
  await req('POST', '/api/goal/reset', {});
  const afterReset = (await req('GET', '/api/goal')).json.goal;
  assert.equal(afterReset.subCount, 0);
  assert.equal(afterReset.giftSubCount, 0);
  assert.equal(afterReset.subsToday, 0);

  // widget pages ship their elements and are served
  const topPage = await req('GET', '/top');
  assert.equal(topPage.status, 200);
  assert.ok(topPage.body.includes('top-list'), 'top widget markup present');
  assert.equal((await req('GET', '/top.js')).status, 200);
  assert.equal((await req('GET', '/top.css')).status, 200);
  const goalPage = await req('GET', '/goal');
  assert.ok(goalPage.body.includes('goal-counters'), 'goal widget carries the counters row');
  const appPage = await req('GET', '/');
  assert.ok(appPage.body.includes('data-page="history"'), 'controller has the history page');
  assert.ok(appPage.body.includes('hTopUrl'), 'controller has the top-widget URL field');
});

// ---------------------------------------------------------------------------
// Integration: backup carries the history ledger
// ---------------------------------------------------------------------------

test('backup and restore carry the history ledger (2.3.0)', async t => {
  const { srv, port, rawReq } = await bootServer(t);

  const today = new Date();
  const key =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  srv.historyStore.add({ id: 'b1', name: 'Ali', kind: 'tip', toman: 123456, media: 'x.webm' });
  srv.historyStore.stop(); // flush to disk so the backup sees it

  const backup = await rawReq('GET', '/api/backup', Buffer.alloc(0));
  assert.equal(backup.status, 200);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-backup-inspect-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.writeFileSync(path.join(scratch, 'archive.zip'), backup.buffer);
  const scratchStore = new ConfigStore({ dataDir: scratch, logger: () => {} });
  await importBackupFromFile(scratch, path.join(scratch, 'archive.zip'), {
    configStore: scratchStore,
    logger: { info() {}, warn() {}, error() {} },
    sse: { broadcast() {}, sendState() {} }
  });
  const parsed = JSON.parse(fs.readFileSync(path.join(scratch, 'history.json'), 'utf8'));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.days[key].toman, 123456);

  // clear, then restore from the very same archive
  srv.historyStore.clear();
  assert.equal(srv.historyStore.entries.length, 0);
  const restored = await rawReq('POST', '/api/restore', backup.buffer, 'application/zip');
  assert.equal(restored.status, 200);
  assert.equal(srv.historyStore.entries.length, 1, 'history restored from the backup');
  assert.equal(srv.historyStore.totals().toman, 123456);
});

test('history records the matched routing rule and keeps aggregates rule-agnostic', t => {
  const store = tmpStore(t);
  store.add({ id: 'r1', name: 'Ali', kind: 'tip', toman: 5000, rule: 'a1b2c3d4e5', ruleName: 'SE tips' });
  assert.equal(store.entries[0].rule, 'a1b2c3d4e5');
  assert.equal(store.entries[0].ruleName, 'SE tips');
  assert.equal(store.totals().toman, 5000);
  assert.equal(store.getTop('all')[0].toman, 5000);
});

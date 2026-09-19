'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { createServer } = require('../server');

let nextPort = 8100 + Math.floor(Math.random() * 200);

function makeTempDir() {
  const dir = path.join(os.tmpdir(), 'sahne-promax-test-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  return dir;
}

function req(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuf = Buffer.isBuffer(body);
    const payload = isBuf ? body : body != null ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: p,
        method,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          ...(payload
            ? {
                'Content-Type': isBuf ? 'application/zip' : 'application/json',
                'Content-Length': isBuf ? payload.length : Buffer.byteLength(payload)
              }
            : {}),
          ...headers
        }
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(raw.toString('utf8'));
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

test('ProMax: Paired Media & Milestone Sub Alerts', async t => {
  const dir = makeTempDir();
  const mediaDir = path.join(dir, 'media');
  const port = ++nextPort;

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false }
    })
  );

  // Create mock image and mock audio in media dir
  fs.writeFileSync(path.join(mediaDir, 'alert.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(path.join(mediaDir, 'sound.mp3'), Buffer.from('ID3fakeaudio'));

  const srv = createServer({
    dataDir: dir,
    port,
    testHooks: { offline: true }
  });
  await srv.start();

  try {
    // Scan media
    await req(port, 'POST', '/api/scan');

    // Fetch config to locate files
    const confRes = await req(port, 'GET', '/api/config');
    const files = confRes.json.config.files;
    const img = files.find(f => f.file === 'alert.png');
    const snd = files.find(f => f.file === 'sound.mp3');
    assert.ok(img, 'Image file discovered');
    assert.ok(snd, 'Audio file discovered');

    // Update image with paired audio and milestone filters
    const patchRes = await req(port, 'PATCH', '/api/file', {
      id: img.id,
      audioFile: snd.file,
      minMonths: 3,
      maxMonths: 12,
      minCount: 5
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.json.file.audioFile, 'sound.mp3');
    assert.equal(patchRes.json.file.minMonths, 3);
    assert.equal(patchRes.json.file.maxMonths, 12);
    assert.equal(patchRes.json.file.minCount, 5);

    // Verify buildPayload through picker logic
    const { buildPayload } = require('../server/playback/picker');
    const tip = {
      stripe_pi_id: 'test_pi_1',
      tipper_name: 'TestTipper',
      amount_total: 1000,
      kind: 'tip'
    };
    const payload = buildPayload(tip, patchRes.json.file, {
      mediaDir,
      currentRate: () => 1100000,
      tomanOf: u => u * 1100000
    });
    assert.equal(payload.media.audio_url, '/media/sound.mp3');
    assert.equal(payload.media.url, '/media/alert.png');
  } finally {
    await srv.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test('ProMax: Stream Deck & Hardware REST Controls', async t => {
  const dir = makeTempDir();
  const port = ++nextPort;

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false }
    })
  );

  const srv = createServer({
    dataDir: dir,
    port,
    testHooks: { offline: true }
  });
  await srv.start();

  try {
    // 1. Skip when nothing is playing returns skipped: false
    const skip1 = await req(port, 'POST', '/api/control/skip');
    assert.equal(skip1.status, 200);
    assert.equal(skip1.json.skipped, false);

    // 2. Pause and Resume Queue
    const pause = await req(port, 'POST', '/api/control/pause');
    assert.equal(pause.status, 200);
    assert.equal(pause.json.status, 'pause');

    const resume = await req(port, 'POST', '/api/control/resume');
    assert.equal(resume.status, 200);
    assert.equal(resume.json.status, 'play');

    // 3. Mute Toggle
    const mute1 = await req(port, 'POST', '/api/control/mute');
    assert.equal(mute1.status, 200);
    assert.equal(mute1.json.muted, true);

    const mute2 = await req(port, 'POST', '/api/control/mute');
    assert.equal(mute2.status, 200);
    assert.equal(mute2.json.muted, false);

    // 4. Volume Adjustment
    const vol = await req(port, 'POST', '/api/control/volume?val=45');
    assert.equal(vol.status, 200);
    assert.equal(vol.json.volume, 45);

    // 5. Clear Queue
    const clear = await req(port, 'POST', '/api/control/clear');
    assert.equal(clear.status, 200);
    assert.equal(clear.json.ok, true);
  } finally {
    await srv.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test('ProMax: Donation & Sub Goal Engine', async t => {
  const dir = makeTempDir();
  const port = ++nextPort;

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false }
    })
  );

  const srv = createServer({
    dataDir: dir,
    port,
    testHooks: { offline: true }
  });
  await srv.start();

  try {
    // 1. Get initial goal
    const g1 = await req(port, 'GET', '/api/goal');
    assert.equal(g1.status, 200);
    assert.ok(g1.json.goal);
    assert.equal(typeof g1.json.goal.targetToman, 'number');

    // 2. Set new goal
    const g2 = await req(port, 'POST', '/api/goal', {
      title: 'هدف استریم: مانیتور جدید',
      targetToman: 25000000,
      currentToman: 5000000,
      autoReset: false
    });
    assert.equal(g2.status, 200);
    assert.equal(g2.json.goal.title, 'هدف استریم: مانیتور جدید');
    assert.equal(g2.json.goal.targetToman, 25000000);
    assert.equal(g2.json.goal.currentToman, 5000000);

    // 3. Reset goal
    const g3 = await req(port, 'POST', '/api/goal/reset', { targetToman: 30000000 });
    assert.equal(g3.status, 200);
    assert.equal(g3.json.goal.currentToman, 0);
    assert.equal(g3.json.goal.targetToman, 30000000);
  } finally {
    await srv.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test('ProMax: Zero-Dependency 1-Click Backup & Restore (.zip)', async t => {
  const dir = makeTempDir();
  const mediaDir = path.join(dir, 'media');
  const port = ++nextPort;

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false }
    })
  );

  // Put custom media file (header conforming to PNG format)
  fs.writeFileSync(
    path.join(mediaDir, 'streamer_logo.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
  );

  const srv = createServer({
    dataDir: dir,
    port,
    testHooks: { offline: true }
  });
  await srv.start();

  try {
    // Scan and add to config
    await req(port, 'POST', '/api/scan');

    // Update goal so we know it backed up
    await req(port, 'POST', '/api/goal', {
      title: 'پشتیبان پرو مکس',
      targetToman: 99000000
    });

    // 1. Export backup ZIP
    const backupRes = await req(port, 'GET', '/api/backup');
    assert.equal(backupRes.status, 200);
    assert.equal(backupRes.headers['content-type'], 'application/zip');
    assert.ok(backupRes.raw.length > 100, 'Backup ZIP has valid length');

    // Verify ZIP magic header: PK\x03\x04
    assert.equal(backupRes.raw[0], 0x50);
    assert.equal(backupRes.raw[1], 0x4b);
    assert.equal(backupRes.raw[2], 0x03);
    assert.equal(backupRes.raw[3], 0x04);

    // 2. Wipe directory contents to simulate a fresh machine
    fs.unlinkSync(path.join(mediaDir, 'streamer_logo.png'));

    // 3. Restore backup ZIP via POST /api/restore
    const restoreRes = await req(port, 'POST', '/api/restore', backupRes.raw);
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.json.ok, true);
    assert.ok(restoreRes.json.restoredFiles >= 1);

    // Verify restored file exists on disk
    assert.ok(fs.existsSync(path.join(mediaDir, 'streamer_logo.png')), 'Media file restored to disk');

    // Verify restored config
    const confRes = await req(port, 'GET', '/api/config');
    assert.equal(confRes.json.config.goal.title, 'پشتیبان پرو مکس');
    assert.equal(confRes.json.config.goal.targetToman, 99000000);
  } finally {
    await srv.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test('ProMax: ETag Static Caching (304 Not Modified)', async t => {
  const dir = makeTempDir();
  const port = ++nextPort;

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      port,
      rate: { auto: false },
      kick: { enabled: false }
    })
  );

  const srv = createServer({
    dataDir: dir,
    port,
    testHooks: { offline: true }
  });
  await srv.start();

  try {
    // 1. Request static app.css
    const res1 = await req(port, 'GET', '/app.css');
    assert.equal(res1.status, 200);
    const etag = res1.headers['etag'];
    assert.ok(etag, 'ETag header is returned');

    // 2. Request with If-None-Match
    const res2 = await req(port, 'GET', '/app.css', null, { 'If-None-Match': etag });
    assert.equal(res2.status, 304, 'Returns 304 Not Modified on cache hit');
    assert.equal(res2.raw.length, 0, 'No body transferred on 304');
  } finally {
    await srv.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test('ProMax: Nobitex USDTIRT Rate Provider as Primary & Baha24 as Fallback', async () => {
  const { parseNobitex } = require('../server/rates/nobitex');
  const { RateManager } = require('../server/rates/manager');

  // 1. Verify parseNobitex correctly extracts and converts Iranian Rials to Toman
  const mockNobitexResponse = JSON.stringify({
    status: 'ok',
    lastUpdate: 1789811726883,
    lastTradePrice: '2288830',
    bids: [['2288820', '21.8']],
    asks: [['2288840', '10.0']]
  });
  const toman = parseNobitex(mockNobitexResponse);
  assert.equal(toman, 228883, '2,288,830 Rials converted to 228,883 Toman (divided by 10)');

  // Fallback to bids[0][0] when lastTradePrice is empty
  const mockNoLastTrade = JSON.stringify({
    status: 'ok',
    lastTradePrice: null,
    bids: [['2290000', '10']],
    asks: []
  });
  assert.equal(parseNobitex(mockNoLastTrade), 229000);

  // 2. Test RateManager with Nobitex as Primary
  const mockConfigStore = {
    config: {
      rate: { auto: true, manual: 0, value: 0, source: 'none' }
    },
    debouncedSave: () => {}
  };
  const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };
  const mockSse = { broadcast: () => {}, sendState: () => {} };

  // Scenario A: Nobitex succeeds -> source is 'nobitex'
  let baha24Called = false;
  const mgrA = new RateManager({
    configStore: mockConfigStore,
    logger: mockLogger,
    sse: mockSse,
    fetchNobitexFn: async () => 228883,
    fetchBaha24Fn: async () => {
      baha24Called = true;
      return 229500;
    }
  });
  const rateA = await mgrA.refreshRate(true);
  assert.equal(rateA, 228883);
  assert.equal(mockConfigStore.config.rate.source, 'nobitex');
  assert.equal(baha24Called, false, 'Baha24 is not queried when Nobitex succeeds');

  // Scenario B: Nobitex fails -> fallback to Baha24 -> source is 'baha24'
  const mgrB = new RateManager({
    configStore: mockConfigStore,
    logger: mockLogger,
    sse: mockSse,
    fetchNobitexFn: async () => {
      throw new Error('Nobitex rate limit or network unreachable');
    },
    fetchBaha24Fn: async () => 229500
  });
  const rateB = await mgrB.refreshRate(true);
  assert.equal(rateB, 229500);
  assert.equal(mockConfigStore.config.rate.source, 'baha24');

  // Scenario C: Both fail -> retains previous rate and records error
  const mgrC = new RateManager({
    configStore: mockConfigStore,
    logger: mockLogger,
    sse: mockSse,
    fetchNobitexFn: async () => {
      throw new Error('Nobitex down');
    },
    fetchBaha24Fn: async () => {
      throw new Error('Baha24 down');
    }
  });
  const rateC = await mgrC.refreshRate(true);
  assert.equal(rateC, null);
  assert.equal(mockConfigStore.config.rate.value, 229500, 'Previous rate kept when both fail');
  assert.ok(
    mgrC.rateError.includes('nobitex: Nobitex down') && mgrC.rateError.includes('baha24: Baha24 down'),
    'Both errors reported in rateError'
  );
});

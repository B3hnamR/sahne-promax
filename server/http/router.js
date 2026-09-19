'use strict';
const path = require('path');
const crypto = require('crypto');
const { LIMITS, ENUMS, FONTS, CSP_APP, CSP_OVERLAY, CSP_GOAL, DEFAULT_CONFIG } = require('../constants');
const { cleanText, finite, intOrNull } = require('../utils/validation');
const { sanitizeFile, sanitizeAppearance, sanitizeGoal } = require('../utils/sanitizers');
const { serveFile, servePublic } = require('./streaming');
const { handleStreamUpload } = require('../media/upload');
const { exportBackup, importBackup } = require('../features/backup');
const { buildPayload, pickMedia } = require('../playback/picker');

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const b = await readBody(req, 1024 * 1024);
  try {
    const v = JSON.parse(b.toString('utf8') || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function createHttpRouter(context) {
  const {
    dataDir,
    publicDir,
    mediaDir,
    configStore,
    playedStore,
    logger,
    sse,
    rateManager,
    mediaManager,
    playbackQueue,
    kickBotClient,
    kickChatClient,
    goalManager,
    appVersion,
    openPathFn
  } = context;

  const hostAllowed = req => {
    const h = String(req.headers.host || '').toLowerCase();
    const port = configStore.config.port;
    return LOCAL_HOSTS.some(n => h === n || h === `${n}:${port}`);
  };

  const originAllowed = req => {
    const o = req.headers.origin;
    if (o == null) return true;
    const s = String(o).toLowerCase();
    const port = configStore.config.port;
    return LOCAL_HOSTS.some(n => s === `http://${n}:${port}`);
  };

  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const STATIC_PATTERN =
    /^\/(app\.css|app\.js|overlay\.css|overlay\.js|goal\.html|goal\.js|goal\.css|licenses\.html|licenses\.js)$/;

  return async function handleHttpRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';

    if (!hostAllowed(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('forbidden host');
    }

    if (MUTATING.has(req.method) && !originAllowed(req)) {
      logger.warn('درخواست خارجی رد شد (origin)', { origin: String(req.headers.origin).slice(0, 100), path: p });
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('forbidden origin');
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Friendly URL aliases
    if (/^\/(overlay|overlay\.html|overly|overlai|alert|alerts|browser|source)$/.test(p)) p = '/overlay';
    if (/^\/(app|admin|panel|index\.html|admin\.html|app\.html)$/.test(p)) p = '/';
    if (/^\/(goal|goal\.html|widget\/goal)$/.test(p)) p = '/goal';

    try {
      // Pages & Static Assets
      if (p === '/') return serveFile(req, res, path.join(publicDir, 'app.html'), { csp: CSP_APP });
      if (p === '/overlay') return serveFile(req, res, path.join(publicDir, 'overlay.html'), { csp: CSP_OVERLAY });
      if (p === '/goal') return serveFile(req, res, path.join(publicDir, 'goal.html'), { csp: CSP_GOAL });

      if (
        STATIC_PATTERN.test(p) ||
        p.startsWith('/js/') ||
        p.startsWith('/css/') ||
        p.startsWith('/fonts/') ||
        p.startsWith('/brand/') ||
        p.startsWith('/legal/')
      ) {
        const isFont = p.startsWith('/fonts/');
        return servePublic(req, res, publicDir, decodeURIComponent(url.pathname.slice(1)), { isImmutable: isFont });
      }

      if (p.startsWith('/media/')) {
        const fileName = path.basename(decodeURIComponent(url.pathname.slice(7)));
        return serveFile(req, res, path.join(mediaDir, fileName));
      }

      // Server-Sent Events (SSE)
      if (p === '/events') {
        const role = url.searchParams.get('role') || 'overlay';
        const profile = url.searchParams.get('profile') || 'default';
        if (!['overlay', 'admin', 'preview', 'goal'].includes(role)) {
          return json(res, 400, { error: 'bad role' });
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write(':ok\n\n');
        sse.addClient(role, res);

        if (role === 'overlay' || role === 'preview') {
          const appearance = configStore.getEffectiveAppearance(profile);
          res.write(`data: ${JSON.stringify({ type: 'config', appearance, profile })}\n\n`);
        } else if (role === 'goal') {
          res.write(`data: ${JSON.stringify({ type: 'goal_update', goal: goalManager.getPublicGoal() })}\n\n`);
        } else if (role === 'admin') {
          res.write(`data: ${JSON.stringify({ type: 'config', appearance: configStore.config.appearance })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'state', state: sse.getState ? sse.getState() : {} })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'goal_update', goal: goalManager.getPublicGoal() })}\n\n`);
        }

        req.on('close', () => {
          sse.removeClient(role, res);
          if (role === 'overlay') sse.sendState();
        });

        if (role === 'overlay') {
          logger.info('اورلی (Browser Source) وصل شد', { profile });
          sse.sendState();
          playbackQueue.tryNext();
        }
        return;
      }

      // ProMax Hardware / Stream Deck Control REST Endpoints
      if ((p === '/api/control/skip' || p === '/api/skip') && req.method === 'POST') {
        const skipped = playbackQueue.skipCurrent();
        return json(res, 200, { ok: true, skipped });
      }

      if ((p === '/api/control/replay' || p === '/api/replay') && req.method === 'POST') {
        const replayed = playbackQueue.replayLast();
        return json(res, 200, { ok: true, replayed });
      }

      if ((p === '/api/control/pause' || p === '/api/pause') && req.method === 'POST') {
        playbackQueue.setQueueStatus('pause');
        return json(res, 200, { ok: true, status: 'pause' });
      }

      if ((p === '/api/control/resume' || p === '/api/resume') && req.method === 'POST') {
        playbackQueue.setQueueStatus('play');
        return json(res, 200, { ok: true, status: 'play' });
      }

      if ((p === '/api/control/mute' || p === '/api/mute') && req.method === 'POST') {
        const muted = playbackQueue.toggleMute();
        return json(res, 200, { ok: true, muted });
      }

      if ((p === '/api/control/volume' || p === '/api/volume') && req.method === 'POST') {
        const body = await readJson(req);
        const val = url.searchParams.get('val') !== null ? url.searchParams.get('val') : body.volume;
        const vol = playbackQueue.setVolume(val);
        return json(res, 200, { ok: true, volume: vol });
      }

      if ((p === '/api/control/clear' || p === '/api/clear') && req.method === 'POST') {
        playbackQueue.clearQueue();
        return json(res, 200, { ok: true });
      }

      // ProMax Goal Widget Endpoints
      if (p === '/api/goal' && req.method === 'GET') {
        return json(res, 200, { ok: true, goal: goalManager.getPublicGoal() });
      }

      if (p === '/api/goal' && req.method === 'POST') {
        const body = await readJson(req);
        const updated = goalManager.setGoal(body);
        return json(res, 200, { ok: true, goal: updated });
      }

      if (p === '/api/goal/reset' && req.method === 'POST') {
        const body = await readJson(req);
        goalManager.resetGoal(body.targetToman);
        return json(res, 200, { ok: true, goal: goalManager.getPublicGoal() });
      }

      // ProMax 1-Click Backup & Restore Endpoints
      if (p === '/api/backup' && req.method === 'GET') {
        try {
          const zipBuffer = await exportBackup(dataDir, configStore);
          const filename = `sahne-promax-backup-${new Date().toISOString().slice(0, 10)}.zip`;
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': zipBuffer.length
          });
          return res.end(zipBuffer);
        } catch (e) {
          logger.error('تهیه نسخه پشتیبان ناموفق بود', e.message);
          return json(res, 500, { error: 'تهیه نسخه پشتیبان با خطا مواجه شد' });
        }
      }

      if (p === '/api/restore' && req.method === 'POST') {
        try {
          const zipBuffer = await readBody(req, 512 * 1024 * 1024);
          const result = await importBackup(dataDir, zipBuffer, { configStore, logger, sse });
          return json(res, 200, { ok: true, ...result });
        } catch (e) {
          logger.error('بازیابی نسخه پشتیبان ناموفق بود', e.message);
          return json(res, 400, { error: e.message || 'فایل پشتیبان نامعتبر است' });
        }
      }

      // Controller Configuration Endpoints
      if (p === '/api/config' && req.method === 'GET') {
        return json(res, 200, {
          config: configStore.publicConfig(),
          state: sse.getState ? sse.getState() : {},
          logs: logger.getRecentLogs(),
          mediaDir,
          dataDir,
          effectiveRate: rateManager.currentRate(),
          version: appVersion,
          fonts: FONTS
        });
      }

      if (p === '/api/config' && req.method === 'POST') {
        const body = await readJson(req);
        const config = configStore.config;

        if (body.appearance) config.appearance = sanitizeAppearance(body.appearance, config.appearance);
        if (body.profiles && typeof body.profiles === 'object') {
          config.profiles = { ...config.profiles, ...body.profiles };
        }
        if (body.goal && typeof body.goal === 'object') {
          config.goal = sanitizeGoal(body.goal, config.goal);
        }

        if (Array.isArray(body.files)) {
          for (const raw of body.files) {
            const cur = raw && config.files.find(x => x.id === raw.id);
            if (!cur) continue;
            const merged = sanitizeFile({ ...cur, ...raw, id: cur.id, file: cur.file, size: cur.size });
            if (merged) Object.assign(cur, merged);
          }
        }

        if (body.mode && ENUMS.mode.includes(body.mode)) config.mode = body.mode;
        if (typeof body.showAlertWithoutMedia === 'boolean') config.showAlertWithoutMedia = body.showAlertWithoutMedia;
        if (body.app && typeof body.app === 'object') {
          config.app = {
            ...config.app,
            autostart: body.app.autostart === undefined ? config.app.autostart : !!body.app.autostart
          };
        }

        if (body.kick && typeof body.kick === 'object') {
          const k = body.kick;
          const prevSlug = config.kick.channel;
          const prevEnabled = config.kick.enabled;
          const next = { ...config.kick };
          if ('enabled' in k) next.enabled = !!k.enabled;
          if ('showNewSubs' in k) next.showNewSubs = !!k.showNewSubs;
          if ('giftValueToman' in k) next.giftValueToman = finite(k.giftValueToman, 0, 1e12, 0);
          if ('subValueToman' in k) next.subValueToman = finite(k.subValueToman, 0, 1e12, 0);
          if (typeof k.channel === 'string') {
            next.channel = k.channel
              .trim()
              .toLowerCase()
              .replace(/^https?:\/\/(www\.)?kick\.com\//, '')
              .replace(/^@/, '')
              .replace(/[^a-z0-9_.-]/g, '')
              .slice(0, 40);
          }
          config.kick = next;
          if (config.kick.channel !== prevSlug) {
            config.kick.chatroomId = null;
            config.kick.channelId = null;
            config.kick.resolvedFor = null;
          }
          configStore.saveConfig();
          if (kickChatClient.kws) {
            try {
              kickChatClient.kws.close();
            } catch {}
            kickChatClient.kws = null;
          }
          if (config.kick.enabled) {
            kickChatClient.resolveKickChannel().then(ok => {
              if (ok) kickChatClient.connect();
            });
          } else if (prevEnabled) {
            kickChatClient.kickState.connected = false;
          }
        }

        if (body.rate && typeof body.rate === 'object') {
          const r = body.rate;
          config.rate = {
            ...config.rate,
            auto: !!r.auto,
            manual: intOrNull(r.manual, 1000, 1e9),
            intervalMin: Math.max(LIMITS.minRateInterval, finite(r.intervalMin, LIMITS.minRateInterval, 1440, 2)),
            proxy: /^(https?:\/\/[^\s]{1,200})?$/.test(String(r.proxy ?? '').trim())
              ? String(r.proxy ?? '').trim()
              : config.rate.proxy
          };
          rateManager.scheduleRate();
          if (config.rate.auto) rateManager.refreshRate(false);
        }

        configStore.saveConfig();
        sse.broadcast('overlay', { type: 'config', appearance: config.appearance });
        sse.broadcast('preview', { type: 'config', appearance: config.appearance });
        sse.sendState();
        return json(res, 200, { ok: true, config: configStore.publicConfig() });
      }

      if (p === '/api/file' && req.method === 'PATCH') {
        const body = await readJson(req);
        const f = configStore.config.files.find(x => x.id === body.id);
        if (!f) return json(res, 404, { error: 'not found' });
        const merged = sanitizeFile({ ...f, ...body, id: f.id, file: f.file, size: f.size });
        if (!merged) return json(res, 400, { error: 'invalid' });
        Object.assign(f, merged);
        configStore.saveConfig();
        sse.sendState();
        return json(res, 200, { ok: true, file: f });
      }

      if (p === '/api/upload' && (req.method === 'PUT' || req.method === 'POST')) {
        const orig = decodeURIComponent(url.searchParams.get('name') || 'file');
        return handleStreamUpload(req, res, { mediaManager, origName: orig, json });
      }

      if (p === '/api/scan' && req.method === 'POST') {
        const result = await mediaManager.scanMediaDirectory();
        return json(res, 200, { ok: true, ...result, files: configStore.config.files });
      }

      if (p === '/api/file' && req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const deleted = await mediaManager.deleteFile(id);
        return json(res, 200, { ok: true, deleted });
      }

      // Test & Preview Endpoints
      if (p === '/api/test' && req.method === 'POST') {
        const t = playbackQueue.makeTestTip(await readJson(req));
        if (configStore.config.mode === 'companion') {
          playbackQueue.showTip(t);
        } else {
          playbackQueue.approved.push(t);
          playbackQueue.tryNext();
        }
        if (sse.clientCount('overlay') === 0) {
          logger.warn('هیچ Browser Source ای متصل نیست؛ دونیت تستی در صف ماند');
        }
        sse.sendState();
        return json(res, 200, { ok: true, tip: playbackQueue.tipSummary(t) });
      }

      if (p === '/api/preview' && req.method === 'POST') {
        const body = await readJson(req);
        let t;
        if (body.kind === 'gift') {
          const n = Math.max(1, Math.min(100, finite(body.count, 1, 100, 3)));
          t = kickChatClient.localEvent(
            'gift',
            cleanText(body.name, LIMITS.name) || 'Tester',
            n * kickChatClient.subValueToman('gift'),
            Array.from({ length: n }, (_, i) => 'viewer' + (i + 1)).join('، '),
            n,
            ['giftsub', 'gift', 'sub']
          );
          t.is_test = true;
        } else if (body.kind === 'sub') {
          t = kickChatClient.localEvent(
            'sub',
            cleanText(body.name, LIMITS.name) || 'Tester',
            kickChatClient.subValueToman('sub'),
            '',
            1,
            ['sub', 'newsub'],
            body.months || 1
          );
          t.is_test = true;
        } else {
          t = playbackQueue.makeTestTip(body);
        }

        const media = body.fileId ? configStore.config.files.find(f => f.id === body.fileId) : null;
        const payload = buildPayload(t, media, {
          mediaDir,
          currentRate: () => rateManager.currentRate(),
          tomanOf: usd => rateManager.tomanOf(usd)
        });
        sse.broadcast('preview', { type: 'play', tip: payload });
        return json(res, 200, { ok: true });
      }

      if (p === '/api/test-sub' && req.method === 'POST') {
        const body = await readJson(req);
        const n = Math.max(1, Math.min(100, finite(body.count, 1, 100, 1)));
        if (body.kind === 'sub') {
          kickChatClient.handleSub(cleanText(body.name, LIMITS.name) || 'Tester', finite(body.months, 1, 240, 1), true);
        } else {
          kickChatClient.handleGift(
            cleanText(body.name, LIMITS.name) || 'Tester',
            Array.from({ length: n }, (_, i) => 'viewer' + (i + 1)),
            true
          );
        }
        return json(res, 200, { ok: true });
      }

      if (p === '/api/simulate' && req.method === 'GET') {
        const per = kickChatClient.subValueToman('sub');
        const perGift = kickChatClient.subValueToman('gift');
        const sim = (toman, tags) => {
          const m = pickMedia(
            { amount_total: 0, tip_message: '', tags, toman_override: toman },
            {
              config: configStore.config,
              mediaDir,
              currentRate: () => rateManager.currentRate()
            }
          );
          return m ? { id: m.id, name: m.name, file: m.file } : null;
        };
        const rows = [{ label: 'sub', toman: per, media: sim(per, ['sub', 'newsub']) }];
        for (const n of [1, 2, 3, 5, 10, 20]) {
          rows.push({
            label: 'gift',
            count: n,
            toman: n * perGift,
            media: sim(n * perGift, ['giftsub', 'gift', 'sub'])
          });
        }
        return json(res, 200, { ok: true, rate: rateManager.currentRate(), rows });
      }

      // KickBot Setup & Disconnect
      if (p === '/api/setup' && req.method === 'POST') {
        const body = await readJson(req);
        const raw = String(body.url || '')
          .trim()
          .slice(0, 500);
        const m =
          /tipping\/([0-9a-f]{32})(?::|%3A|%3a)([0-9a-f]{32})/i.exec(raw) ||
          /^([0-9a-f]{32}):([0-9a-f]{32})$/i.exec(raw);
        if (!m) {
          return json(res, 400, {
            error: 'لینک ویجت معتبر نیست. باید شبیه https://widgets.kickbot.com/external/tipping/....%3A.... باشد'
          });
        }
        const sec = `${m[1]}:${m[2]}`.toLowerCase();
        let streamer = null;
        try {
          const r = await fetch(`https://widgets.kickbot.com/external/tipping/${encodeURIComponent(sec)}/__data.json`, {
            signal: AbortSignal.timeout(15000)
          });
          const j = await r.json();
          for (const node of j.nodes || []) {
            const d = node && node.data;
            if (!Array.isArray(d) || !d[0] || typeof d[0] !== 'object') continue;
            if (d[0].streamer_db_id != null) {
              streamer = d[d[0].streamer_db_id];
              break;
            }
          }
        } catch (e) {
          return json(res, 502, {
            error: 'اتصال به کیک‌بات ممکن نشد: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)
          });
        }

        if (!Number.isFinite(Number(streamer))) {
          return json(res, 400, { error: 'کیک‌بات این لینک را نشناخت (Streamer ID پیدا نشد)' });
        }

        configStore.setSecret(sec);
        configStore.config.streamer_id = Number(streamer);
        configStore.saveConfig();
        logger.info('لینک ویجت کیک‌بات تنظیم شد', {
          streamer_id: configStore.config.streamer_id,
          secretStorage: configStore.secretStorage
        });
        if (kickBotClient.ws) {
          try {
            kickBotClient.ws.close();
          } catch {}
        } else {
          kickBotClient.connect();
        }
        sse.sendState();
        return json(res, 200, {
          ok: true,
          streamer_id: configStore.config.streamer_id,
          secretStorage: configStore.secretStorage
        });
      }

      if (p === '/api/disconnect-kickbot' && req.method === 'POST') {
        kickBotClient.disconnect();
        return json(res, 200, { ok: true });
      }

      if (p === '/api/reset-settings' && req.method === 'POST') {
        configStore.config.appearance = { ...DEFAULT_CONFIG.appearance };
        configStore.config.kick = { ...DEFAULT_CONFIG.kick };
        configStore.config.rate = { ...DEFAULT_CONFIG.rate };
        configStore.config.mode = 'standalone';
        configStore.saveConfig();
        logger.info('تنظیمات به حالت اولیه برگشت');
        sse.broadcast('overlay', { type: 'config', appearance: configStore.config.appearance });
        sse.broadcast('preview', { type: 'config', appearance: configStore.config.appearance });
        sse.sendState();
        return json(res, 200, { ok: true, config: configStore.publicConfig() });
      }

      if (p === '/api/refresh-rate' && req.method === 'POST') {
        const val = await rateManager.refreshRate(true);
        return json(res, 200, { ok: true, toman: val, rate: configStore.config.rate });
      }

      if (p === '/api/done' && req.method === 'POST') {
        const body = await readJson(req);
        playbackQueue.finishPlaying(body.id, false, false);
        return json(res, 200, { ok: true });
      }

      if (p === '/api/open' && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof openPathFn === 'function') {
          openPathFn(body.target);
        }
        return json(res, 200, { ok: true });
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    } catch (e) {
      logger.error('HTTP router error', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  };
}

module.exports = {
  createHttpRouter
};

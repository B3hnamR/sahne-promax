'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { LIMITS, ENUMS, FONTS, CSP_APP, CSP_OVERLAY, CSP_GOAL, CSP_TOP, DEFAULT_CONFIG } = require('../constants');
const { cleanText, finite, intOrNull } = require('../utils/validation');
const { localDayKey } = require('../utils/time');
const { computeAnalytics } = require('../features/analytics');
const { sanitizeFile, sanitizeAppearance, sanitizeChatCommands, validateRules } = require('../utils/sanitizers');
const { serveFile, servePublic } = require('./streaming');
const { handleStreamUpload } = require('../media/upload');
const { exportBackupToFile, importBackupFromFile, MAX_ARCHIVE_BYTES } = require('../features/backup');
const { buildPayload, pickMedia } = require('../playback/picker');
const { tipToman, factsFromTip, resolveMedia, evaluateRules, availabilityFor } = require('../playback/rules');

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

async function readBodyToFile(req, dataDir, limit) {
  if (Number(req.headers['content-length']) > limit) throw new Error('Backup ZIP exceeds the 1 GB upload limit');
  const filePath = path.join(dataDir, '.backup-upload-' + crypto.randomUUID() + '.zip');
  let bytes = 0;
  const bound = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes <= limit ? null : new Error('Backup ZIP exceeds the 1 GB upload limit'), chunk);
    }
  });
  try {
    await pipeline(req, bound, fs.createWriteStream(filePath, { flags: 'wx' }));
    return filePath;
  } catch (error) {
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
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
    streamElementsClient,
    donofaClient,
    goalManager,
    historyStore,
    appVersion,
    openPathFn
  } = context;

  // Use the same event shape for the rules simulator and preview. Local sub/gift events
  // carry their real tags and toman override, including the total for a gift bundle.
  const simulationTip = body => {
    const kind = ['tip', 'sub', 'gift'].includes(body.kind) ? body.kind : 'tip';
    const name = cleanText(body.name, LIMITS.name) || 'Tester';
    const message = cleanText(body.message, LIMITS.message);
    if (kind === 'sub') {
      const months = intOrNull(body.months, 1, 240) || 1;
      const tip = kickChatClient.localEvent(
        'sub',
        name,
        kickChatClient.subValueToman('sub'),
        message || (months > 1 ? `${months} ماه` : ''),
        1,
        ['sub', 'newsub'],
        months
      );
      tip.is_test = true;
      return tip;
    }
    if (kind === 'gift') {
      const count = intOrNull(body.count, 1, 1000) || 1;
      const tip = kickChatClient.localEvent(
        'gift',
        name,
        count * kickChatClient.subValueToman('gift'),
        message,
        count,
        ['giftsub', 'gift', 'sub']
      );
      tip.is_test = true;
      return tip;
    }
    const tip = playbackQueue.makeTestTip({ name, amount: body.amount, message });
    // A live tip is not limited by the controller's /api/test amount cap.
    tip.amount_total = Math.round(finite(body.amount, 0, 1e9, 5) * 100);
    tip.currency = /^[A-Za-z]{3}$/.test(String(body.currency || '')) ? String(body.currency).toUpperCase() : 'USD';
    tip.source = ['kickbot', 'streamelements', 'kick'].includes(body.provider) ? body.provider : 'kickbot';
    tip.is_local = tip.source === 'kick';
    if (body.provider === 'donofa') {
      tip.source = 'donofa';
      tip.currency = 'IRT';
      tip.toman_override = finite(body.amount, 0, 1e12, 0);
      tip.amount_total = Math.round(tip.toman_override * 100);
      tip.is_local = true;
    }
    return tip;
  };

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
    /^\/(app\.css|app\.js|overlay\.css|overlay\.js|goal\.html|goal\.js|goal\.css|top\.html|top\.js|top\.css|licenses\.html|licenses\.js)$/;

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
    if (/^\/(top|top\.html|widget\/top)$/.test(p)) p = '/top';

    try {
      // Pages & Static Assets
      if (p === '/') return serveFile(req, res, path.join(publicDir, 'app.html'), { csp: CSP_APP });
      if (p === '/overlay') return serveFile(req, res, path.join(publicDir, 'overlay.html'), { csp: CSP_OVERLAY });
      if (p === '/goal') return serveFile(req, res, path.join(publicDir, 'goal.html'), { csp: CSP_GOAL });
      if (p === '/top') return serveFile(req, res, path.join(publicDir, 'top.html'), { csp: CSP_TOP });

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
        // only files that are registered alerts: never other content of the media folder (notes, partial uploads)
        const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
        const lower = name.toLowerCase();
        const entry = configStore.config.files.find(
          f => f.file === name || f.file.toLowerCase() === lower || f.audioFile === name
        );
        if (!entry) return json(res, 404, { error: 'not found' });
        // a paired-audio reference serves that audio file, not the image entry's own file
        const served = entry.file === name || entry.file.toLowerCase() === lower ? entry.file : entry.audioFile;
        return serveFile(req, res, path.join(mediaDir, served));
      }

      // Server-Sent Events (SSE)
      if (p === '/events') {
        const role = url.searchParams.get('role') || 'overlay';
        const profile = url.searchParams.get('profile') || 'default';
        if (!['overlay', 'admin', 'preview', 'goal', 'top'].includes(role)) {
          return json(res, 400, { error: 'bad role' });
        }
        // A page on another site can open an EventSource to this server; the browser cannot read the answer, but the
        // connection alone would count as a Browser Source and consume alerts. Browsers send Origin (and Sec-Fetch-Site)
        // on such a request, while our own pages, OBS and Meld are same-origin.
        if (!originAllowed(req) || String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
          logger.warn('اتصال اورلی از یک صفحه‌ی خارجی رد شد', {
            origin: String(req.headers.origin || '').slice(0, 100),
            role
          });
          return json(res, 403, { error: 'forbidden origin' });
        }
        if (sse.clientCount(role) >= ((LIMITS.sse && LIMITS.sse[role]) || 4)) {
          logger.warn('تعداد اتصال‌های هم‌زمان به صف رویدادها پر است', { role, open: sse.clientCount(role) });
          return json(res, 429, { error: 'too many connections' });
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write(':ok\n\n');
        sse.addClient(role, res, { profile });

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

      // History & Top-Donors (2.3.0)
      if (p === '/api/history' && req.method === 'GET') {
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const dayParam = String(url.searchParams.get('day') || '');
        const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
        return json(res, 200, {
          ok: true,
          entries: historyStore.getEntries({ limit, day }),
          days: historyStore.getDays(30),
          today: historyStore.day(localDayKey()),
          totals: historyStore.totals()
        });
      }

      if (p === '/api/analytics' && req.method === 'GET') {
        const tzParam = url.searchParams.get('tz');
        const offset = tzParam === null ? NaN : Number(tzParam);
        const tz =
          Number.isFinite(offset) && offset >= -720 && offset <= 840
            ? Math.round(offset)
            : -new Date().getTimezoneOffset();
        const entries = historyStore.entries.filter(e => e && ['tip', 'sub', 'gift'].includes(e.kind));
        const oldest = entries.length ? entries[0].at : null;
        const result = computeAnalytics(
          entries.map(e => ({
            ...e,
            amount: Number(e.usd) > 0 ? e.usd : Number(e.toman) > 0 ? e.toman : e.usd,
            currency: Number(e.usd) > 0 ? e.currency : Number(e.toman) > 0 ? 'IRT' : e.currency,
            preview: e.replay
          })),
          {
            range: url.searchParams.get('range') || 'today',
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            now: Date.now(),
            tz,
            includeTests: url.searchParams.get('includeTests') === '1',
            rate: configStore.config.rate,
            coverage: {
              from: oldest ? new Date(oldest).toISOString() : null,
              events: entries.length,
              truncated: historyStore.entries.length >= LIMITS.history
            }
          }
        );
        return json(res, 200, result);
      }

      if (p === '/api/top' && req.method === 'GET') {
        const rangeParam = String(url.searchParams.get('range') || '');
        const range = ['daily', 'weekly', 'all'].includes(rangeParam) ? rangeParam : 'all';
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
        return json(res, 200, { ok: true, range, donors: historyStore.getTop(range, limit) });
      }

      // ProMax 1-Click Backup & Restore Endpoints
      if (p === '/api/backup' && req.method === 'GET') {
        // A page on another site can issue this GET without reading the response;
        // it must not be able to drive CPU/disk-heavy exports.
        if (!originAllowed(req) || String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
          logger.warn('درخواست پشتیبان‌گیری از یک صفحه‌ی خارجی رد شد', {
            origin: String(req.headers.origin || '').slice(0, 100)
          });
          return json(res, 403, { error: 'forbidden origin' });
        }
        try {
          const backup = await exportBackupToFile(dataDir, configStore);
          const filename = `sahne-promax-backup-${new Date().toISOString().slice(0, 10)}.zip`;
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': backup.size
          });
          const stream = fs.createReadStream(backup.filePath);
          res.once('close', () => stream.destroy());
          stream.once('close', () => fs.promises.rm(backup.filePath, { force: true }).catch(() => {}));
          stream.once('error', error => {
            logger.error('خواندن فایل پشتیبان ناموفق بود', error.message);
            res.destroy(error);
          });
          return stream.pipe(res);
        } catch (e) {
          logger.error('تهیه نسخه پشتیبان ناموفق بود', e.message);
          return json(res, 500, { error: 'تهیه نسخه پشتیبان با خطا مواجه شد' });
        }
      }

      if (p === '/api/restore' && req.method === 'POST') {
        let archivePath;
        try {
          archivePath = await readBodyToFile(req, dataDir, MAX_ARCHIVE_BYTES);
          const result = await importBackupFromFile(dataDir, archivePath, { configStore, logger, sse, historyStore });
          playbackQueue.clearQueue();
          // The archive is already committed. A connection failure must not
          // turn a successful restore into a misleading HTTP 400 response.
          const restart = (name, action) => {
            try {
              action();
            } catch (error) {
              logger.warn(name + ' restart after restore failed', error.message);
            }
          };
          restart('KickBot', () => {
            kickBotClient.resetConnection();
            kickBotClient.connect();
          });
          restart('Kick chat', () => {
            kickChatClient.resetConnection();
            if (configStore.config.kick.enabled && configStore.config.kick.channel) {
              kickChatClient.startKeepAlive();
              kickChatClient
                .resolveKickChannel()
                .then(ok => {
                  if (ok) kickChatClient.connect();
                })
                .catch(error => logger.warn('Kick chat restart after restore failed', error.message));
            }
          });
          restart('Rate scheduler', () => {
            rateManager.resetForRestore();
            rateManager.scheduleRate();
            if (configStore.config.rate.auto) rateManager.refreshRate(false);
          });
          restart('StreamElements', () => streamElementsClient.reloadAfterRestore());
          restart('Donofa', () => donofaClient.reloadAfterRestore());
          return json(res, 200, { ok: true, ...result });
        } catch (e) {
          logger.error('بازیابی نسخه پشتیبان ناموفق بود', e.message);
          return json(res, 400, { error: e.message || 'فایل پشتیبان نامعتبر است' });
        } finally {
          if (archivePath) await fs.promises.rm(archivePath, { force: true }).catch(() => {});
        }
      }

      // Alert media routing rules
      if (p === '/api/rules' && req.method === 'GET') {
        const rules = configStore.config.alertRules;
        return json(res, 200, {
          ok: true,
          enabled: !!rules.enabled,
          items: rules.items,
          availability: availabilityFor(configStore.config, mediaDir)
        });
      }

      if (p === '/api/rules' && req.method === 'PUT') {
        const body = await readJson(req);
        const { enabled, items, errors } = validateRules(
          body,
          configStore.config.files,
          configStore.config.alertRules.items
        );
        if (errors.length) {
          return json(res, 400, { error: errors[0].message, errors });
        }
        configStore.config.alertRules = { v: 1, enabled, items };
        configStore.saveConfig();
        logger.info('قواعد رسانه ذخیره شد', { count: items.length, enabled });
        sse.sendState();
        return json(res, 200, {
          ok: true,
          rules: { enabled, items, availability: availabilityFor(configStore.config, mediaDir) }
        });
      }

      if (p === '/api/rules/test' && req.method === 'POST') {
        const body = await readJson(req);
        const tip = simulationTip(body);
        const facts = factsFromTip(tip, tipToman(tip, rateManager));
        const evaluations = evaluateRules(tip, facts, { config: configStore.config, mediaDir });
        const currentRate = () => rateManager.currentRate();
        const resolved = resolveMedia(tip, facts, { config: configStore.config, mediaDir, currentRate });
        const pickerMedia =
          resolved.source === 'picker' || resolved.source === 'command'
            ? resolved.media
            : pickMedia(tip, { config: configStore.config, mediaDir, currentRate });
        return json(res, 200, {
          ok: true,
          match: resolved.media
            ? {
                source: resolved.source,
                ruleId: resolved.ruleId,
                ruleName: resolved.ruleName,
                fileId: resolved.media.id,
                fileName: resolved.media.name,
                file: resolved.media.file
              }
            : null,
          evaluations,
          picker: pickerMedia ? { fileId: pickerMedia.id, fileName: pickerMedia.name, file: pickerMedia.file } : null
        });
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
          goalManager.setGoal(body.goal);
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
            autostart: body.app.autostart === undefined ? config.app.autostart : !!body.app.autostart,
            updateCheck: body.app.updateCheck === undefined ? config.app.updateCheck !== false : !!body.app.updateCheck
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
          kickChatClient.resetConnection();
          if (config.kick.enabled) {
            kickChatClient.startKeepAlive();
            kickChatClient.resolveKickChannel().then(ok => {
              if (ok) kickChatClient.connect();
            });
          } else if (prevEnabled) {
            kickChatClient.kickState.connected = false;
          }
        }

        if (body.chatCommands && typeof body.chatCommands === 'object') {
          config.chatCommands = sanitizeChatCommands(body.chatCommands, config.chatCommands, config.files);
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
        sse.broadcastAppearance(profileName => configStore.getEffectiveAppearance(profileName));
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
          playbackQueue.enqueueApproved(t);
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
        const t = simulationTip(body);
        const media = body.fileId ? configStore.config.files.find(f => f.id === body.fileId) : null;
        const payload = buildPayload(t, media, {
          mediaDir,
          currentRate: () => rateManager.currentRate(),
          tomanOf: usd => rateManager.tomanOf(usd),
          tomanFor: (amount, currency) => rateManager.tomanFor(amount, currency)
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
        const sim = (kind, count = null) => {
          const toman = kind === 'sub' ? per : count * perGift;
          const t = {
            amount_total: 0,
            tip_message: '',
            tags: kind === 'sub' ? ['sub', 'newsub'] : ['giftsub', 'gift', 'sub'],
            toman_override: toman,
            kind,
            count,
            months: kind === 'sub' ? 1 : null,
            is_local: true,
            currency: 'USD'
          };
          const resolved = resolveMedia(t, factsFromTip(t, tipToman(t, rateManager)), {
            config: configStore.config,
            mediaDir,
            currentRate: () => rateManager.currentRate()
          });
          const m = resolved.media;
          return m ? { id: m.id, name: m.name, file: m.file } : null;
        };
        const rows = [{ label: 'sub', toman: per, media: sim('sub') }];
        for (const n of [1, 2, 3, 5, 10, 20]) {
          rows.push({
            label: 'gift',
            count: n,
            toman: n * perGift,
            media: sim('gift', n)
          });
        }
        return json(res, 200, { ok: true, rate: rateManager.currentRate(), rows });
      }

      // StreamElements tips are already paid by StreamElements, so they join the queue without capture.
      if (p === '/api/se/setup' && req.method === 'POST') {
        const body = await readJson(req);
        const token = String(body.token || '').trim();
        if (!streamElementsClient || !configStore.isValidSeToken(token)) {
          return json(res, 400, { error: 'توکن معتبر نیست. JWT را از داشبورد StreamElements کپی کنید.' });
        }
        const verified = await streamElementsClient.verifyToken(token);
        if (!verified.ok) {
          if (verified.rejected) {
            return json(res, 400, { error: 'StreamElements این توکن را قبول نکرد؛ توکن کامل و به‌روز را وارد کنید.' });
          }
          return json(res, 502, {
            error: 'اتصال به StreamElements ناموفق بود: ' + String(verified.error || 'unknown').slice(0, 160)
          });
        }
        streamElementsClient.disconnect({ clearAccount: false });
        configStore.setSeToken(token);
        configStore.config.se = {
          channelId: verified.channelId,
          username: verified.username,
          provider: verified.provider
        };
        configStore.saveConfig();
        logger.info('حساب StreamElements وصل شد', {
          username: verified.username,
          provider: verified.provider,
          secretStorage: configStore.seSecretStorage
        });
        streamElementsClient.connect();
        sse.sendState();
        return json(res, 200, {
          ok: true,
          username: verified.username,
          provider: verified.provider,
          secretStorage: configStore.seSecretStorage
        });
      }

      if (p === '/api/se/disconnect' && req.method === 'POST') {
        streamElementsClient.disconnect();
        playbackQueue.approved = playbackQueue.approved.filter(t => t.source !== 'streamelements');
        configStore.saveConfig();
        logger.info('اتصال StreamElements حذف شد');
        sse.sendState();
        return json(res, 200, { ok: true });
      }

      if (p === '/api/donofa/setup' && req.method === 'POST') {
        const body = await readJson(req);
        const key = String(body.key || '').trim();
        const endpoint = body.endpoint === 'com' ? 'com' : 'ir';
        if (!configStore.isValidDonofaKey(key)) return json(res, 400, { error: 'کلید API دونوفا نامعتبر است.' });
        const verified = await donofaClient.verifyKey(key, endpoint);
        if (!verified.ok)
          return json(res, verified.rejected ? 400 : 502, {
            error: verified.rejected ? 'دونوفا کلید API را قبول نکرد.' : 'ارتباط با دونوفا برای بررسی کلید برقرار نشد.'
          });
        donofaClient.resetConnection();
        playbackQueue.pending = playbackQueue.pending.filter(t => t.source !== 'donofa');
        playbackQueue.approved = playbackQueue.approved.filter(t => t.source !== 'donofa');
        configStore.setDonofaKey(key);
        configStore.config.donofa = { endpoint };
        configStore.saveConfig();
        logger.info('حساب دونوفا وصل شد', { endpoint, secretStorage: configStore.donofaSecretStorage });
        donofaClient.connect();
        sse.sendState();
        return json(res, 200, { ok: true, endpoint, secretStorage: configStore.donofaSecretStorage });
      }

      if (p === '/api/donofa/disconnect' && req.method === 'POST') {
        donofaClient.disconnect();
        playbackQueue.pending = playbackQueue.pending.filter(t => t.source !== 'donofa');
        playbackQueue.approved = playbackQueue.approved.filter(t => t.source !== 'donofa');
        configStore.saveConfig();
        logger.info('اتصال دونوفا حذف شد');
        sse.sendState();
        return json(res, 200, { ok: true });
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
        kickBotClient.resetConnection();
        kickBotClient.connect();
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
        sse.broadcastAppearance(profileName => configStore.getEffectiveAppearance(profileName));
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

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ConfigStore } = require('./config/store');
const { PlayedStore } = require('./config/played');
const { Logger } = require('./logger');
const { SseManager } = require('./sse');
const { RateManager } = require('./rates/manager');
const { MediaManager } = require('./media/manager');
const { GoalManager } = require('./features/goal');
const { PlaybackQueue } = require('./playback/queue');
const { createCaptureTip } = require('./playback/capture');
const { KickBotClient } = require('./integrations/kickbot');
const { KickChatClient } = require('./integrations/kick-chat');
const { MeldManager } = require('./integrations/meld');
const { createHttpRouter } = require('./http/router');
const {
  typeOf,
  sniffOk,
  safeMediaName,
  toAsciiDigits,
  parseThreshold,
  cleanText,
  normFa
} = require('./utils/validation');

function createServer(opts = {}) {
  const dataDir = opts.dataDir;
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const mediaDir = path.join(dataDir, 'media');
  const appVersion = opts.appVersion || '2.0.0-pro';
  const nodeOk = typeof fetch === 'function' && typeof WebSocket === 'function';

  fs.mkdirSync(mediaDir, { recursive: true });

  const sse = new SseManager();
  const logger = new Logger({
    onLog: opts.onLog,
    broadcast: (role, obj) => sse.broadcast(role, obj)
  });

  const configStore = new ConfigStore({
    dataDir,
    secretStore: opts.secretStore,
    logger: (level, msg, extra) => logger.log(level, msg, extra)
  });

  const playedStore = new PlayedStore(dataDir);
  const goalManager = new GoalManager({ configStore, logger, sse });
  const rateManager = new RateManager({ configStore, logger, sse });
  const mediaManager = new MediaManager({ mediaDir, configStore, logger, sse });

  let kickBotClient = null;
  const captureFn = createCaptureTip({
    getSecret: () => configStore.getSecret(),
    getStreamerId: () => configStore.config.streamer_id,
    logger,
    testHook: opts.testHooks && opts.testHooks.captureTip
  });

  const playbackQueue = new PlaybackQueue({
    configStore,
    playedStore,
    mediaDir,
    logger,
    sse,
    rateManager,
    captureFn,
    publishFn: (ev, pl) => {
      if (kickBotClient) kickBotClient.publish(ev, pl);
    },
    captureRetryMs: opts.captureRetryMs || 15000
  });

  playbackQueue.setGoalManager(goalManager);

  kickBotClient = new KickBotClient({
    configStore,
    playedStore,
    queue: playbackQueue,
    logger,
    sse
  });

  const kickChatClient = new KickChatClient({
    configStore,
    queue: playbackQueue,
    rateManager,
    logger,
    sse
  });

  const meldManager = new MeldManager({
    configStore,
    logger,
    sse,
    enabled: opts.meldSelfHeal === true
  });

  function getPublicState() {
    const config = configStore.config;
    return {
      connected: kickBotClient.isConnected(),
      kbStatus: kickBotClient.status(),
      configured: !!(configStore.getSecret() && config.streamer_id),
      secretStorage: configStore.secretStorage,
      overlays: sse.clientCount('overlay'),
      queueStatus: playbackQueue.queueStatus,
      queueDelay: playbackQueue.queueDelay,
      queueMode: playbackQueue.queueMode,
      tippingEnabled: playbackQueue.tippingEnabled,
      pending: playbackQueue.pending.length,
      approved: playbackQueue.approved.length,
      playing: playbackQueue.playing ? playbackQueue.tipSummary(playbackQueue.playing) : null,
      mode: config.mode,
      nodeVersion: process.versions.node,
      nodeOk,
      kick: {
        connected: kickChatClient.kickState.connected,
        status: kickChatClient.status(),
        channel: config.kick.channel,
        chatroomId: config.kick.chatroomId,
        error: kickChatClient.kickState.error
      },
      rate: rateManager.currentRate(),
      rateUpdatedAt: config.rate.updatedAt,
      rateManual: Number(config.rate.manual) > 0,
      rateError: rateManager.rateError,
      rateSource: config.rate.source,
      recent: playbackQueue.recent,
      goal: goalManager.getPublicGoal(),
      port: config.port,
      version: appVersion
    };
  }

  sse.init({ getState: getPublicState });

  const routerHandler = createHttpRouter({
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
    openPathFn: opts.openPath
  });

  const httpServer = http.createServer(routerHandler);

  let started = false;

  async function start() {
    if (started) return;
    started = true;

    return new Promise((resolve, reject) => {
      httpServer.on('error', reject);
      httpServer.listen(configStore.config.port, '127.0.0.1', async () => {
        logger.info(`Sahne ProMax ${appVersion} اجرا شد`, {
          overlay: `http://localhost:${configStore.config.port}/overlay`,
          goal: `http://localhost:${configStore.config.port}/goal`,
          data: dataDir,
          secretStorage: configStore.secretStorage
        });

        if (!opts.testHooks || !opts.testHooks.offline) {
          rateManager.scheduleRate();
          if (configStore.config.rate.auto) {
            rateManager.refreshRate(false);
          }
          kickBotClient.connect();
          kickBotClient.startKeepAlive();
          if (configStore.config.kick.enabled && configStore.config.kick.channel) {
            kickChatClient.resolveKickChannel().then(ok => {
              if (ok) kickChatClient.connect();
            });
            kickChatClient.startKeepAlive();
          }
          meldManager.start();
        }
        resolve();
      });
    });
  }

  async function stop() {
    if (!started) return;
    started = false;
    playbackQueue.stop();
    configStore.stop();
    rateManager.stop();
    kickBotClient.stop();
    kickChatClient.stop();
    meldManager.stop();
    sse.close();

    await new Promise(resolve => {
      httpServer.close(() => resolve());
    });
  }

  function clearData() {
    try {
      configStore.config.files = [];
      configStore.config.appearance = { ...DEFAULT_CONFIG.appearance };
      configStore.saveConfig();
      playedStore.clear();

      if (fs.existsSync(mediaDir)) {
        for (const f of fs.readdirSync(mediaDir)) {
          try {
            fs.unlinkSync(path.join(mediaDir, f));
          } catch {}
        }
      }

      if (fs.existsSync(dataDir)) {
        for (const f of fs.readdirSync(dataDir)) {
          if (f.startsWith('config.json.corrupt-') || f.endsWith('.tmp')) {
            try {
              fs.unlinkSync(path.join(dataDir, f));
            } catch {}
          }
        }
      }
      logger.info('داده‌ها پاک شدند');
      sse.sendState();
    } catch (e) {
      logger.error('پاک‌سازی ناموفق', e.message);
    }
  }

  // Exposed for tests
  const testHooks = {
    injectTip: t => {
      playbackQueue.approved.push(t);
      playbackQueue.tryNext();
    },
    isPlayed: id => playedStore.isPlayed(id),
    queueLength: () => playbackQueue.approved.length,
    playingTip: () => playbackQueue.playing,
    recentList: () => playbackQueue.recent,
    captureTip: opts.testHooks && opts.testHooks.captureTip
  };

  return {
    start,
    stop,
    clearData,
    saveConfig: () => configStore.saveConfig(),
    testHooks,
    configStore,
    playbackQueue,
    goalManager
  };
}

module.exports = {
  createServer,
  typeOf,
  sniffOk,
  safeMediaName,
  toAsciiDigits,
  parseThreshold,
  cleanText,
  normFa
};

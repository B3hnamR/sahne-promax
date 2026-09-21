'use strict';

const KB_WS = 'wss://kickbot.live/ws';
const KB_API = 'https://widgets.kickbot.com';
const PUSHER_WS = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false';
const KICK_CHANNEL_API = 'https://kick.com/api/v2/channels/';
const NOBITEX = 'https://apiv2.nobitex.ir/v3/orderbook/USDTIRT';
const BAHA24 = 'https://baha24.com/api/v1/price';
const MELD_WS = 'ws://127.0.0.1:13376';
const KICK_SUB_USD = 4.99;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

const LIMITS = {
  name: 80,
  message: 500,
  keyword: 50,
  keywords: 20,
  fileName: 120,
  upload: 512 * 1024 * 1024,
  files: 500,
  sse: { overlay: 8, preview: 4, admin: 4, goal: 4, top: 4 }, // concurrent event streams per role
  played: 1000,
  history: 20000,
  logs: 300,
  minRateInterval: 1,
  profiles: 10,
  profileName: 40,
  goalTitle: 100,
  commands: 50,
  command: 32,
  cmdQueue: 20
};

const DEFAULT_APPEARANCE = {
  font: 'Vazirmatn',
  textSize: 34,
  nameColor: '#53fc18',
  textColor: '#ffffff',
  accent: '#53fc18',
  bgColor: '#0b0f0c',
  bgOpacity: 0.6,
  mediaMode: 'full',
  mediaFit: 'cover',
  cardX: 50,
  cardY: 82,
  cardScale: 1,
  radius: 26,
  amountStyle: 'pill',
  showLine: true,
  showGlow: true,
  showBorder: true,
  headlineColor: '#ffffff',
  borderColor: '#ffffff',
  borderOpacity: 0.1,
  padY: 26,
  padX: 34,
  animation: 'pop',
  showMessage: true,
  showAmount: true,
  currency: 'toman',
  persianDigits: true,
  template: '{name} با {amount} حمایت کرد',
  giftTemplate: '{name} {count} تا ساب گیفت داد 🎁 {amount}',
  subTemplate: '{name} ساب شد ⭐ {amount}',
  commandTemplate: '{name} دستور چت داد 🎮',
  imageDuration: 8,
  minDuration: 6,
  maxDuration: 90,
  cardDelay: 0,
  mediaMaxHeight: 55,
  volume: 80,
  ttsVolume: 70,
  shadow: true,
  width: 720,
  showGloss: false
};

const DEFAULT_CONFIG = {
  port: 7788,
  streamer_id: null,
  mode: 'standalone',
  appearance: { ...DEFAULT_APPEARANCE },
  profiles: {
    gameplay: {
      ...DEFAULT_APPEARANCE,
      width: 540,
      textSize: 26,
      cardX: 15,
      cardY: 88,
      bgOpacity: 0.4
    },
    chatting: {
      ...DEFAULT_APPEARANCE,
      width: 860,
      textSize: 40,
      cardX: 50,
      cardY: 75
    }
  },
  goal: {
    enabled: true,
    title: 'هدف حمایت استریم',
    targetToman: 5000000,
    currentToman: 0,
    autoIncrement: true,
    unit: 'toman',
    color: '#53fc18',
    bgColor: '#0b0f0c',
    // timed goal (mode 'timed' + deadline epoch ms); countdown rendered by the /goal widget
    mode: 'amount',
    deadline: null,
    // milestone confetti: big-donation threshold (0 = off) + one burst per goal completion / per first sub of the day
    milestoneToman: 0,
    confettiOnComplete: true,
    confettiOnFirstSub: true,
    completedCelebrated: false,
    subsDay: null,
    // live counters on the goal widget (subs / gift-subs / subs today)
    showCounters: true,
    subCount: 0,
    giftSubCount: 0,
    giftCount: 0,
    subsToday: 0
  },
  chatCommands: {
    enabled: false,
    prefix: '!',
    globalCooldownSec: 5,
    userCooldownSec: 30,
    maxPerMinute: 10,
    entries: []
  },
  files: [],
  showAlertWithoutMedia: true,
  rate: { auto: true, manual: null, value: null, updatedAt: null, source: null, intervalMin: 2, proxy: '' },
  kick: {
    enabled: true,
    channel: '',
    chatroomId: null,
    channelId: null,
    resolvedFor: null,
    giftValueToman: 0,
    subValueToman: 0,
    showNewSubs: true
  },
  app: { autostart: true, updateCheck: true, updateNotifiedFor: null }
};

const FONTS = ['Vazirmatn', 'Estedad', 'Lalezar', 'Inter', 'Poppins', 'Segoe UI', 'Tahoma'];

const ENUMS = {
  mediaMode: ['full', 'boxed'],
  mediaFit: ['cover', 'contain'],
  amountStyle: ['pill', 'plain', 'inherit', 'soft'],
  animation: ['pop', 'slide', 'fade', 'none'],
  currency: ['eq-en', 'eq-fa', 'toman', 'toman-full', 'toman-both', 'dollar-fa', 'usd', 'usd-code'],
  mode: ['standalone', 'companion'],
  goalMode: ['amount', 'timed']
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml'
};

const TYPES = {
  video: ['.mp4', '.webm', '.mov', '.mkv'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a']
};

const CSP_APP =
  "default-src 'self' 'unsafe-inline'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none';";
const CSP_OVERLAY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: data:; media-src 'self' https://ttsaudio.kickbot.com https://tts.kickbotcdn.com blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none';";
const CSP_GOAL =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none';";
const CSP_TOP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none';";

module.exports = {
  KB_WS,
  KB_API,
  PUSHER_WS,
  KICK_CHANNEL_API,
  BAHA24,
  NOBITEX,
  MELD_WS,
  KICK_SUB_USD,
  UA,
  LIMITS,
  DEFAULT_APPEARANCE,
  DEFAULT_CONFIG,
  FONTS,
  ENUMS,
  MIME,
  TYPES,
  CSP_APP,
  CSP_OVERLAY,
  CSP_GOAL,
  CSP_TOP
};

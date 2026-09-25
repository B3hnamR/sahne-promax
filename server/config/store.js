'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, DEFAULT_APPEARANCE, LIMITS, ENUMS } = require('../constants');
const {
  sanitizeFile,
  sanitizeAppearance,
  sanitizeGoal,
  sanitizeChatCommands,
  sanitizeRules
} = require('../utils/sanitizers');
const { finite } = require('../utils/validation');
const { sanitizeFx } = require('../rates/baha24');

class ConfigStore {
  constructor({ dataDir, secretStore, logger }) {
    this.dataDir = dataDir;
    this.cfgPath = path.join(dataDir, 'config.json');
    this.store = secretStore || null;
    this.log = logger || (() => {});
    this.secret = '';
    this.seToken = '';
    this.donofaKey = '';
    this.secretStorage = 'none';
    this.seSecretStorage = 'none';
    this.donofaSecretStorage = 'none';
    this.config = this.loadConfig();
    this.saveDebounceTimer = null;
    this.saveGeneration = 0;
  }

  loadConfig() {
    this.secret = '';
    this.seToken = '';
    this.donofaKey = '';
    let c = {};
    let raw = null;
    try {
      raw = fs.readFileSync(this.cfgPath, 'utf8');
      c = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (e) {
      if (raw !== null) {
        try {
          fs.copyFileSync(this.cfgPath, this.cfgPath + '.corrupt-' + Date.now());
        } catch {}
        console.error('config.json could not be parsed; defaults used, corrupted copy kept:', e.message);
      }
      c = {};
    }

    const merged = {
      ...DEFAULT_CONFIG,
      ...c,
      appearance: sanitizeAppearance(c.appearance || {}, DEFAULT_CONFIG.appearance),
      profiles:
        typeof c.profiles === 'object' && c.profiles !== null
          ? { ...DEFAULT_CONFIG.profiles, ...c.profiles }
          : { ...DEFAULT_CONFIG.profiles },
      goal: sanitizeGoal(c.goal || {}, DEFAULT_CONFIG.goal),
      rate: { ...DEFAULT_CONFIG.rate, ...(c.rate || {}), fx: sanitizeFx(c.rate && c.rate.fx) },
      kick: { ...DEFAULT_CONFIG.kick, ...(c.kick || {}) },
      donofa: { endpoint: c.donofa && c.donofa.endpoint === 'com' ? 'com' : 'ir' },
      chatCommands: { ...DEFAULT_CONFIG.chatCommands, ...(c.chatCommands || {}) },
      app: { ...DEFAULT_CONFIG.app, ...(c.app || {}) }
    };

    merged.app.updateCheck = merged.app.updateCheck !== false;
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(merged.app.updateNotifiedFor || '')))
      merged.app.updateNotifiedFor = null;

    // Secret storage handling (DPAPI or plain)
    const isStoreAvailable = !!(this.store && typeof this.store.available === 'function' && this.store.available());
    if (c.secret_id_enc && isStoreAvailable) {
      try {
        this.secret = String(this.store.decrypt(c.secret_id_enc) || '');
        this.secretStorage = 'os';
      } catch {
        this.secret = '';
      }
    } else if (typeof c.secret_id === 'string' && c.secret_id) {
      this.secret = c.secret_id;
      this.secretStorage = isStoreAvailable ? 'os' : 'plain';
    } else {
      this.secretStorage = isStoreAvailable ? 'os' : 'plain';
    }

    delete merged.secret_id;
    delete merged.secret_id_enc;

    this.seSecretStorage = isStoreAvailable ? 'os' : 'plain';
    if (c.se_token_enc && isStoreAvailable) {
      try {
        this.seToken = String(this.store.decrypt(c.se_token_enc) || '');
        this.seSecretStorage = 'os';
      } catch {
        this.seToken = '';
      }
    } else if (typeof c.se_token === 'string' && c.se_token) {
      this.seToken = c.se_token;
      this.seSecretStorage = 'plain';
    }
    // Validate stored credentials before ever using them for API or websocket authentication.
    if (!this.isValidSeToken(this.seToken)) this.seToken = '';
    if (!this.seToken) this.seSecretStorage = 'none';
    delete merged.se_token;
    delete merged.se_token_enc;
    if (!merged.se || typeof merged.se !== 'object' || Array.isArray(merged.se)) merged.se = { ...DEFAULT_CONFIG.se };
    else merged.se = { ...DEFAULT_CONFIG.se, ...merged.se };
    if (!/^[A-Za-z0-9]{1,64}$/.test(String(merged.se.channelId || ''))) merged.se.channelId = null;

    this.donofaSecretStorage = isStoreAvailable ? 'os' : 'plain';
    if (c.donofa_key_enc && isStoreAvailable) {
      try {
        this.donofaKey = String(this.store.decrypt(c.donofa_key_enc) || '');
      } catch {
        this.donofaKey = '';
      }
    } else if (typeof c.donofa_key === 'string') {
      this.donofaKey = c.donofa_key;
      this.donofaSecretStorage = 'plain';
    }
    if (!this.isValidDonofaKey(this.donofaKey)) this.donofaKey = '';
    if (!this.donofaKey) this.donofaSecretStorage = 'none';
    delete merged.donofa_key;
    delete merged.donofa_key_enc;

    if (!Array.isArray(merged.files)) merged.files = [];
    merged.files = merged.files.map(sanitizeFile).filter(Boolean).slice(0, LIMITS.files);
    merged.chatCommands = sanitizeChatCommands(merged.chatCommands, DEFAULT_CONFIG.chatCommands, merged.files);
    merged.alertRules = sanitizeRules(merged.alertRules, DEFAULT_CONFIG.alertRules, merged.files);

    // Goals that are already complete when the milestone feature appears must not throw a retro confetti on the
    // next donation: mark them celebrated once, unless the config already carries the flag.
    if (!(c.goal && typeof c.goal === 'object' && 'completedCelebrated' in c.goal)) {
      merged.goal.completedCelebrated = (merged.goal.currentToman || 0) >= (merged.goal.targetToman || 1);
    }

    if (merged.rate.proxy == null) {
      merged.rate.proxy =
        process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
    }
    merged.rate.intervalMin = Math.max(LIMITS.minRateInterval, Number(merged.rate.intervalMin) || 2);
    if (merged.rate.fxSource !== 'baha24') {
      // Older builds could persist quotes from the removed Bonbast provider.
      if (merged.rate.fxSource === 'bonbast') merged.rate.fx = {};
      merged.rate.fxSource = null;
    }
    merged.port = finite(merged.port, 1024, 65535, 7788);
    if (!ENUMS.mode.includes(merged.mode)) merged.mode = 'standalone';

    return merged;
  }

  serializedConfig() {
    const out = { ...this.config };
    if (this.secret) {
      if (this.store && typeof this.store.available === 'function' && this.store.available()) {
        try {
          out.secret_id_enc = this.store.encrypt(this.secret);
          this.secretStorage = 'os';
        } catch {
          out.secret_id = this.secret;
          this.secretStorage = 'plain';
        }
      } else {
        out.secret_id = this.secret;
        this.secretStorage = 'plain';
      }
    }
    if (this.seToken) {
      if (this.store && typeof this.store.available === 'function' && this.store.available()) {
        try {
          out.se_token_enc = this.store.encrypt(this.seToken);
          this.seSecretStorage = 'os';
        } catch {
          out.se_token = this.seToken;
          this.seSecretStorage = 'plain';
        }
      } else {
        out.se_token = this.seToken;
        this.seSecretStorage = 'plain';
      }
    }
    if (this.donofaKey) {
      if (this.store && typeof this.store.available === 'function' && this.store.available()) {
        try {
          out.donofa_key_enc = this.store.encrypt(this.donofaKey);
          this.donofaSecretStorage = 'os';
        } catch {
          out.donofa_key = this.donofaKey;
          this.donofaSecretStorage = 'plain';
        }
      } else {
        out.donofa_key = this.donofaKey;
        this.donofaSecretStorage = 'plain';
      }
    }
    return out;
  }

  // Sync and async saves must not share a tmp filename, or a concurrent save can clobber the other's temp file
  saveConfig() {
    // Invalidates any asynchronous snapshot that has not been committed yet.
    ++this.saveGeneration;
    try {
      const tmp = this.cfgPath + '.sync.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.serializedConfig(), null, 2));
      fs.renameSync(tmp, this.cfgPath);
    } catch (e) {
      this.log('error', 'ذخیره‌ی config.json ناموفق بود', e.message);
    }
  }

  async saveConfigAsync() {
    const generation = ++this.saveGeneration;
    const tmp = this.cfgPath + '.' + generation + '.tmp';
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(this.serializedConfig(), null, 2), 'utf8');
      // The generation check and synchronous rename run in one JS turn. A later
      // synchronous save cannot be overtaken by this older async write.
      if (generation === this.saveGeneration) fs.renameSync(tmp, this.cfgPath);
      else await fs.promises.unlink(tmp);
    } catch (e) {
      this.log('error', 'ذخیره‌ی async config.json ناموفق بود', e.message);
      try {
        await fs.promises.unlink(tmp);
      } catch {}
    }
  }

  debouncedSave(delayMs = 250) {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.saveConfigAsync();
    }, delayMs);
  }

  publicConfig() {
    return {
      ...this.config,
      kickbot: {
        configured: !!(this.secret && this.config.streamer_id),
        streamer_id: this.config.streamer_id,
        secretStorage: this.secretStorage
      },
      streamelements: {
        configured: !!(this.seToken && this.config.se && this.config.se.channelId),
        username: this.config.se && this.config.se.username,
        provider: this.config.se && this.config.se.provider,
        secretStorage: this.seSecretStorage
      },
      donofa: {
        configured: !!this.donofaKey,
        endpoint: this.config.donofa.endpoint,
        secretStorage: this.donofaSecretStorage
      }
    };
  }

  getSecret() {
    return this.secret;
  }

  setSecret(sec) {
    this.secret = sec ? String(sec).trim() : '';
  }

  setSeToken(token) {
    this.seToken = token ? String(token).trim() : '';
    this.seSecretStorage = this.seToken ? 'plain' : 'none';
  }

  setDonofaKey(key) {
    this.donofaKey = key ? String(key).trim() : '';
    this.donofaSecretStorage = this.donofaKey ? 'plain' : 'none';
  }

  isValidDonofaKey(key) {
    const value = String(key || '').trim();
    return value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9_.-]+$/.test(value);
  }

  isValidSeToken(token) {
    const s = String(token || '').trim();
    if (s.length < 40 || s.length > 4000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) return false;
    try {
      const payload = JSON.parse(Buffer.from(s.split('.')[1], 'base64url').toString('utf8'));
      return !!payload && typeof payload === 'object' && !Array.isArray(payload);
    } catch {
      return false;
    }
  }

  getEffectiveAppearance(profileName) {
    if (!profileName || profileName === 'default') {
      return this.config.appearance;
    }
    const profile =
      this.config.profiles && Object.prototype.hasOwnProperty.call(this.config.profiles, profileName)
        ? this.config.profiles[profileName]
        : null;
    if (profile) {
      return sanitizeAppearance(profile, this.config.appearance);
    }
    return this.config.appearance;
  }

  stop() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  invalidatePendingSaves() {
    this.stop();
    ++this.saveGeneration;
  }
}

module.exports = {
  ConfigStore
};

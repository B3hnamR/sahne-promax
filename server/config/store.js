'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, DEFAULT_APPEARANCE, LIMITS, ENUMS } = require('../constants');
const { sanitizeFile, sanitizeAppearance, sanitizeGoal } = require('../utils/sanitizers');
const { finite } = require('../utils/validation');

class ConfigStore {
  constructor({ dataDir, secretStore, logger }) {
    this.dataDir = dataDir;
    this.cfgPath = path.join(dataDir, 'config.json');
    this.store = secretStore || null;
    this.log = logger || (() => {});
    this.secret = '';
    this.secretStorage = 'none';
    this.config = this.loadConfig();
    this.saveDebounceTimer = null;
  }

  loadConfig() {
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
      profiles: typeof c.profiles === 'object' && c.profiles !== null ? { ...DEFAULT_CONFIG.profiles, ...c.profiles } : { ...DEFAULT_CONFIG.profiles },
      goal: sanitizeGoal(c.goal || {}, DEFAULT_CONFIG.goal),
      rate: { ...DEFAULT_CONFIG.rate, ...(c.rate || {}) },
      kick: { ...DEFAULT_CONFIG.kick, ...(c.kick || {}) },
      app: { ...DEFAULT_CONFIG.app, ...(c.app || {}) }
    };

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

    if (!Array.isArray(merged.files)) merged.files = [];
    merged.files = merged.files.map(sanitizeFile).filter(Boolean).slice(0, LIMITS.files);

    if (merged.rate.proxy == null) {
      merged.rate.proxy =
        process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
    }
    merged.rate.intervalMin = Math.max(LIMITS.minRateInterval, Number(merged.rate.intervalMin) || 2);
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
    return out;
  }

  saveConfig() {
    try {
      const tmp = this.cfgPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.serializedConfig(), null, 2));
      fs.renameSync(tmp, this.cfgPath);
    } catch (e) {
      this.log('error', 'ذخیره‌ی config.json ناموفق بود', e.message);
    }
  }

  async saveConfigAsync() {
    try {
      const tmp = this.cfgPath + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(this.serializedConfig(), null, 2), 'utf8');
      await fs.promises.rename(tmp, this.cfgPath);
    } catch (e) {
      this.log('error', 'ذخیره‌ی async config.json ناموفق بود', e.message);
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
      }
    };
  }

  getSecret() {
    return this.secret;
  }

  setSecret(sec) {
    this.secret = sec ? String(sec).trim() : '';
  }

  getEffectiveAppearance(profileName) {
    if (!profileName || profileName === 'default') {
      return this.config.appearance;
    }
    const profile = this.config.profiles && this.config.profiles[profileName];
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
}

module.exports = {
  ConfigStore
};

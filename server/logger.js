'use strict';
const { LIMITS } = require('./constants');

function safe(v) {
  try {
    return JSON.parse(
      JSON.stringify(v, (k, val) =>
        k === 'secret_id' || k === 'authorization' || k === 'secret_id_enc' ? '[redacted]' : val
      )
    );
  } catch {
    return String(v);
  }
}

class Logger {
  constructor({ onLog, broadcast } = {}) {
    this.logs = [];
    this.onLog = onLog || null;
    this.broadcast = broadcast || (() => {});
  }

  log(level, msg, extra) {
    const entry = { t: new Date().toISOString(), level, msg, extra: extra === undefined ? undefined : safe(extra) };
    this.logs.push(entry);
    if (this.logs.length > LIMITS.logs) this.logs.shift();
    const line = `[${entry.t.slice(11, 19)}] ${level.toUpperCase()} ${msg}${extra !== undefined ? ' ' + JSON.stringify(entry.extra) : ''}`;
    (level === 'error' ? console.error : console.log)(line);
    if (this.onLog) {
      try {
        this.onLog(line);
      } catch {}
    }
    this.broadcast('admin', { type: 'log', entry });
  }

  info(msg, extra) {
    this.log('info', msg, extra);
  }

  warn(msg, extra) {
    this.log('warn', msg, extra);
  }

  error(msg, extra) {
    this.log('error', msg, extra);
  }

  getRecentLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

module.exports = {
  safe,
  Logger
};

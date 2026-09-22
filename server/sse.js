'use strict';

class SseManager {
  constructor() {
    this.clients = {
      overlay: new Set(),
      admin: new Set(),
      preview: new Set(),
      goal: new Set(),
      top: new Set()
    };
    this.keepAliveTimer = null;
    this.getState = null;
    this.clientProfiles = new WeakMap();
  }

  init({ getState }) {
    this.getState = getState;
    this.keepAliveTimer = setInterval(() => {
      for (const role of Object.keys(this.clients)) {
        for (const res of this.clients[role]) {
          try {
            res.write(':ka\n\n');
          } catch {}
        }
      }
    }, 15000);
  }

  addClient(role, res, { profile = 'default' } = {}) {
    if (!this.clients[role]) {
      this.clients[role] = new Set();
    }
    this.clients[role].add(res);
    this.clientProfiles.set(res, profile || 'default');
  }

  removeClient(role, res) {
    if (this.clients[role]) {
      this.clients[role].delete(res);
    }
    this.clientProfiles.delete(res);
  }

  clientCount(role) {
    return this.clients[role] ? this.clients[role].size : 0;
  }

  broadcast(role, obj) {
    if (!this.clients[role]) return;
    const data = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of this.clients[role]) {
      try {
        res.write(data);
      } catch {}
    }
  }

  broadcastAll(obj) {
    for (const role of Object.keys(this.clients)) {
      this.broadcast(role, obj);
    }
  }

  broadcastAppearance(getAppearance) {
    for (const role of ['overlay', 'preview']) {
      for (const res of this.clients[role]) {
        try {
          const profile = this.clientProfiles.get(res) || 'default';
          res.write(`data: ${JSON.stringify({ type: 'config', appearance: getAppearance(profile), profile })}\n\n`);
        } catch {}
      }
    }
  }

  sendState() {
    if (this.getState) {
      this.broadcast('admin', { type: 'state', state: this.getState() });
    }
  }

  close() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    for (const role of Object.keys(this.clients)) {
      for (const res of this.clients[role]) {
        try {
          res.end();
        } catch {}
      }
      this.clients[role].clear();
    }
  }
}

module.exports = {
  SseManager
};

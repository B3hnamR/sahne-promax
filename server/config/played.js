'use strict';
const fs = require('fs');
const path = require('path');
const { LIMITS } = require('../constants');

class PlayedStore {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'played.json');
    this.playedIds = new Set();
    this.playedOrder = [];
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      const arr = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(arr)) {
        for (const id of arr.slice(-LIMITS.played)) {
          this.playedIds.add(String(id));
          this.playedOrder.push(String(id));
        }
      }
    } catch {}
  }

  isPlayed(id) {
    return !!(id && this.playedIds.has(String(id)));
  }

  markPlayed(id) {
    const sId = String(id || '');
    if (!sId || this.playedIds.has(sId)) return;
    this.playedIds.add(sId);
    this.playedOrder.push(sId);
    while (this.playedOrder.length > LIMITS.played) {
      this.playedIds.delete(this.playedOrder.shift());
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.promises.writeFile(this.filePath, JSON.stringify(this.playedOrder)).catch(() => {});
    }, 500);
  }

  clear() {
    this.playedIds.clear();
    this.playedOrder = [];
    clearTimeout(this.saveTimer);
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {}
  }
}

module.exports = {
  PlayedStore
};

'use strict';
const { MELD_WS } = require('../constants');

class MeldManager {
  constructor({ configStore, logger, sse, enabled = false }) {
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
    this.enabled = !!enabled;
    this.meldLastReload = 0;
    this.overlayMissingSince = null; // only count after the first overlay disconnect, not from startup
    this.checkTimer = null;
  }

  start() {
    if (!this.enabled) return;
    this.checkTimer = setInterval(() => {
      if (this.sse.clientCount('overlay') > 0) {
        this.overlayMissingSince = Date.now();
        return;
      }
      if (
        this.overlayMissingSince != null &&
        Date.now() - this.overlayMissingSince > 20000 &&
        Date.now() - this.meldLastReload > 120000
      ) {
        this.meldLastReload = Date.now();
        this.reloadLayers('no overlay connected');
      }
    }, 10000);
  }

  reloadLayers(reason) {
    return new Promise(resolve => {
      if (!this.enabled) return resolve(false);
      let mws;
      try {
        mws = new WebSocket(MELD_WS);
      } catch {
        return resolve(false);
      }
      let id = 1;
      const waiting = new Map();
      let done = false;

      const finish = v => {
        if (!done) {
          done = true;
          try {
            mws.close();
          } catch {}
          resolve(v);
        }
      };

      const send = msg =>
        new Promise(res => {
          const i = id++;
          waiting.set(i, res);
          mws.send(JSON.stringify({ ...msg, id: i }));
        });

      const t = setTimeout(() => finish(false), 8000);
      mws.onerror = () => finish(false);
      mws.onmessage = ev => {
        try {
          const m = JSON.parse(ev.data);
          if (m.id && waiting.has(m.id)) {
            waiting.get(m.id)(m.data);
            waiting.delete(m.id);
          }
        } catch {}
      };

      mws.onopen = async () => {
        try {
          const objs = await send({ type: 3 });
          const meld = objs && objs.meld;
          if (!meld) return finish(false);
          const methods = Object.fromEntries((meld.methods || []).map(([n, i]) => [n, i]));
          const props = {};
          for (const pr of meld.properties || []) props[pr[1]] = pr[3];
          const all = (props.session && props.session.items) || {};

          const config = this.configStore.config;
          const isOurs = u => {
            try {
              const x = new URL(String(u || ''));
              return (
                x.protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(x.hostname) &&
                Number(x.port) === Number(config.port) &&
                x.pathname.replace(/\/+$/, '') === '/overlay'
              );
            } catch {
              return false;
            }
          };

          const mine = Object.entries(all).filter(([, l]) => l.type === 'layer' && isOurs(l.url));
          for (const [lid] of mine) {
            await send({
              type: 6,
              object: 'meld',
              method: methods.setProperty,
              args: [lid, 'url', `http://localhost:${config.port}/overlay?r=${Date.now()}`]
            });
          }
          clearTimeout(t);
          this.logger.info('لایه‌های Browser داخل Meld ری‌لود شدند', { count: mine.length, reason });
          this.meldLastReload = Date.now();
          finish(mine.length > 0);
        } catch {
          finish(false);
        }
      };
    });
  }

  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }
}

module.exports = {
  MeldManager
};

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIMITS } = require('../constants');
const { typeOf, sniffOk, safeMediaName, parseThreshold } = require('../utils/validation');

class MediaManager {
  constructor({ mediaDir, configStore, logger, sse }) {
    this.mediaDir = mediaDir;
    this.configStore = configStore;
    this.logger = logger;
    this.sse = sse;
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  newFileEntry(file, size) {
    const name = path.basename(file, path.extname(file));
    return {
      id: crypto.randomBytes(5).toString('hex'),
      file,
      name,
      type: typeOf(file),
      audioFile: null,
      enabled: true,
      minToman: parseThreshold(name),
      maxToman: null,
      minAmount: 0,
      maxAmount: null,
      minMonths: null,
      maxMonths: null,
      minCount: null,
      maxCount: null,
      keywords: [],
      volume: 100,
      duration: null,
      cardDelay: null,
      size
    };
  }

  uniqueMediaName(orig) {
    const base = safeMediaName(orig);
    let file = base;
    let i = 1;
    while (fs.existsSync(path.join(this.mediaDir, file))) {
      const e = path.extname(base);
      file = base.slice(0, -e.length) + '_' + i++ + e;
    }
    return file;
  }

  async importFilesAsync(paths) {
    const added = [];
    const skipped = [];
    const config = this.configStore.config;

    for (const src0 of (Array.isArray(paths) ? paths : []).slice(0, 100)) {
      const src = String(src0 || '');
      const shown = path.basename(src);
      try {
        if (!path.isAbsolute(src)) {
          skipped.push(shown + ' (مسیر نامعتبر)');
          continue;
        }
        const real = await fs.promises.realpath(src);
        const st = await fs.promises.stat(real);
        const ext = path.extname(real).toLowerCase();
        const type = typeOf(real);

        if (!st.isFile() || !type) {
          skipped.push(shown + ' (فرمت پشتیبانی نمی‌شود)');
          continue;
        }
        if (st.size > LIMITS.upload) {
          skipped.push(shown + ' (بزرگ‌تر از ۵۱۲ مگابایت)');
          continue;
        }
        if (config.files.length >= LIMITS.files) {
          skipped.push(shown + ' (سقف تعداد فایل)');
          continue;
        }

        const fh = await fs.promises.open(real, 'r');
        const head = Buffer.alloc(16);
        await fh.read(head, 0, 16, 0);
        await fh.close();

        if (!sniffOk(head, ext)) {
          skipped.push(shown + ' (محتوای فایل با پسوندش نمی‌خواند)');
          continue;
        }

        const file = this.uniqueMediaName(real);
        await fs.promises.copyFile(real, path.join(this.mediaDir, file));
        const entry = this.newFileEntry(file, st.size);
        config.files.push(entry);
        added.push(entry);
        this.logger.info('فایل اضافه شد', { file, type });
      } catch (e) {
        skipped.push(shown);
        this.logger.warn('افزودن فایل ناموفق', e.message);
      }
    }

    if (added.length) {
      this.configStore.saveConfig();
      this.sse.broadcast('admin', { type: 'files_updated', count: config.files.length });
    }
    this.sse.sendState();
    return { added, skipped };
  }

  async scanMediaDirectory() {
    const config = this.configStore.config;
    const known = new Set(config.files.map(f => f.file));
    let added = 0;
    try {
      const list = await fs.promises.readdir(this.mediaDir);
      for (const f of list) {
        if (f.startsWith('.') || known.has(f)) continue;
        const fp = path.join(this.mediaDir, f);
        try {
          const st = await fs.promises.stat(fp);
          if (!st.isFile()) continue;
          const ext = path.extname(f).toLowerCase();
          const t = typeOf(f);
          if (!t) continue;

          const fh = await fs.promises.open(fp, 'r');
          const head = Buffer.alloc(16);
          await fh.read(head, 0, 16, 0);
          await fh.close();

          if (!sniffOk(head, ext)) continue;
          const entry = this.newFileEntry(f, st.size);
          config.files.push(entry);
          known.add(f);
          added++;
        } catch {}
      }
      if (added > 0) {
        this.configStore.saveConfig();
        this.logger.info('فولدر اسکن شد', { added });
        this.sse.broadcast('admin', { type: 'files_updated', count: config.files.length });
        this.sse.sendState();
      }
    } catch {}
    return { added, total: config.files.length };
  }

  async deleteFile(id) {
    const config = this.configStore.config;
    const idx = config.files.findIndex(f => f.id === id);
    if (idx === -1) return false;
    const entry = config.files[idx];
    config.files.splice(idx, 1);
    this.configStore.saveConfig();

    try {
      await fs.promises.unlink(path.join(this.mediaDir, entry.file));
    } catch {}

    this.logger.info('فایل حذف شد', { file: entry.file });
    this.sse.broadcast('admin', { type: 'files_updated', count: config.files.length });
    this.sse.sendState();
    return true;
  }
}

module.exports = {
  MediaManager
};

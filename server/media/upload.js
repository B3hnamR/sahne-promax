'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIMITS } = require('../constants');
const { typeOf, sniffOk } = require('../utils/validation');

async function handleStreamUpload(req, res, { mediaManager, origName, json }) {
  const orig = String(origName || '');
  const ext = path.extname(orig).toLowerCase();
  const type = typeOf(orig);

  if (!type) {
    return json(res, 400, { error: 'فرمت پشتیبانی نمی‌شود' });
  }
  if (mediaManager.configStore.config.files.length >= LIMITS.files) {
    return json(res, 400, { error: 'سقف تعداد فایل پر است' });
  }

  const tmp = path.join(mediaManager.mediaDir, '.upload-' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let size = 0;
  let head = Buffer.alloc(0);

  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      let failed = null;
      const fail = err => {
        if (!failed) failed = err;
        req.unpipe(out);
        if (!out.destroyed) out.destroy();
      };
      out.on('close', () => (failed ? reject(failed) : resolve()));
      out.on('error', fail);
      req.on('error', fail);
      req.on('close', () => {
        if (!req.complete) fail(new Error('aborted'));
      });
      req.on('data', c => {
        size += c.length;
        if (head.length < 16) head = Buffer.concat([head, c]).subarray(0, 16);
        if (size > LIMITS.upload) {
          fail(new Error('too large'));
          req.destroy();
        }
      });
      req.pipe(out);
    });
  } catch (e) {
    try {
      await fs.promises.unlink(tmp);
    } catch {}
    return json(res, 413, { error: 'فایل بزرگ‌تر از ۵۱۲ مگابایت است' });
  }

  if (!sniffOk(head, ext)) {
    try {
      await fs.promises.unlink(tmp);
    } catch {}
    return json(res, 400, { error: 'محتوای فایل با پسوندش نمی‌خواند' });
  }

  const file = mediaManager.uniqueMediaName(orig);
  await fs.promises.rename(tmp, path.join(mediaManager.mediaDir, file));
  const entry = mediaManager.newFileEntry(file, size);
  mediaManager.configStore.config.files.push(entry);
  mediaManager.configStore.saveConfig();
  mediaManager.logger.info('فایل اضافه شد', { file, type });
  mediaManager.sse.broadcast('admin', { type: 'files_updated', count: mediaManager.configStore.config.files.length });
  mediaManager.sse.sendState();
  return json(res, 200, { ok: true, entry });
}

module.exports = {
  handleStreamUpload
};

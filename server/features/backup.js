'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Readable, Transform, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const { safeMediaName } = require('../utils/validation');

const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 1000;

function portableConfig(config) {
  const copy = { ...config };
  if (copy.donofa && typeof copy.donofa === 'object')
    copy.donofa = {
      ...copy.donofa,
      reconnectRequired: !!(copy.donofa.reconnectRequired || copy.donofa_key || copy.donofa_key_enc)
    };
  // DPAPI blobs are tied to a Windows user and plaintext secrets must not be
  // embedded in a portable download. Account identifiers remain for the UI.
  delete copy.secret_id;
  delete copy.secret_id_enc;
  delete copy.se_token;
  delete copy.se_token_enc;
  delete copy.donofa_key;
  delete copy.donofa_key_enc;
  if (copy.rate && typeof copy.rate.proxy === 'string') {
    // A proxy URL can embed user:pass with or without a scheme; keep the route,
    // drop the credentials.
    copy.rate = { ...copy.rate, proxy: copy.rate.proxy.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^/]*@/i, '$1') };
  }
  return copy;
}

function createZipArchive(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const [filePath, data] of Object.entries(files)) {
    const rawBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const nameBuf = Buffer.from(filePath.replace(/\\/g, '/'), 'utf8');
    const crc = zlib.crc32(rawBuf);
    const compressed = zlib.deflateRawSync(rawBuf);

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(8, 8); // Compression method: Deflate (8)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field length

    localChunks.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0, 8); // Flags
    centralHeader.writeUInt16LE(8, 10); // Compression method
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralChunks.reduce((acc, c) => acc + c.length, 0);
  const totalEntries = Object.keys(files).length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(totalEntries, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(totalEntries, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // Offset of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

async function exportBackupToFile(dataDir, configStore = null, limits = {}) {
  const maxEntryBytes = limits.maxEntryBytes || MAX_ENTRY_BYTES;
  const maxTotalBytes = limits.maxTotalBytes || MAX_TOTAL_BYTES;
  const maxArchiveBytes = limits.maxArchiveBytes || MAX_ARCHIVE_BYTES;
  const cfgPath = path.join(dataDir, 'config.json');
  let config;
  if (configStore && typeof configStore.serializedConfig === 'function') config = configStore.serializedConfig();
  else config = JSON.parse(await fs.promises.readFile(cfgPath, 'utf8'));
  const mediaDir = path.join(dataDir, 'media');
  const mediaEntries = [];
  const renames = new Map();
  const usedNames = new Set();
  try {
    for (const name of await fs.promises.readdir(mediaDir)) {
      if (name.startsWith('.')) continue;
      const safe = safeMediaName(name);
      if (usedNames.has(safe)) {
        if (configStore && typeof configStore.log === 'function')
          configStore.log('warn', 'دو فایل رسانه پس از اصلاح نام یکی می‌شوند؛ دومی در پشتیبان گذاشته نشد', {
            name,
            safe
          });
        continue;
      }
      usedNames.add(safe);
      if (safe !== name) {
        renames.set(name, safe);
        if (configStore && typeof configStore.log === 'function')
          configStore.log('info', 'نام فایل رسانه در پشتیبان اصلاح شد', { name, safe });
      }
      const file = path.join(mediaDir, name);
      const st = await fs.promises.lstat(file);
      if (st.isFile()) mediaEntries.push({ name: 'media/' + safe, file, size: st.size });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const portable = portableConfig(config);
  if (renames.size && Array.isArray(portable.files)) {
    portable.files = portable.files.map(f =>
      f && typeof f === 'object'
        ? {
            ...f,
            file: renames.get(f.file) || f.file,
            audioFile: f.audioFile ? renames.get(f.audioFile) || f.audioFile : f.audioFile
          }
        : f
    );
  }
  const entries = [
    {
      name: 'config.json',
      data: Buffer.from(JSON.stringify(portable, null, 2), 'utf8')
    },
    ...mediaEntries
  ];
  const historyPath = path.join(dataDir, 'history.json');
  try {
    const st = await fs.promises.lstat(historyPath);
    if (st.isFile()) entries.push({ name: 'history.json', file: historyPath, size: st.size });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entries.length > MAX_ENTRIES) throw new Error('Backup contains too many files');
  let totalRaw = 0;
  for (const entry of entries) {
    const size = entry.data ? entry.data.length : entry.size;
    if (entry.name === 'config.json' && size > 8 * 1024 * 1024) throw new Error('Backup config is too large');
    if (entry.name === 'history.json' && size > 128 * 1024 * 1024) throw new Error('Backup history is too large');
    if (size > maxEntryBytes) throw new Error('A backup file exceeds the 512 MB per-file limit');
    totalRaw += size;
    if (totalRaw > maxTotalBytes) throw new Error('Backup exceeds the 1 GB total size limit');
  }

  const filePath = path.join(dataDir, '.backup-export-' + crypto.randomUUID() + '.zip');
  let out;
  try {
    out = await fs.promises.open(filePath, 'wx');
    let position = 0;
    let totalRawBytes = 0;
    const central = [];
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const append = async chunk => {
      if (position + chunk.length > maxArchiveBytes) throw new Error('Backup ZIP exceeds the 1 GB download limit');
      let written = 0;
      while (written < chunk.length) {
        const result = await out.write(chunk, written, chunk.length - written, position);
        if (!result.bytesWritten) throw new Error('Backup ZIP write failed');
        written += result.bytesWritten;
        position += result.bytesWritten;
      }
    };
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const utf8Name = name.some(byte => byte >= 0x80);
      const nameFlags = utf8Name ? 0x0808 : 0x0008; // bit 3 (descriptor) + bit 11 (UTF-8 name)
      const localOffset = position;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(nameFlags, 6); // sizes and CRC follow the data in a descriptor
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(dosTime, 10);
      local.writeUInt16LE(dosDate, 12);
      local.writeUInt16LE(name.length, 26);
      await append(local);
      await append(name);
      const compressedStart = position;
      let crc = 0;
      let rawSize = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          rawSize += chunk.length;
          totalRawBytes += chunk.length;
          if (rawSize > maxEntryBytes) return callback(new Error('Backup file grew beyond the per-file limit'));
          if (totalRawBytes > maxTotalBytes) return callback(new Error('Backup exceeds the 1 GB total size limit'));
          crc = zlib.crc32(chunk, crc);
          callback(null, chunk);
        }
      });
      const source = entry.data ? Readable.from([entry.data]) : fs.createReadStream(entry.file);
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          append(chunk).then(() => callback(), callback);
        }
      });
      await pipeline(source, counter, zlib.createDeflateRaw(), sink);
      const compressedSize = position - compressedStart;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(rawSize, 12);
      await append(descriptor);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(nameFlags, 8);
      record.writeUInt16LE(8, 10);
      record.writeUInt16LE(dosTime, 12);
      record.writeUInt16LE(dosDate, 14);
      record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(compressedSize, 20);
      record.writeUInt32LE(rawSize, 24);
      record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE(localOffset, 42);
      central.push(record, name);
    }
    const centralOffset = position;
    for (const chunk of central) await append(chunk);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(position - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    await append(end);
    await out.close();
    out = null;
    return { filePath, size: position };
  } catch (error) {
    if (out) await out.close();
    await fs.promises.rm(filePath, { force: true });
    throw error;
  }
}

async function exportBackup(dataDir, configStore = null) {
  const result = await exportBackupToFile(dataDir, configStore);
  try {
    return await fs.promises.readFile(result.filePath);
  } finally {
    await fs.promises.rm(result.filePath, { force: true });
  }
}

async function readExact(handle, length, position) {
  const data = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const result = await handle.read(data, done, length - done, position + done);
    if (!result.bytesRead) throw new Error('Corrupted archive: truncated data');
    done += result.bytesRead;
  }
  return data;
}

async function archiveEntries(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const size = (await handle.stat()).size;
    if (size < 22 || size > MAX_ARCHIVE_BYTES) throw new Error('Invalid backup archive size');
    const tailStart = Math.max(0, size - 65557);
    const tail = await readExact(handle, size - tailStart, tailStart);
    let endOffset = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
        endOffset = tailStart + i;
        break;
      }
    }
    if (endOffset < 0) throw new Error('Corrupted archive: missing end record');
    const end = tail.subarray(endOffset - tailStart);
    const count = end.readUInt16LE(10);
    if (count > MAX_ENTRIES) throw new Error('Archive has too many entries');
    const directorySize = end.readUInt32LE(12);
    const directoryOffset = end.readUInt32LE(16);
    if (directoryOffset + directorySize > endOffset) throw new Error('Corrupted archive: invalid directory');
    const entries = [];
    let cursor = directoryOffset;
    let totalRaw = 0;
    const names = new Set();
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > endOffset) throw new Error('Corrupted archive: truncated directory entry');
      const header = await readExact(handle, 46, cursor);
      if (header.readUInt32LE(0) !== 0x02014b50) throw new Error('Corrupted archive: bad directory entry');
      const flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10);
      const crc = header.readUInt32LE(16);
      const compressedSize = header.readUInt32LE(20);
      const rawSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const localOffset = header.readUInt32LE(42);
      if (flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported backup ZIP entry');
      if (rawSize > MAX_ENTRY_BYTES) throw new Error('Archive entry exceeds the extraction limit');
      totalRaw += rawSize;
      if (totalRaw > MAX_TOTAL_BYTES) throw new Error('Archive exceeds the total extraction limit');
      if (cursor + 46 + nameLength + extraLength + commentLength > endOffset)
        throw new Error('Corrupted archive: truncated file name');
      const name = (await readExact(handle, nameLength, cursor + 46)).toString('utf8');
      if (name !== 'config.json' && name !== 'history.json' && !/^media\/[^/\\]+$/.test(name))
        throw new Error('Backup contains an unexpected path');
      if (name === 'config.json' && rawSize > 8 * 1024 * 1024) throw new Error('Backup config is too large');
      if (name === 'history.json' && rawSize > 128 * 1024 * 1024) throw new Error('Backup history is too large');
      // Media names in older backups may not be canonical; restore them under a
      // sanitized name and rewrite the config references below.
      const entryName = name.startsWith('media/') ? 'media/' + safeMediaName(name.slice(6)) : name;
      const key = entryName.toLowerCase();
      if (names.has(key)) throw new Error('Archive has duplicate names');
      names.add(key);
      const local = await readExact(handle, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== method)
        throw new Error('Corrupted archive: bad local header');
      const localName = (await readExact(handle, local.readUInt16LE(26), localOffset + 30)).toString('utf8');
      if (localName !== name) throw new Error('Corrupted archive: mismatched local name');
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataStart + compressedSize > directoryOffset) throw new Error('Corrupted archive: file data out of range');
      entries.push({ name: entryName, sourceName: name, method, crc, compressedSize, rawSize, dataStart });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

async function extractEntryToFile(archivePath, entry, outputPath) {
  if (entry.compressedSize === 0 && entry.rawSize === 0 && entry.method === 0) {
    await fs.promises.writeFile(outputPath, Buffer.alloc(0));
    return;
  }
  let bytes = 0;
  let crc = 0;
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > entry.rawSize || bytes > MAX_ENTRY_BYTES)
        return callback(new Error('Archive entry exceeds declared size'));
      crc = zlib.crc32(chunk, crc);
      callback(null, chunk);
    }
  });
  const input = fs.createReadStream(archivePath, {
    start: entry.dataStart,
    end: entry.dataStart + entry.compressedSize - 1
  });
  if (entry.method === 8)
    await pipeline(input, zlib.createInflateRaw(), verify, fs.createWriteStream(outputPath, { flags: 'wx' }));
  else await pipeline(input, verify, fs.createWriteStream(outputPath, { flags: 'wx' }));
  if (bytes !== entry.rawSize || crc !== entry.crc) throw new Error('Corrupted archive: entry checksum mismatch');
}

async function importBackupFromFile(dataDir, archivePath, { configStore, logger, sse, historyStore = null }) {
  const entries = await archiveEntries(archivePath);
  if (!entries.some(entry => entry.name === 'config.json')) throw new Error('فایل config.json در پشتیبان یافت نشد');
  const stage = await fs.promises.mkdtemp(path.join(dataDir, '.restore-'));
  const stageMedia = path.join(stage, 'media');
  const rollback = path.join(stage, 'rollback');
  let keepStage = false;
  let mediaCount = 0;
  try {
    await fs.promises.mkdir(stageMedia);
    await fs.promises.mkdir(rollback);
    for (const entry of entries) {
      const target = entry.name.startsWith('media/')
        ? path.join(stageMedia, entry.name.slice(6))
        : path.join(stage, entry.name);
      await extractEntryToFile(archivePath, entry, target);
      if (entry.name.startsWith('media/')) mediaCount++;
    }
    let restored;
    try {
      restored = JSON.parse(
        (await fs.promises.readFile(path.join(stage, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')
      );
    } catch {
      throw new Error('Backup config.json is not valid JSON');
    }
    if (!restored || typeof restored !== 'object' || Array.isArray(restored))
      throw new Error('Backup config.json must contain a settings object');
    const renames = new Map(
      entries
        .filter(entry => entry.sourceName && entry.sourceName !== entry.name && entry.sourceName.startsWith('media/'))
        .map(entry => [entry.sourceName.slice(6), entry.name.slice(6)])
    );
    if (renames.size && Array.isArray(restored.files)) {
      restored.files = restored.files.map(f =>
        f && typeof f === 'object'
          ? {
              ...f,
              file: renames.get(f.file) || f.file,
              audioFile: f.audioFile ? renames.get(f.audioFile) || f.audioFile : f.audioFile
            }
          : f
      );
    }
    const reconnectRequired = {
      kickbot: !!restored.streamer_id || !!(configStore.getSecret && configStore.getSecret()),
      streamelements: !!(restored.se && restored.se.channelId) || !!configStore.seToken,
      donofa: !!(restored.donofa && restored.donofa.reconnectRequired) || !!configStore.donofaKey
    };
    // The HTTP server is already bound to the live port; installing the backup's
    // port would make every Host/Origin check fail until an app restart.
    restored.port = configStore.config.port;
    await fs.promises.writeFile(path.join(stage, 'config.json'), JSON.stringify(portableConfig(restored), null, 2));
    const hasHistory = entries.some(entry => entry.name === 'history.json');
    if (hasHistory) {
      let history;
      try {
        history = JSON.parse(
          (await fs.promises.readFile(path.join(stage, 'history.json'), 'utf8')).replace(/^\uFEFF/, '')
        );
      } catch {
        throw new Error('Backup history.json is not valid JSON');
      }
      if (!history || typeof history !== 'object' || Array.isArray(history) || !Array.isArray(history.entries))
        throw new Error('Backup history.json is not a valid history ledger');
    }
    // Prepared files are validated before any live file is moved. The rename
    // phase runs synchronously so requests cannot observe a partial restore.
    const targets = [
      { name: 'config.json', stage: path.join(stage, 'config.json'), live: path.join(dataDir, 'config.json') },
      { name: 'media', stage: stageMedia, live: path.join(dataDir, 'media') }
    ];
    if (hasHistory)
      targets.push({
        name: 'history.json',
        stage: path.join(stage, 'history.json'),
        live: path.join(dataDir, 'history.json')
      });
    configStore.invalidatePendingSaves();
    const movedOld = [];
    const movedNew = [];
    try {
      for (const target of targets) {
        if (fs.existsSync(target.live)) {
          fs.renameSync(target.live, path.join(rollback, target.name));
          movedOld.push(target);
        }
      }
      for (const target of targets) {
        fs.renameSync(target.stage, target.live);
        movedNew.push(target);
      }
    } catch (error) {
      try {
        for (const target of movedNew.reverse()) fs.renameSync(target.live, target.stage);
        for (const target of movedOld.reverse()) fs.renameSync(path.join(rollback, target.name), target.live);
      } catch (rollbackError) {
        // The previous files are only in the staging directory now: never delete
        // them. Leave .restore-* in place for manual recovery.
        keepStage = true;
        logger.error('بازگردانی فایل‌های قبلی پس از شکست بازیابی ناموفق بود', {
          error: rollbackError.message,
          stage
        });
      }
      throw error;
    }
    // A restore must not delete media that only exists on this machine: move
    // previously-live files the backup did not contain back into media/.
    const previousMedia = path.join(rollback, 'media');
    if (fs.existsSync(previousMedia)) {
      const failed = [];
      for (const name of fs.readdirSync(previousMedia)) {
        try {
          const from = path.join(previousMedia, name);
          const to = path.join(dataDir, 'media', name);
          if (!fs.existsSync(to)) fs.renameSync(from, to);
        } catch {
          failed.push(name);
        }
      }
      if (failed.length) {
        // The only copy of these files is still in the staging directory: never
        // delete it, and point the operator at the recovery location.
        keepStage = true;
        logger.warn('بازگرداندن فایل‌های رسانه‌ی محلی ناموفق بود؛ پوشه‌ی موقت نگه داشته شد', {
          stage,
          names: failed
        });
      }
    }
    configStore.config = configStore.loadConfig();
    if (historyStore && hasHistory) historyStore.reload();
    logger.info('اطلاعات با موفقیت بازیابی شد', { mediaFiles: mediaCount, reconnectRequired });
    sse.broadcast('admin', { type: 'backup_restored' });
    sse.sendState();
    return { ok: true, success: true, mediaFiles: mediaCount, restoredFiles: mediaCount, reconnectRequired };
  } finally {
    if (!keepStage) {
      try {
        await fs.promises.rm(stage, { recursive: true, force: true });
      } catch (error) {
        // The restore is committed; a leftover staging directory must not turn it
        // into a failure (and must not leave the API reporting an error).
        logger.warn('پاک‌سازی پوشه‌ی موقت بازیابی ناموفق بود', { stage, error: error.message });
      }
    }
  }
}

async function importBackup(dataDir, zipBuffer, context) {
  const filePath = path.join(dataDir, '.backup-upload-' + crypto.randomUUID() + '.zip');
  try {
    await fs.promises.writeFile(filePath, zipBuffer, { flag: 'wx' });
    return await importBackupFromFile(dataDir, filePath, context);
  } finally {
    await fs.promises.rm(filePath, { force: true });
  }
}

module.exports = {
  createZipArchive,
  exportBackup,
  exportBackupToFile,
  importBackup,
  importBackupFromFile,
  MAX_ARCHIVE_BYTES
};

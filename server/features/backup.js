'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { safeMediaName } = require('../utils/validation');

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

function extractZipArchive(
  buf,
  { maxEntryBytes = 512 * 1024 * 1024, maxTotalBytes = 1024 * 1024 * 1024, maxEntries = 1000 } = {}
) {
  const result = {};
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error('Invalid archive: buffer too small');
  }

  // Find End of Central Directory (search backwards from end)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Corrupted archive: End of Central Directory not found');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  if (totalEntries > maxEntries) throw new Error('Archive has too many entries');
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  if (centralDirOffset >= eocdOffset) throw new Error('Corrupted archive: invalid central directory offset');

  let curOffset = centralDirOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (curOffset + 46 > eocdOffset) throw new Error('Corrupted archive: truncated central directory');
    const sig = buf.readUInt32LE(curOffset);
    if (sig !== 0x02014b50) throw new Error('Corrupted archive: invalid central directory record');

    const compression = buf.readUInt16LE(curOffset + 10);
    const uncompressedSize = buf.readUInt32LE(curOffset + 24);
    const compressedSize = buf.readUInt32LE(curOffset + 20);
    const nameLen = buf.readUInt16LE(curOffset + 28);
    const extraLen = buf.readUInt16LE(curOffset + 30);
    const commentLen = buf.readUInt16LE(curOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(curOffset + 42);

    if (uncompressedSize > maxEntryBytes) throw new Error('Archive entry exceeds the extraction limit');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalBytes) throw new Error('Archive exceeds the total extraction limit');
    if (curOffset + 46 + nameLen + extraLen + commentLen > eocdOffset) {
      throw new Error('Corrupted archive: truncated central directory entry');
    }

    const fileName = buf.toString('utf8', curOffset + 46, curOffset + 46 + nameLen);
    curOffset += 46 + nameLen + extraLen + commentLen;

    // Read file from local header
    if (localHeaderOffset + 30 > centralDirOffset) throw new Error('Corrupted archive: invalid local header offset');
    const localSig = buf.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) throw new Error('Corrupted archive: invalid local header');

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > centralDirOffset) throw new Error('Corrupted archive: truncated file data');

    const fileDataChunk = buf.subarray(dataOffset, dataOffset + compressedSize);
    let extracted;
    if (compression === 8) {
      try {
        extracted = zlib.inflateRawSync(fileDataChunk, { maxOutputLength: maxEntryBytes });
      } catch {
        throw new Error('Invalid or oversized compressed archive entry');
      }
    } else if (compression === 0) {
      extracted = Buffer.from(fileDataChunk);
    } else {
      throw new Error('Unsupported archive compression method');
    }

    if (extracted.length !== uncompressedSize) throw new Error('Corrupted archive: entry size mismatch');

    result[fileName] = extracted;
  }

  return result;
}

async function exportBackup(dataDir, configStore = null) {
  const files = {};
  if (configStore && typeof configStore.serializedConfig === 'function') {
    files['config.json'] = Buffer.from(JSON.stringify(configStore.serializedConfig(), null, 2), 'utf8');
  } else {
    const cfgPath = path.join(dataDir, 'config.json');
    if (fs.existsSync(cfgPath)) {
      files['config.json'] = await fs.promises.readFile(cfgPath);
    }
  }

  const mediaDir = path.join(dataDir, 'media');
  if (fs.existsSync(mediaDir)) {
    const list = await fs.promises.readdir(mediaDir);
    for (const f of list) {
      if (f.startsWith('.')) continue;
      const fp = path.join(mediaDir, f);
      const st = await fs.promises.stat(fp);
      if (st.isFile()) {
        files['media/' + f] = await fs.promises.readFile(fp);
      }
    }
  }

  // Alert history ledger (2.3.0) — optional, older installs may not have one yet
  const historyPath = path.join(dataDir, 'history.json');
  if (fs.existsSync(historyPath)) {
    files['history.json'] = await fs.promises.readFile(historyPath);
  }

  return createZipArchive(files);
}

async function importBackup(dataDir, zipBuffer, { configStore, logger, sse, historyStore = null }) {
  const extracted = extractZipArchive(zipBuffer);
  if (!extracted['config.json']) {
    throw new Error('فایل config.json در پشتیبان یافت نشد');
  }

  const mediaDir = path.join(dataDir, 'media');
  await fs.promises.mkdir(mediaDir, { recursive: true });

  // Write config.json
  const cfgPath = path.join(dataDir, 'config.json');
  await fs.promises.writeFile(cfgPath, extracted['config.json']);

  // Write media files safely
  let mediaCount = 0;
  for (const [filePath, data] of Object.entries(extracted)) {
    if (filePath.startsWith('media/') && filePath.length > 6) {
      const cleanName = safeMediaName(path.basename(filePath));
      await fs.promises.writeFile(path.join(mediaDir, cleanName), data);
      mediaCount++;
    }
  }

  // Alert history ledger: replace the current one when the backup carries it
  if (historyStore && extracted['history.json']) {
    try {
      await fs.promises.writeFile(path.join(dataDir, 'history.json'), extracted['history.json']);
      historyStore.reload();
      logger.info('تاریخچه‌ی الرت‌ها از پشتیبان بازیابی شد', { entries: historyStore.entries.length });
    } catch (e) {
      logger.warn('بازیابی تاریخچه ناموفق بود', e.message);
    }
  }

  // Reload config
  configStore.config = configStore.loadConfig();
  logger.info('اطلاعات با موفقیت بازیابی شد', { mediaFiles: mediaCount });
  sse.broadcast('admin', { type: 'backup_restored' });
  sse.sendState();

  return { ok: true, success: true, mediaFiles: mediaCount, restoredFiles: mediaCount };
}

module.exports = {
  createZipArchive,
  extractZipArchive,
  exportBackup,
  importBackup
};

'use strict';

const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

async function readLimitedText(body, maxBytes) {
  if (!body) throw new Error('checksum response has no body');
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes).toString('utf8');
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('checksum file too large');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

// pipeline owns both streams for the whole transfer. In particular, a disk write
// failure while waiting for backpressure must reject instead of becoming an
// unhandled stream error or leaving the updater waiting for a drain event.
async function streamDownload(body, output, { maxBytes, total = 0, onProgress = () => {} }) {
  const hash = crypto.createHash('sha256');
  let received = 0;
  let lastPercent = -1;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) return callback(new Error('installer too large'));
      hash.update(chunk);
      const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(body), meter, output);
  return { bytes: received, sha256: hash.digest('hex') };
}

module.exports = { readLimitedText, streamDownload };

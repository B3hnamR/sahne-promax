'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { readLimitedText, streamDownload } = require('../electron/download-core');

function body(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

test('update download hashes streamed bytes and reports progress', async () => {
  const chunks = [Buffer.from('MZ'), Buffer.from('installer')];
  const written = [];
  const progress = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk);
      callback();
    }
  });
  const result = await streamDownload(body(chunks), output, {
    maxBytes: 100,
    total: 11,
    onProgress: value => progress.push(value)
  });
  assert.equal(Buffer.concat(written).toString(), 'MZinstaller');
  assert.equal(result.bytes, 11);
  assert.equal(result.sha256, crypto.createHash('sha256').update('MZinstaller').digest('hex'));
  assert.deepEqual(progress, [18, 99]);
});

test('update download rejects disk failure while writing', async () => {
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' })));
    }
  });
  await assert.rejects(
    streamDownload(body([Buffer.from('MZinstaller')]), output, { maxBytes: 100 }),
    error => error.code === 'ENOSPC'
  );
});

test('a progressing download can exceed the stall window and finish on a slow Windows disk', async () => {
  let chunk = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (chunk === 8) return controller.close();
      await new Promise(resolve => setTimeout(resolve, 100));
      controller.enqueue(Buffer.from('chunk ' + ++chunk));
    }
  });
  const written = [];
  const output = new Writable({
    write(data, _encoding, callback) {
      written.push(data);
      callback();
    },
    final(callback) {
      setTimeout(callback, 200);
    }
  });
  const started = Date.now();
  const result = await streamDownload(stream, output, { maxBytes: 1000, stallMs: 600 });
  assert.ok(Date.now() - started > 600);
  const expected = 'chunk 1chunk 2chunk 3chunk 4chunk 5chunk 6chunk 7chunk 8';
  assert.equal(Buffer.concat(written).toString(), expected);
  assert.equal(result.sha256, crypto.createHash('sha256').update(expected).digest('hex'));
});

test('update download rejects oversized stream without trusting content-length', async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  await assert.rejects(streamDownload(body([Buffer.from('MZinstaller')]), output, { maxBytes: 10 }), /too large/);
});

test('checksum response is bounded while streaming', async () => {
  assert.equal(await readLimitedText(body([Buffer.from('a'), Buffer.from('bc')]), 3), 'abc');
  await assert.rejects(readLimitedText(body([Buffer.from('abcd')]), 3), /checksum file too large/);
});

test('checksum reader rejects a missing body', async () => {
  await assert.rejects(readLimitedText(null, 10), /no body/);
});

test('checksum reader propagates a stream error and cancels the reader', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('a'));
      controller.error(new Error('net fail'));
    }
  });
  await assert.rejects(readLimitedText(stream, 100), /net fail/);
});

test('update download rejects a body error mid-stream', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('MZ'));
      controller.error(new Error('connection lost'));
    }
  });
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  await assert.rejects(streamDownload(stream, output, { maxBytes: 100 }), /connection lost/);
});

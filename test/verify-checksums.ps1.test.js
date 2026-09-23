'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const scriptPath = path.join(__dirname, '..', 'scripts', 'verify-release-checksums.ps1');
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']);
const hasPwsh = !probe.error && probe.status === 0;

function runScript(dir) {
  return spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, '-Directory', dir], { encoding: 'utf8' });
}

test('checksum verifier accepts GNU text and uppercase manifests', { skip: !hasPwsh }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-checksum-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installer = path.join(dir, 'Setup.exe');
  fs.writeFileSync(installer, 'fake installer');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  const manifest = path.join(dir, 'SHA256SUMS.txt');

  fs.writeFileSync(manifest, `${hash} *Setup.exe\n`);
  assert.equal(runScript(dir).status, 0, 'binary marker, lowercase');

  fs.writeFileSync(manifest, `${hash.toUpperCase()}  Setup.exe\n`);
  assert.equal(runScript(dir).status, 0, 'GNU text separator, uppercase');

  fs.writeFileSync(manifest, `${'0'.repeat(64)} *Setup.exe\n`);
  assert.notEqual(runScript(dir).status, 0, 'mismatch fails');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeRules } = require('../server/utils/sanitizers');
const { validateRules } = require('../server/utils/sanitizers');
const { ConfigStore } = require('../server/config/store');
const { resolveMedia, evaluateRules, availabilityFor } = require('../server/playback/rules');
const { exportBackup, importBackup } = require('../server/features/backup');

const validRule = (over = {}) => ({
  id: 'a1b2c3d4e5',
  name: 'Euro celebrations',
  enabled: true,
  conditions: { providers: ['streamelements'], kinds: ['tip'], currency: 'EUR', minToman: 500000 },
  fileId: 'cccccccccc',
  ...over
});

test('sanitizeRules keeps valid rules, drops malformed/contradictory ones, keeps unknown file ids', () => {
  const out = sanitizeRules(
    {
      enabled: true,
      items: [
        validRule(),
        validRule({ id: 'x', fileId: 'nothex' }), // malformed fileId → dropped
        validRule({ conditions: { minToman: 10, maxToman: 5 } }), // min > max → dropped
        validRule({ conditions: { minMonths: 2, maxCount: 5 } }), // months + count → dropped
        validRule({ id: 'b1b2c3d4e5', fileId: 'dddddddddd' }) // unknown but well-formed → kept
      ]
    },
    { v: 1, enabled: false, items: [] },
    [{ id: 'cccccccccc' }]
  );
  assert.equal(out.enabled, true);
  assert.deepEqual(
    out.items.map(r => r.fileId),
    ['cccccccccc', 'dddddddddd']
  );
  assert.equal(out.items[0].conditions.currency, 'EUR');
  assert.equal(out.items[0].conditions.minToman, 500000);
});

test('sanitizeRules bounds strings and numbers, normalizes message text and generates ids', () => {
  const out = sanitizeRules(
    {
      enabled: true,
      items: [
        {
          name: 'x'.repeat(100),
          conditions: {
            providers: ['kickbot', 'kickbot', 'bogus'],
            kinds: ['sub'],
            messageContains: '  سلام   دنیا ',
            minMonths: 3
          },
          fileId: 'aaaaaaaaaa'
        },
        { conditions: { maxToman: 2e12 }, fileId: 'bbbbbbbbbb' }
      ]
    },
    { v: 1, enabled: false, items: [] },
    []
  );
  assert.equal(out.items.length, 2);
  assert.match(out.items[0].id, /^[0-9a-f]{10}$/);
  assert.equal(out.items[0].name.length, 40);
  assert.deepEqual(out.items[0].conditions.providers, ['kickbot']);
  assert.deepEqual(out.items[0].conditions.kinds, ['sub']);
  assert.equal(out.items[0].conditions.messageContains, 'سلام دنیا');
  assert.equal(out.items[0].conditions.minMonths, 3);
  assert.equal(out.items[0].conditions.maxMonths, null);
  assert.equal(out.items[1].conditions.maxToman, 1e12, 'numbers clamp to the model bound');
});

test('config load sanitizes alertRules through the store', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-rules-load-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      alertRules: {
        enabled: true,
        items: [{ fileId: 'nothex' }, { fileId: 'aaaaaaaaaa', conditions: { minToman: 10, maxToman: 5 } }]
      }
    })
  );
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  assert.equal(store.config.alertRules.enabled, true);
  assert.deepEqual(store.config.alertRules.items, []);
});

test('sanitizeRules caps the rule list at 50', () => {
  const items = Array.from({ length: 60 }, (_, i) => validRule({ fileId: String(i).padStart(10, '0') }));
  const out = sanitizeRules({ enabled: true, items }, { v: 1, enabled: false, items: [] }, []);
  assert.equal(out.items.length, 50);
});

test('validateRules rejects malformed shapes instead of widening them', () => {
  const files = [{ id: 'aaaaaaaaaa' }];
  const cases = [
    { enabled: true, items: { fileId: 'aaaaaaaaaa' } },
    { enabled: 'yes', items: [] },
    { enabled: true, items: [{ fileId: 'aaaaaaaaaa', conditions: 'nonsense' }] },
    { enabled: true, items: [{ fileId: 'aaaaaaaaaa', conditions: { providers: 'streamelements' } }] },
    { enabled: true, items: [{ fileId: 'aaaaaaaaaa', conditions: { kinds: 'tip' } }] }
  ];
  for (const body of cases) assert.ok(validateRules(body, files).errors.length, JSON.stringify(body));
  assert.equal(validateRules({ enabled: true, items: [] }, files).errors.length, 0);
});

test('validateRules preserves only an existing missing-file reference', () => {
  const files = [{ id: 'aaaaaaaaaa' }];
  const orphan = validRule({ id: '1111111111', fileId: 'bbbbbbbbbb' });
  const previous = [orphan];
  const unchanged = validateRules({ enabled: false, items: [orphan] }, files, previous);
  assert.deepEqual(unchanged.errors, []);
  assert.equal(unchanged.items[0].fileId, 'bbbbbbbbbb');

  const newRule = validateRules({ enabled: true, items: [validRule({ fileId: 'bbbbbbbbbb' })] }, files, previous);
  assert.ok(newRule.errors.some(error => error.field === 'fileId'));
  const changed = validateRules(
    { enabled: true, items: [validRule({ id: '1111111111', fileId: 'cccccccccc' })] },
    files,
    previous
  );
  assert.ok(changed.errors.some(error => error.field === 'fileId'));
  const duplicate = validateRules({ enabled: true, items: [orphan, orphan] }, files, previous);
  assert.ok(duplicate.errors.some(error => error.field === 'id'));
});

const facts = over => ({
  provider: 'kickbot',
  kind: 'tip',
  currency: 'USD',
  amount: 5,
  toman: 500000,
  message: 'hello',
  months: null,
  count: null,
  isTest: false,
  isReplay: false,
  ...over
});

function rulesConfig(items, over = {}) {
  return {
    files: [
      { id: 'aaaaaaaaaa', file: 'tier.webm', enabled: true, minToman: 0, keywords: [] },
      { id: 'bbbbbbbbbb', file: 'rule.webm', enabled: true, minToman: 1000000, keywords: [] }
    ],
    alertRules: { v: 1, enabled: true, items },
    appearance: {},
    ...over
  };
}

function tempMedia(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sahne-rules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'tier.webm'), 'x');
  fs.writeFileSync(path.join(dir, 'rule.webm'), 'x');
  return dir;
}

test('resolveMedia: first matching rule wins, in order', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([
    { id: 'a1b2c3d4e5', enabled: true, conditions: { providers: ['streamelements'] }, fileId: 'bbbbbbbbbb' },
    { id: 'b1b2c3d4e5', enabled: true, conditions: {}, fileId: 'bbbbbbbbbb' }
  ]);
  const hit = resolveMedia({}, facts({ provider: 'streamelements' }), { config, mediaDir, currentRate: () => 1 });
  assert.equal(hit.source, 'rule');
  assert.equal(hit.ruleId, 'a1b2c3d4e5');
  const second = resolveMedia({}, facts(), { config, mediaDir, currentRate: () => 1 });
  assert.equal(second.ruleId, 'b1b2c3d4e5');
});

test('resolveMedia: unknown FX fails amount conditions, provider-only rules still match', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([
    { id: 'a1b2c3d4e5', enabled: true, conditions: { minToman: 100 }, fileId: 'bbbbbbbbbb' }
  ]);
  const miss = resolveMedia({}, facts({ toman: null }), { config, mediaDir, currentRate: () => 1 });
  assert.equal(miss.source, 'picker', 'a null toman must not match an amount rule');
  const providerOnly = rulesConfig([
    { id: 'a1b2c3d4e5', enabled: true, conditions: { providers: ['kickbot'] }, fileId: 'bbbbbbbbbb' }
  ]);
  const hit = resolveMedia({}, facts({ toman: null }), { config: providerOnly, mediaDir, currentRate: () => 1 });
  assert.equal(hit.source, 'rule');
});

test('resolveMedia: missing/disabled files skip to the next rule, then the picker', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([
    { id: 'a1b2c3d4e5', enabled: true, conditions: {}, fileId: 'dddddddddd' }, // file not registered
    { id: 'b1b2c3d4e5', enabled: true, conditions: {}, fileId: 'aaaaaaaaaa' } // usable
  ]);
  const hit = resolveMedia({}, facts(), { config, mediaDir, currentRate: () => 1 });
  assert.equal(hit.ruleId, 'b1b2c3d4e5');
  assert.equal(hit.media.id, 'aaaaaaaaaa');

  const noneUsable = rulesConfig([{ id: 'a1b2c3d4e5', enabled: true, conditions: {}, fileId: 'dddddddddd' }]);
  const fallback = resolveMedia({}, facts(), { config: noneUsable, mediaDir, currentRate: () => 1 });
  assert.equal(fallback.source, 'picker');
  assert.equal(fallback.media.id, 'aaaaaaaaaa');
});

test('resolveMedia: command alerts bypass rules; disabled rules are skipped', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([
    { id: 'a1b2c3d4e5', enabled: false, conditions: {}, fileId: 'bbbbbbbbbb' },
    { id: 'b1b2c3d4e5', enabled: true, conditions: {}, fileId: 'bbbbbbbbbb' }
  ]);
  const command = resolveMedia({ commandFileId: 'aaaaaaaaaa' }, facts(), { config, mediaDir, currentRate: () => 1 });
  assert.equal(command.source, 'command');
  assert.equal(command.media.id, 'aaaaaaaaaa');

  const onlyDisabled = rulesConfig([{ id: 'a1b2c3d4e5', enabled: false, conditions: {}, fileId: 'bbbbbbbbbb' }]);
  const skipped = resolveMedia({}, facts(), { config: onlyDisabled, mediaDir, currentRate: () => 1 });
  assert.equal(skipped.source, 'picker');
});

test('resolveMedia: replay uses its original file when usable and re-resolves when gone', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([{ id: 'a1b2c3d4e5', enabled: true, conditions: {}, fileId: 'aaaaaaaaaa' }]);
  const original = resolveMedia({}, facts(), { config, mediaDir, currentRate: () => 1, replayFileId: 'bbbbbbbbbb' });
  assert.equal(original.source, 'replay');
  assert.equal(original.media.id, 'bbbbbbbbbb');

  fs.rmSync(path.join(mediaDir, 'rule.webm'));
  const gone = resolveMedia({}, facts(), { config, mediaDir, currentRate: () => 1, replayFileId: 'bbbbbbbbbb' });
  assert.equal(gone.source, 'rule', 'deleted original falls back to the rules');
  assert.equal(gone.media.id, 'aaaaaaaaaa');
});

test('resolveMedia: disabled/absent rules are picker-identical, and malformed rules never throw', t => {
  const mediaDir = tempMedia(t);
  const disabled = rulesConfig([{ id: 'a1b2c3d4e5', enabled: true, conditions: {}, fileId: 'bbbbbbbbbb' }], {
    alertRules: {
      v: 1,
      enabled: false,
      items: [{ id: 'a1b2c3d4e5', enabled: true, conditions: {}, fileId: 'bbbbbbbbbb' }]
    }
  });
  const off = resolveMedia({}, facts(), { config: disabled, mediaDir, currentRate: () => 1 });
  assert.equal(off.source, 'picker');
  assert.equal(off.media.id, 'aaaaaaaaaa', 'same file the picker would choose');

  const throwing = rulesConfig([]);
  throwing.alertRules = {
    v: 1,
    enabled: true,
    items: [
      {
        id: 'a1b2c3d4e5',
        enabled: true,
        get conditions() {
          throw new Error('boom');
        },
        fileId: 'bbbbbbbbbb'
      }
    ]
  };
  const safe = resolveMedia({}, facts(), { config: throwing, mediaDir, currentRate: () => 1 });
  assert.equal(safe.source, 'picker');
});

test('evaluateRules explains matches and failures', t => {
  const mediaDir = tempMedia(t);
  const config = rulesConfig([
    {
      id: 'a1b2c3d4e5',
      name: 'EUR big',
      enabled: true,
      conditions: { currency: 'EUR', minToman: 100 },
      fileId: 'bbbbbbbbbb'
    }
  ]);
  const out = evaluateRules({}, facts({ currency: 'USD' }), { config, mediaDir });
  assert.equal(out[0].matched, false);
  assert.deepEqual(out[0].reasons, ['currency']);
});

test('backups carry rules and availability flags a missing file', async t => {
  const dir = tempMedia(t);
  const store = new ConfigStore({ dataDir: dir, logger: () => {} });
  store.config.files = [
    { id: 'aaaaaaaaaa', file: 'tier.webm', name: 'Tier', type: 'video', size: 1, enabled: true, minToman: 0 }
  ];
  store.config.alertRules = {
    v: 1,
    enabled: true,
    items: [{ id: 'a1b2c3d4e5', name: 'r', conditions: {}, fileId: 'aaaaaaaaaa' }]
  };
  store.saveConfig();
  const backup = await exportBackup(dir, store);
  await importBackup(dir, backup, {
    configStore: store,
    logger: { info() {}, warn() {}, error() {} },
    sse: { broadcast() {}, sendState() {} }
  });
  assert.equal(store.config.alertRules.items.length, 1, 'rules survive a backup round-trip');
  assert.equal(availabilityFor(store.config, dir).aaaaaaaaaa, 'ok');
  fs.rmSync(path.join(dir, 'tier.webm'));
  assert.equal(availabilityFor(store.config, dir).aaaaaaaaaa, 'missing');
});

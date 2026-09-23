'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeRules } = require('../server/utils/sanitizers');
const { ConfigStore } = require('../server/config/store');

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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAnalytics, resolveRange } = require('../server/features/analytics');

test('custom analytics dates use the selected local day in Tehran', () => {
  const range = resolveRange('custom', {
    now: Date.parse('2026-09-25T12:00:00Z'),
    tz: 210,
    from: '2026-09-24',
    to: '2026-09-24'
  });
  assert.equal(new Date(range.start).toISOString(), '2026-09-23T20:30:00.000Z');
  assert.equal(new Date(range.end).toISOString(), '2026-09-24T20:30:00.000Z');
});

test('analytics excludes replay before deduplicating the original donation', () => {
  const at = Date.parse('2026-09-25T10:00:00Z');
  const result = computeAnalytics(
    [
      { id: 'tip-1', at, name: 'Ali', amount: 5, currency: 'EUR', toman: 150000, source: 'streamelements' },
      { id: 'tip-1', at: at + 1000, name: 'Ali', amount: 5, currency: 'EUR', toman: 150000, replay: true },
      { id: 'tip-2', at, name: 'Sara', amount: 10, currency: 'USD', toman: 900000, played: false }
    ],
    { now: at + 2000, tz: 210, range: 'today', rate: { value: 90000 } }
  );
  assert.equal(result.totals.count, 2);
  assert.equal(result.totals.amountToman, 1050000);
  assert.equal(result.excluded.test, 1);
  assert.equal(result.breakdown.bySource.find(item => item.key === 'streamelements').count, 1);
  assert.equal(result.breakdown.bySource.find(item => item.key === 'other').skipped, 1);
});

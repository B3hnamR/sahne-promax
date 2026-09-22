'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.textContent = '';
    this.className = '';
    this._innerHTML = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    if (!value) this.children = [];
  }
  get innerHTML() {
    return this._innerHTML;
  }
  appendChild(node) {
    if (!node) throw new TypeError("Failed to execute 'appendChild': parameter 1 is not of type 'Node'.");
    this.children.push(node);
    return node;
  }
}

test('history renders ordinary entries and shows foreign currency alongside toman', async () => {
  const source = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'js', 'history.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport\s+(?=(async\s+)?function\b)/g, '');
  const entries = [
    { id: 'usd', at: Date.now(), kind: 'tip', name: 'USD viewer', usd: 5, currency: 'USD', toman: 500000 },
    {
      id: 'eur',
      at: Date.now(),
      kind: 'tip',
      name: 'Euro viewer',
      usd: 10,
      currency: 'EUR',
      source: 'streamelements',
      toman: 1100000
    },
    { id: 'legacy', at: Date.now(), kind: 'tip', name: 'Legacy viewer', usd: 2, toman: 0 }
  ];
  const boxes = { '#hEntries': new Element('div'), '#hDays': new Element('div'), '#hTop': new Element('div') };
  const sandbox = {
    console,
    Date,
    Number,
    String,
    Math,
    Array,
    Promise,
    setTimeout,
    clearTimeout,
    window: { location: { port: '7788' } },
    document: { createElement: tag => new Element(tag) },
    $: selector => boxes[selector] || null,
    toast() {},
    copyText() {},
    faNum: value => String(value),
    fmtToman: value => `${value} تومان`,
    fetch: async url => ({
      json: async () => (url.startsWith('/api/history') ? { entries, days: [], today: {}, totals: {} } : { donors: [] })
    })
  };
  vm.runInNewContext(source + '\n;globalThis.refresh = refreshHistory;', sandbox, { filename: 'history.js' });

  await sandbox.refresh(false);
  const rendered = boxes['#hEntries'].children;
  assert.equal(rendered.length, 3);
  assert.match(rendered[0].children.map(child => child.textContent).join(' '), /USD viewer/);
  assert.match(rendered[1].children.map(child => child.textContent).join(' '), /EUR/);
  assert.match(rendered[1].children.map(child => child.textContent).join(' '), /1100000 تومان/);
  assert.match(rendered[1].children.map(child => child.textContent).join(' '), /StreamElements/);
  assert.match(rendered[2].children.map(child => child.textContent).join(' '), /\$2/);
});

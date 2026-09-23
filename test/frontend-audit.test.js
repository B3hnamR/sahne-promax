'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const withoutModules = source => source.replace(/^import .*;\s*$/gm, '').replace(/\bexport\s+/g, '');

test('confirmation Enter follows focused Cancel; Escape cancels; Confirm click approves', async () => {
  const listeners = new Map();
  const elements = new Map();
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (!elements.has(selector)) {
        const element = {
          classList: { add() {}, remove() {} },
          setAttribute() {},
          focus() {
            document.activeElement = element;
          }
        };
        elements.set(selector, element);
      }
      return elements.get(selector);
    }
  };
  const window = {
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    }
  };
  const context = vm.createContext({ document, window, setTimeout, clearTimeout });
  vm.runInContext(withoutModules(read('js/api.js')), context);

  const cancelled = vm.runInContext('spConfirm({ danger: true })', context);
  const cancelButton = elements.get('#confirmCancel');
  assert.equal(document.activeElement, cancelButton);
  listeners.get('keydown')({ key: 'Enter', target: cancelButton });
  cancelButton.onclick(); // Browser's native Enter activation on the focused button.
  assert.equal(await cancelled, false);

  const escaped = vm.runInContext('spConfirm({ danger: true })', context);
  listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(await escaped, false);

  const approved = vm.runInContext('spConfirm({ danger: true })', context);
  elements.get('#confirmOk').onclick();
  assert.equal(await approved, true);

  const opener = {
    focus() {
      document.activeElement = opener;
    }
  };
  document.activeElement = opener;
  const focused = vm.runInContext('spConfirm({ danger: true })', context);
  listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  await focused;
  assert.equal(document.activeElement, opener);
});

test('inspector saves snapshots for both files when selection changes during debounce', async () => {
  const elements = new Map();
  const calls = [];
  const state = { selectedId: 'first', cfg: { files: [{ id: 'first' }, { id: 'second' }] } };
  const $ = selector => {
    if (!elements.has(selector)) {
      const element = {
        value: '',
        checked: true,
        hidden: true,
        classList: { add() {}, remove() {} },
        addEventListener(name, handler) {
          this[name] = handler;
        }
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state,
    setTimeout,
    clearTimeout,
    fmtToman: value => String(value),
    patch: async (url, body) => {
      calls.push({ url, ...body });
      return { ok: true, file: body };
    },
    toast() {},
    spConfirm: async () => false
  });
  vm.runInContext(withoutModules(read('js/inspector.js')), context);
  vm.runInContext('initInspector({ onUpdate() {} })', context);
  $('#iName').value = 'First edit';
  $('#iName').input();
  state.selectedId = 'second';
  $('#iName').value = 'Second edit';
  $('#iName').input();
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.deepEqual(
    calls.map(call => [call.id, call.name]),
    [
      ['first', 'First edit'],
      ['second', 'Second edit']
    ]
  );
});

test('inspector saves a paused edit and keeps the file selected when deletion fails', async () => {
  const elements = new Map();
  const notices = [];
  const saved = [];
  const state = { selectedId: 'one', cfg: { files: [{ id: 'one', name: 'Media' }] } };
  const $ = selector => {
    if (!elements.has(selector)) {
      const element = {
        value: '',
        checked: true,
        addEventListener(name, handler) {
          this[name] = handler;
        },
        classList: { add() {}, remove() {} }
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state,
    setTimeout,
    clearTimeout,
    fmtToman: String,
    spConfirm: async () => true,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, deleted: false }) }),
    patch: async (_url, body) => {
      saved.push({ ...body });
      return { ok: true, file: body };
    },
    toast: (message, kind) => notices.push({ message, kind })
  });
  vm.runInContext(withoutModules(read('js/inspector.js')), context);
  vm.runInContext('initInspector({})', context);
  $('#iName').value = 'Pending edit';
  $('#iName').input();
  await $('#iDelete').onclick();
  assert.equal(state.selectedId, 'one');
  assert.deepEqual(
    saved.map(body => [body.id, body.name]),
    [['one', 'Pending edit']]
  );
  assert.equal(notices.at(-1).kind, 'err');
});

test('gold preset uses the latest upstream tip wording', () => {
  const source = read('js/look.js');
  const presets = source.slice(source.indexOf('  const PRESETS ='), source.indexOf("  $$('[data-preset]')"));
  const context = vm.createContext({});
  vm.runInContext(presets.replace('const PRESETS =', 'globalThis.PRESETS ='), context);
  assert.equal(context.PRESETS.gold.template, '{name} tipped {amount}');
});

test('browser controller About page uses the server version', () => {
  const source = read('js/app.js');
  const fillApp = source.slice(source.indexOf('function fillApp()'), source.indexOf('function renderState()'));
  const elements = new Map();
  const context = vm.createContext({
    state: { info: null, cfg: { port: 7788, app: {}, kickbot: {} }, version: '2.4.1' },
    DESK: false,
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    }
  });
  vm.runInContext(fillApp + 'fillApp()', context);
  assert.equal(elements.get('#appVer').value, '2.4.1');
  assert.equal(elements.get('#abVer').textContent, '2.4.1');
});

test('upload reports partial success and clears progress after request failures', async () => {
  const status = { textContent: '' };
  const notices = [];
  let loaded = 0;
  let request = 0;
  const source = read('js/files.js');
  const uploadFunction = source.slice(
    source.indexOf('async function uploadHttp('),
    source.indexOf('function initDragDrop(')
  );
  const context = vm.createContext({
    $: () => status,
    faNum: String,
    toast: (message, kind) => notices.push({ message, kind }),
    fetch: async () => {
      request++;
      if (request === 1) return { ok: true, json: async () => ({ ok: true }) };
      if (request === 2)
        return {
          ok: false,
          json: async () => {
            throw new Error('html');
          }
        };
      throw new Error('network down');
    }
  });
  vm.runInContext(uploadFunction, context);
  await vm.runInContext(
    'uploadHttp([{name:"one"},{name:"two"},{name:"three"}], () => globalThis.loaded())',
    Object.assign(context, { loaded: () => loaded++ })
  );
  assert.equal(loaded, 1);
  assert.equal(status.textContent, '');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'err');
  assert.match(notices[0].message, /1 فایل اضافه شد؛ 2 فایل ناموفق بود/);
  assert.match(notices[0].message, /\(\+1 مورد دیگر\)/);
});

test('upload with no successful files never announces success or refreshes the grid', async () => {
  const status = { textContent: '' };
  const notices = [];
  let loaded = 0;
  const source = read('js/files.js');
  const uploadFunction = source.slice(
    source.indexOf('async function uploadHttp('),
    source.indexOf('function initDragDrop(')
  );
  const context = vm.createContext({
    $: () => status,
    faNum: String,
    toast: (message, kind) => notices.push({ message, kind }),
    fetch: async () => {
      throw new Error('offline');
    }
  });
  vm.runInContext(uploadFunction, context);
  context.loaded = () => loaded++;
  await vm.runInContext('uploadHttp([{name:"one"}], () => loaded())', context);
  assert.equal(loaded, 0);
  assert.equal(status.textContent, '');
  assert.deepEqual(
    notices.map(notice => notice.kind),
    ['err']
  );
  assert.match(notices[0].message, /0 فایل اضافه شد؛ 1 فایل ناموفق بود/);
});

test('backup restore keeps credential reconnection guidance visible', async () => {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, textContent: '' });
    return elements.get(selector);
  };
  $('#restoreFileInput').files = [{ name: 'backup.zip' }];
  const context = vm.createContext({
    $,
    toast() {},
    spConfirm: async () => true,
    fetch: async () => ({
      json: async () => ({
        ok: true,
        restoredFiles: 2,
        reconnectRequired: { kickbot: true, streamelements: true }
      })
    }),
    window: { location: { href: '' } }
  });
  vm.runInContext(withoutModules(read('js/backup.js')), context);
  let completed = 0;
  context.completed = () => completed++;
  vm.runInContext('initBackup({ onRestoreComplete: completed })', context);
  await $('#restoreFileInput').onchange();
  assert.equal(completed, 1);
  assert.equal($('#restoreNotice').hidden, false);
  assert.match($('#restoreNotice').textContent, /KickBot/);
  assert.match($('#restoreNotice').textContent, /StreamElements/);

  context.spConfirm = async () => false;
  $('#restoreFileInput').files = [{ name: 'backup-2.zip' }];
  await $('#restoreFileInput').onchange();
  assert.equal($('#restoreNotice').hidden, false);
  assert.match($('#restoreNotice').textContent, /KickBot/);
});

test('template placeholders keep USD semantics and respect hidden amounts', () => {
  const source = read('overlay.js');
  const snippet = source.slice(source.indexOf('  const faDigits ='), source.indexOf('  function buildCard('));
  const A = {
    template: '{usd}|{original}|{toman}|{amount}',
    currency: 'usd',
    showAmount: true,
    amountStyle: 'plain',
    persianDigits: false
  };
  const context = vm.createContext({ A, location: { hostname: 'localhost', origin: 'http://localhost' }, URL });
  vm.runInContext(snippet, context);
  const render = tip => vm.runInContext(`headline(${JSON.stringify(tip)})`, context);
  const usd = render({ name: 'Donor', amount: 5, currency: 'USD', toman: 500000 });
  assert.match(usd, /^<span[^>]*>\$5<\/span>\|/);
  const eur = render({ name: 'Donor', amount: 5, currency: 'EUR', toman: 600000 });
  assert.match(eur, /^\|<span[^>]*>5 EUR<\/span>\|/);
  assert.doesNotMatch(eur, /\$5/);
  A.showAmount = false;
  assert.equal(render({ name: 'Donor', amount: 5, currency: 'EUR', toman: 600000 }), '|||');
  A.showAmount = true;
  A.persianDigits = true;
  A.template = '{original}';
  assert.match(render({ name: 'Donor', amount: 5, currency: 'EUR', toman: 600000 }), /۵ EUR/);
  A.persianDigits = false;
  assert.doesNotMatch(source, /usdEquivalent/);
});

test('live playing label uses the tip currency', () => {
  const source = read('js/app.js');
  const amountFunction = source.slice(
    source.indexOf('function originalAmount('),
    source.indexOf('function displayedAmount(')
  );
  const stateFunction = source.slice(source.indexOf('function renderState('), source.indexOf('function renderRate('));
  const playing = { innerHTML: '' };
  const context = vm.createContext({
    state: {
      cfg: null,
      runtimeState: { playing: { name: 'Euro tip', amount: 5, currency: 'EUR' }, recent: [] }
    },
    $: selector => (selector === '#sPlaying' ? playing : null),
    KB_TEXT: { unconfigured: ['', ''] },
    renderProxy() {},
    esc: value => String(value),
    faNum: String
  });
  vm.runInContext(amountFunction + stateFunction + 'renderState()', context);
  assert.match(playing.innerHTML, /5 EUR/);
  assert.doesNotMatch(playing.innerHTML, /\$5/);
});

function inspectorHarness(overrides = {}) {
  const elements = new Map();
  const state = { selectedId: 'one', cfg: { files: [{ id: 'one', name: 'Media' }] } };
  const $ = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: '',
        checked: true,
        hidden: true,
        classList: { add() {}, remove() {} },
        addEventListener(name, handler) {
          this[name] = handler;
        },
        pause() {}
      });
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state,
    setSelectedId(id) {
      state.selectedId = id;
    },
    setTimeout,
    clearTimeout,
    fmtToman: value => String(value),
    toast() {},
    spConfirm: async () => true,
    ...overrides
  });
  vm.runInContext(withoutModules(read('js/inspector.js')), context);
  vm.runInContext('initInspector({})', context);
  return { $, state, context };
}

test('inspector serializes saves per file and lets deletes wait', async () => {
  let releaseFirst;
  const first = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const patches = [];
  let deletes = 0;
  const { $ } = inspectorHarness({
    patch: async (url, body) => {
      patches.push(body);
      if (patches.length === 1) await first;
      return { ok: true, file: body };
    },
    fetch: async () => {
      deletes++;
      return { ok: true, json: async () => ({ ok: true, deleted: true }) };
    }
  });
  $('#iName').value = 'edit one';
  $('#iName').input();
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.equal(patches.length, 1);
  $('#iName').value = 'edit two';
  $('#iName').input();
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.equal(patches.length, 1, 'the second save waits for the first');
  const deletePromise = $('#iDelete').onclick();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(deletes, 0, 'the delete waits for the pending save');
  releaseFirst();
  await deletePromise;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(patches.length, 2);
  assert.equal(deletes, 1);
});

test('a failed save does not block later saves for the same file', async () => {
  let toasts = 0;
  const patches = [];
  const { $ } = inspectorHarness({
    patch: async (url, body) => {
      patches.push(body);
      throw new Error('down');
    },
    toast: () => {
      toasts++;
      if (toasts === 1) throw new Error('toast failed');
    }
  });
  $('#iName').value = 'first';
  $('#iName').input();
  await new Promise(resolve => setTimeout(resolve, 420));
  $('#iName').value = 'second';
  $('#iName').input();
  await new Promise(resolve => setTimeout(resolve, 420));
  assert.equal(patches.length, 2);
});

test('rules page builds a PUT payload from the rendered rows', () => {
  const source = read('js/rules.js');
  const snippet = source.slice(source.indexOf('const num ='), source.indexOf('export function initRules()'));
  const rows = [
    {
      dataset: { id: 'a1b2c3d4e5' },
      querySelectorAll: sel =>
        ({
          '.rule-provider': [
            { value: 'kickbot', checked: true },
            { value: 'streamelements', checked: true },
            { value: 'kick', checked: false }
          ],
          '.rule-kind': [{ value: 'sub', checked: true }]
        })[sel] || [],
      querySelector: sel =>
        ({
          '.rule-enabled': { checked: true },
          '.rule-name': { value: 'SE tips' },
          '.rule-currency': { value: 'EUR' },
          '.rule-min-toman': { value: '500000' },
          '.rule-max-toman': { value: '' },
          '.rule-message': { value: '' },
          '.rule-months': { value: '3' },
          '.rule-max-months': { value: '12' },
          '.rule-count': { value: '' },
          '.rule-max-count': { value: '' },
          '.rule-file': { value: 'aaaaaaaaaa' }
        })[sel]
    },
    {
      dataset: { id: 'b1b2c3d4e5' },
      querySelectorAll: sel =>
        ({
          '.rule-provider': [{ value: 'kick', checked: true }],
          '.rule-kind': [{ value: 'gift', checked: true }]
        })[sel] || [],
      querySelector: sel =>
        ({
          '.rule-enabled': { checked: true },
          '.rule-name': { value: 'Gifts' },
          '.rule-currency': { value: '' },
          '.rule-min-toman': { value: '' },
          '.rule-max-toman': { value: '' },
          '.rule-message': { value: '' },
          '.rule-months': { value: '' },
          '.rule-max-months': { value: '' },
          '.rule-count': { value: '2' },
          '.rule-max-count': { value: '5' },
          '.rule-file': { value: 'bbbbbbbbbb' }
        })[sel]
    }
  ];
  const context = vm.createContext({
    $$: sel => (sel === '.rule-row' ? rows : []),
    $: () => ({ checked: true })
  });
  vm.runInContext(withoutModules(snippet) + ';globalThis.out = collectRules();', context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.out)), {
    enabled: true,
    items: [
      {
        id: 'a1b2c3d4e5',
        name: 'SE tips',
        enabled: true,
        conditions: {
          providers: ['kickbot', 'streamelements'],
          kinds: ['sub'],
          currency: 'EUR',
          minToman: 500000,
          maxToman: null,
          messageContains: '',
          minMonths: 3,
          maxMonths: 12,
          minCount: null,
          maxCount: null
        },
        fileId: 'aaaaaaaaaa'
      },
      {
        id: 'b1b2c3d4e5',
        name: 'Gifts',
        enabled: true,
        conditions: {
          providers: ['kick'],
          kinds: ['gift'],
          currency: null,
          minToman: null,
          maxToman: null,
          messageContains: '',
          minMonths: null,
          maxMonths: null,
          minCount: 2,
          maxCount: 5
        },
        fileId: 'bbbbbbbbbb'
      }
    ]
  });
});

test('rules page keeps an unavailable file selected for repair', () => {
  const source = read('js/rules.js');
  const snippet = source.slice(source.indexOf('let availability'), source.indexOf('function renderRules()'));
  const context = vm.createContext({
    state: { cfg: { files: [] } },
    document: { createElement: () => ({ dataset: {}, innerHTML: '' }) },
    esc: value => String(value)
  });
  vm.runInContext(
    withoutModules(snippet) +
      ';globalThis.row = ruleRow({id:"1111111111",name:"Old",enabled:true,fileId:"aaaaaaaaaa",conditions:{providers:[],kinds:[],currency:null,minToman:null,maxToman:null,messageContains:"",minMonths:null,maxMonths:null,minCount:null,maxCount:null}});',
    context
  );
  assert.match(context.row.innerHTML, /value="aaaaaaaaaa" selected>فایل حذف‌شده/);
});

test('rules preview uses the latest successful simulation and clears stale matches', async () => {
  const elements = new Map();
  const requests = [];
  const responses = [
    { ok: true, match: { fileId: 'aaaaaaaaaa', fileName: 'Matched', source: 'rule' }, evaluations: [] },
    { ok: true, match: null, evaluations: [] }
  ];
  const $ = selector => {
    if (!elements.has(selector))
      elements.set(selector, {
        value: '',
        dataset: {},
        disabled: false,
        listeners: {},
        addEventListener(name, handler) {
          this.listeners[name] = handler;
        },
        appendChild() {},
        closest() {
          return null;
        }
      });
    return elements.get(selector);
  };
  $('#rtKind').value = 'tip';
  $('#rtProvider').value = 'streamelements';
  $('#rtCurrency').value = 'EUR';
  $('#rtAmount').value = '5';
  $('#rtName').value = 'Viewer';
  $('#rtMessage').value = 'hello';
  const context = vm.createContext({
    $,
    $$: () => [],
    state: { cfg: null },
    document: { createElement: () => ({ textContent: '', className: '' }) },
    post: async (path, body) => {
      requests.push({ path, body });
      return path === '/api/rules/test' ? responses.shift() : { ok: true };
    },
    put: async () => ({ ok: false }),
    toast() {},
    esc: value => String(value),
    fetch: async () => ({ json: async () => ({ availability: {} }) })
  });
  vm.runInContext(withoutModules(read('js/rules.js')), context);
  vm.runInContext('initRules()', context);
  await $('#btnRuleTest').onclick();
  assert.equal($('#btnRulePreview').disabled, false);
  $('#btnRulePreview').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].body)), {
    provider: 'streamelements',
    kind: 'tip',
    currency: 'EUR',
    amount: 5,
    name: 'Viewer',
    message: 'hello',
    months: null,
    count: null,
    fileId: 'aaaaaaaaaa'
  });
  await $('#btnRuleTest').onclick();
  assert.equal($('#btnRulePreview').disabled, true);
  assert.equal($('#btnRulePreview').dataset.fileId, undefined);
  $('#rtAmount').listeners.input();
  assert.equal($('#btnRulePreview').disabled, true);

  let releaseOld;
  responses.push(new Promise(resolve => (releaseOld = resolve)));
  responses.push({ ok: true, match: { fileId: 'bbbbbbbbbb', fileName: 'New', source: 'rule' }, evaluations: [] });
  const oldRequest = $('#btnRuleTest').onclick();
  await $('#btnRuleTest').onclick();
  releaseOld({ ok: true, match: { fileId: 'cccccccccc', fileName: 'Old', source: 'rule' }, evaluations: [] });
  await oldRequest;
  assert.equal($('#btnRulePreview').dataset.fileId, 'bbbbbbbbbb', 'late replies cannot restore an older result');
  $('#rtKind').value = 'gift';
  $('#rtKind').listeners.change();
  assert.equal($('#rtProvider').value, 'kick');
  assert.equal($('#rtCurrency').value, 'USD');
  $('#rtKind').value = 'tip';
  $('#rtKind').listeners.change();
  assert.equal($('#rtProvider').value, 'streamelements');
  assert.equal($('#rtCurrency').value, 'EUR');
});

test('rules page refuses to save before the first render', async () => {
  const elements = new Map();
  let puts = 0;
  const $ = sel => {
    if (!elements.has(sel))
      elements.set(sel, {
        value: '',
        checked: true,
        hidden: true,
        classList: { add() {}, remove() {} },
        addEventListener() {},
        dataset: {},
        appendChild() {},
        children: []
      });
    return elements.get(sel);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state: { cfg: null },
    document: { createElement: () => ({ classList: {}, dataset: {}, appendChild() {}, remove() {}, style: {} }) },
    fetch: async () => ({ json: async () => ({ availability: {} }) }),
    post: async () => ({ ok: true }),
    put: async () => {
      puts++;
      return { ok: true, rules: { enabled: false, items: [] } };
    },
    toast() {},
    esc: s => String(s),
    setTimeout,
    clearTimeout
  });
  vm.runInContext(withoutModules(read('js/rules.js')), context);
  vm.runInContext('initRules()', context);
  await elements.get('#btnSaveRules').onclick();
  assert.equal(puts, 0, 'no PUT before the rules are rendered');
});

test('rules page explains evaluation reasons in Persian', () => {
  const source = read('js/rules.js');
  const snippet = source.slice(source.indexOf('const REASON_LABELS'), source.indexOf('function collectRules()'));
  const context = vm.createContext({});
  vm.runInContext(
    withoutModules(snippet) +
      ';globalThis.label = reasonLabel(["amount-missing"]);globalThis.unknown = reasonLabel(["zzz"]);',
    context
  );
  assert.match(context.label, /نرخ تبدیل/);
  assert.equal(context.unknown, 'zzz');
});

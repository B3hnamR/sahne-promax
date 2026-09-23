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

test('inspector keeps a file selected when deletion fails', async () => {
  const elements = new Map();
  const notices = [];
  const state = { selectedId: 'one', cfg: { files: [{ id: 'one', name: 'Media' }] } };
  const $ = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, { addEventListener() {}, classList: { add() {}, remove() {} } });
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state,
    setTimeout,
    clearTimeout,
    spConfirm: async () => true,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, deleted: false }) }),
    toast: (message, kind) => notices.push({ message, kind })
  });
  vm.runInContext(withoutModules(read('js/inspector.js')), context);
  vm.runInContext('initInspector({})', context);
  await $('#iDelete').onclick();
  assert.equal(state.selectedId, 'one');
  assert.equal(notices.at(-1).kind, 'err');
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const noModules = source => source.replace(/^import\b[^;]*;\s*/gm, '').replace(/\bexport\s+/g, '');

async function meldUI(fetch) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector))
      elements.set(selector, {
        disabled: false,
        textContent: '',
        className: '',
        dataset: {},
        classList: { toggle() {}, remove() {} },
        addEventListener() {}
      });
    return elements.get(selector);
  };
  let ready;
  const context = vm.createContext({
    document: {
      querySelector: $,
      querySelectorAll: () => [],
      body: $('body'),
      addEventListener(name, callback) {
        if (name === 'DOMContentLoaded') ready = callback;
      }
    },
    window: { goPage() {} },
    localStorage: { getItem() {} },
    fetch,
    setTimeout: () => 1,
    clearTimeout() {},
    ...Object.fromEntries(
      [
        'initNav',
        'initInspector',
        'initFiles',
        'initLook',
        'initGoal',
        'initHistory',
        'initCommands',
        'initRules',
        'initControls',
        'initBackup',
        'initUpdates',
        'initCustomSelects',
        'fitPreview',
        'renderFiles'
      ].map(name => [name, () => {}])
    )
  });
  vm.runInContext(noModules(read('js/api.js')), context);
  vm.runInContext(noModules(read('js/app.js')), context);
  vm.runInContext('load = async () => {}; connectEvents = () => {}; loadSim = () => {};', context);
  await ready();
  return { $ };
}

test('both Meld actions POST once, disable together during reload, and show visible success', async () => {
  const calls = [];
  let resolve;
  const ui = await meldUI((url, options) => {
    calls.push({ url, options });
    return new Promise(done => {
      resolve = done;
    });
  });
  for (const selector of ['#hMeld', '#btnMeld']) {
    const count = calls.length;
    const pending = ui.$(selector).onclick();
    assert.equal(ui.$('#hMeld').disabled, true);
    assert.equal(ui.$('#btnMeld').disabled, true);
    await ui.$('#hMeld').onclick();
    await ui.$('#btnMeld').onclick();
    assert.equal(calls.length, count + 1, 'neither entry point can duplicate the in-flight request');
    assert.equal(calls.at(-1).url, '/api/meld-reload');
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), {});
    resolve({ ok: true, json: async () => ({ ok: true }) });
    await pending;
    assert.equal(ui.$('#hMeld').disabled, false);
    assert.equal(ui.$('#btnMeld').disabled, false);
    assert.match(ui.$('#toast').className, /show ok/);
    assert.equal(ui.$('#toast').textContent, 'لایه‌های Meld ری‌لود شدند');
  }
});

test('Meld failures stay visible and both entry points can retry after HTTP, JSON and network errors', async () => {
  const failures = [
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
    async () => ({ ok: false, json: async () => ({ ok: true }) }),
    async () => ({ ok: false, json: async () => ({ ok: false, error: 'Meld service unavailable' }) }),
    async () => ({ ok: true, json: async () => null }),
    async () => ({
      ok: false,
      json: async () => {
        throw new SyntaxError('invalid JSON');
      }
    }),
    async () => {
      throw new Error('offline');
    }
  ];
  for (const fail of failures) {
    for (const selector of ['#hMeld', '#btnMeld']) {
      let calls = 0;
      const ui = await meldUI(() => {
        calls++;
        return calls === 1 ? fail() : Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      });
      await ui.$(selector).onclick();
      assert.match(ui.$('#toast').className, /show err/);
      assert.match(ui.$('#toast').textContent, /Meld/);
      assert.doesNotMatch(ui.$('#toast').textContent, /تنظیمات/);
      assert.equal(ui.$('#hMeld').disabled, false);
      assert.equal(ui.$('#btnMeld').disabled, false);
      await ui.$(selector === '#hMeld' ? '#btnMeld' : '#hMeld').onclick();
      assert.equal(calls, 2);
      assert.match(ui.$('#toast').className, /show ok/);
      assert.equal(ui.$('#hMeld').disabled, false);
      assert.equal(ui.$('#btnMeld').disabled, false);
    }
  }
});

function updates({ desktop = true, initial = { status: 'idle' }, check, install, confirm = async () => true } = {}) {
  const elements = new Map(),
    notices = [],
    external = [];
  let push,
    installs = 0,
    checks = 0;
  const $ = id => {
    if (!elements.has(id))
      elements.set(id, {
        hidden: false,
        disabled: false,
        textContent: '',
        style: {},
        attributes: {},
        classList: { toggle() {}, remove() {}, add() {} },
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        focus() {
          this.focused = true;
        }
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    $,
    DESK: desktop,
    faNum: String,
    toast: (...args) => notices.push(args),
    spConfirm: confirm,
    window: {
      sahne: {
        app: { openExternal: async url => external.push(url) },
        update: {
          onStatus(fn) {
            push = fn;
          },
          get: async () => initial,
          check: async () => {
            checks++;
            return check ? check() : { status: 'uptodate', current: '2.7.0' };
          },
          install: async () => {
            installs++;
            return install ? install() : { status: 'ready', latest: '2.8.0', progress: 100 };
          }
        }
      }
    }
  });
  vm.runInContext(noModules(read('js/updates.js')), context);
  vm.runInContext('initUpdates()', context);
  return { $, notices, external, push: next => push(next), installs: () => installs, checks: () => checks };
}
const available = {
  status: 'available',
  latest: '2.8.0',
  current: '2.7.0',
  canInstall: true,
  page: 'https://example.test/release'
};

test('update stays discoverable after Later, with versioned sidebar and About actions', async () => {
  const ui = updates({ initial: available });
  await Promise.resolve();
  assert.equal(ui.$('#updBar').hidden, false);
  assert.match(ui.$('#updGo').textContent, /2\.8\.0/);
  await ui.$('#updLater').onclick();
  assert.equal(ui.$('#updBar').hidden, true);
  assert.equal(ui.$('#railUpd').hidden, false);
  assert.equal(ui.$('#abInstall').hidden, false);
  assert.match(ui.$('#railUpdSub').textContent, /2\.8\.0/);
  assert.equal(ui.$('#railUpd').focused, true);
  ui.push({ ...available, latest: '2.9.0' });
  assert.equal(ui.$('#updBar').hidden, false, 'a different version is not dismissed');
});

test('manual check has immediate feedback, prevents repeat checks and reveals actions', async () => {
  let resolve;
  const ui = updates({
    check: () =>
      new Promise(r => {
        resolve = r;
      })
  });
  await Promise.resolve();
  const pending = ui.$('#abCheckUpd').onclick();
  assert.equal(ui.$('#abCheckUpd').disabled, true);
  assert.match(ui.$('#abCheckText').textContent, /بررسی/);
  await ui.$('#abCheckUpd').onclick();
  assert.equal(ui.checks(), 1);
  resolve(available);
  await pending;
  assert.equal(ui.$('#abInstall').hidden, false);
  assert.equal(ui.$('#abCheckUpd').disabled, false);
});

test('download/install/ready states disable duplicate actions and clamp progress', async () => {
  let resolve;
  const ui = updates({
    initial: available,
    install: () =>
      new Promise(r => {
        resolve = r;
      })
  });
  await Promise.resolve();
  const pending = ui.$('#abInstall').onclick();
  await Promise.resolve();
  await ui.$('#railUpd').onclick();
  assert.equal(ui.installs(), 1);
  assert.equal(ui.$('#abInstall').disabled, true);
  ui.push({ ...available, status: 'downloading', progress: 250 });
  assert.equal(ui.$('#railUpdProg').style.width, '100%');
  assert.equal(ui.$('#updGo').disabled, true);
  assert.equal(ui.$('#updLater').hidden, true);
  resolve({ ...available, status: 'ready', progress: 100 });
  await pending;
  assert.equal(ui.$('#railUpd').disabled, true);
  assert.match(ui.$('#abUpd').textContent, /تست/);
  ui.push({ ...available, status: 'installing' });
  assert.equal(ui.$('#abCheckUpd').disabled, true);
});

test('unsupported installs open release without confirmation or invoking install IPC', async () => {
  const ui = updates({
    initial: { ...available, canInstall: false },
    confirm: async () => {
      throw Error('unexpected confirmation');
    }
  });
  await Promise.resolve();
  await ui.$('#railUpd').onclick();
  assert.deepEqual(ui.external, [available.page]);
  assert.equal(ui.installs(), 0);
  assert.match(ui.$('#abInstallText').textContent, /GitHub/);
});

test('failed update IPC preserves a known release and restores actionable buttons', async () => {
  const ui = updates({
    initial: available,
    check: async () => {
      throw Error('offline');
    },
    install: async () => {
      throw Error('IPC unavailable');
    }
  });
  await Promise.resolve();
  await ui.$('#abCheckUpd').onclick();
  assert.equal(ui.$('#abInstall').hidden, false);
  assert.equal(ui.$('#abCheckUpd').disabled, false);
  await ui.$('#abInstall').onclick();
  assert.equal(ui.$('#updGo').disabled, false);
  assert.match(ui.$('#updText').textContent, /IPC unavailable/);
  assert.equal(ui.notices.length, 2);
});

test('web mode hides update actions and disables desktop check', () => {
  const ui = updates({ desktop: false });
  assert.equal(ui.$('#updBar').hidden, true);
  assert.equal(ui.$('#railUpd').hidden, true);
  assert.equal(ui.$('#abInstall').hidden, true);
  assert.equal(ui.$('#abCheckUpd').disabled, true);
});

test('Mint UI preserves custom pages and Donofa listener fields, with opt-in bridge and accessibility', () => {
  const html = read('app.html'),
    css = read('app.css'),
    app = read('js/app.js');
  for (const page of ['home', 'files', 'look', 'goal', 'history', 'analytics', 'settings', 'rules', 'logs', 'about']) {
    assert.match(html, new RegExp('<section[^>]+data-page="' + page + '"'));
  }
  for (const id of [
    'donofaKey',
    'donofaEndpoint',
    'donofaMsg',
    'donofaChip',
    'dfTimerOn',
    'dfGoalOn',
    'btnDfRefresh'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /Sahne ProMax/);
  assert.match(html, /type="module" src="\/js\/app.js"/);
  assert.doesNotMatch(html, /src="\/app.js"/);
  assert.match(css, /--canvas: #d8f1d6/);
  assert.match(css, /--latin: 'Vazirmatn'/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
  assert.match(html, /id="abUpd" role="status" aria-live="polite"/);
  assert.match(app, /runtimeState\.donofaBridge/);
  assert.match(app, /cfg\[key\] === true/);
});

test('navigation exposes current page and restores home for an obsolete saved tab', () => {
  const buttons = ['home', 'goal', 'rules'].map(page => ({
    dataset: { page },
    classList: { toggle() {} },
    setAttribute(k, v) {
      this[k] = v;
    },
    removeAttribute(k) {
      delete this[k];
    }
  }));
  const pages = buttons.map(b => ({ dataset: b.dataset, classList: { toggle() {} } }));
  const capsule = { style: {} },
    exit = {};
  const context = vm.createContext({
    DESK: false,
    window: { addEventListener() {} },
    localStorage: { setItem() {} },
    $: selector =>
      selector === '#capsule'
        ? capsule
        : selector === '#btnExit'
          ? exit
          : buttons.find(b => selector.includes('"' + b.dataset.page + '"')),
    $$: selector => (selector === '.nav button' ? buttons : pages)
  });
  vm.runInContext(noModules(read('js/nav.js')), context);
  vm.runInContext('initNav({ onPageChange() {} }); window.goPage("rules")', context);
  assert.equal(buttons[2]['aria-current'], 'page');
  vm.runInContext('window.goPage("removed-page")', context);
  assert.equal(buttons[0]['aria-current'], 'page');
  assert.equal(buttons[2]['aria-current'], undefined);
});

test('Donofa bridge summary stays separate from listener state and renders remote text safely', () => {
  const source = read('js/app.js');
  const render = source.slice(source.indexOf('function renderDonofaBridge()'), source.indexOf('function fillApp()'));
  const elements = new Map();
  const element = () => ({
    textContent: '',
    hidden: false,
    dataset: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    }
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const state = {
    cfg: { donofa: { configured: true, timer: false, goal: false } },
    runtimeState: {
      donofa: { status: 'connected' },
      donofaBridge: {
        status: 'connected',
        goal: { title: '<img src=x onerror=alert(1)>', unit: 'TOMAN', progress: 10, total: 20, subKick: true },
        timer: { status: 'running', remaining: 4000, rate: { amount: 100, seconds: 10 } },
        queue: 2,
        recent: [{ kind: 'sub', name: '<script>bad</script>', seconds: 30, goal: 5 }]
      }
    }
  };
  const context = vm.createContext({
    $,
    state,
    faNum: String,
    SE_TEXT: { unconfigured: ['missing', 'chip'], connected: ['connected', 'chip ok'] },
    document: { createElement: element }
  });
  vm.runInContext(render + '\nrenderDonofaBridge()', context);
  assert.equal($('#dfBridgeChip').textContent, 'خاموش');
  assert.equal($('#dfTimerOn').checked, false);
  assert.equal($('#dfGoalOn').checked, false);
  assert.equal($('#btnDfRefresh').disabled, true);
  state.cfg.donofa.goal = true;
  vm.runInContext('renderDonofaBridge()', context);
  assert.equal($('#dfBridgeChip').textContent, 'connected');
  assert.match($('#dfGoal').textContent, /<img src=x/);
  assert.equal($('#dfGoal').children.length, 0, 'remote goal title is text, never markup');
  assert.match($('#dfRecent').children.at(-1).children[0].textContent, /<script>bad/);
  assert.equal($('#dfNote').hidden, false, 'duplicate Kick subscription warning stays visible');
  assert.equal($('#dfQueue').textContent, '2');
});

test('failed local goal saves/reset show failure without filling over the draft', async () => {
  const elements = new Map(),
    notices = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    $,
    settingsRequest: async () => ({ ok: false, error: 'save failed' }),
    toast: (...args) => notices.push(args),
    spConfirm: async () => true,
    window: { location: { port: '7788' } }
  });
  vm.runInContext(noModules(read('js/goal.js')), context);
  vm.runInContext('initGoal()', context);
  $('#gTitle').value = 'Unsaved draft';
  await $('#btnSaveGoal').onclick();
  await $('#btnResetGoal').onclick();
  assert.equal($('#gTitle').value, 'Unsaved draft');
  assert.deepEqual(notices, [
    ['save failed', 'err'],
    ['save failed', 'err']
  ]);
});

test('appearance presets update native selects and custom dropdowns when copied wrappers precede them', async () => {
  const keys = ['font', 'currency', 'amountStyle'];
  const controls = keys.map(key => ({
    tagName: 'SELECT',
    type: 'select-one',
    dataset: { a: key },
    value: 'old',
    label: 'old',
    addEventListener() {},
    _spSync() {
      this.label = this.value;
    }
  }));
  const wrappers = keys.map(key => ({ tagName: 'DIV', dataset: { a: key }, addEventListener() {} }));
  const nodes = wrappers.flatMap((wrap, i) => [wrap, controls[i]]);
  const preset = { dataset: { preset: 'gold' } };
  const elements = { '#btnPreview': {}, '#lblSize': {} };
  let save, saved;
  const state = { cfg: { appearance: {} } };
  const context = vm.createContext({
    state,
    $: selector => elements[selector],
    $$: selector => (selector === '[data-a]' ? nodes : selector === '[data-preset]' ? [preset] : []),
    document: {
      querySelector(selector) {
        const key = selector.match(/data-a="([^"]+)"/)[1];
        return nodes.find(
          node => node.dataset.a === key && (!selector.startsWith('input') || node.tagName === 'SELECT')
        );
      }
    },
    window: { addEventListener() {} },
    clearTimeout() {},
    setTimeout(callback) {
      save = callback;
    },
    saveSettings: async body => {
      saved = structuredClone(body);
      return true;
    },
    toast() {}
  });
  vm.runInContext(noModules(read('js/look.js')), context);
  vm.runInContext('initLook()', context);
  preset.onclick();
  await save();
  for (const [i, value] of ['Segoe UI', 'eq-en', 'inherit'].entries()) {
    assert.equal(controls[i].value, value);
    assert.equal(controls[i].label, value, 'the visible dropdown is explicitly synchronized');
    assert.equal(saved.appearance[keys[i]], value);
    assert.equal(wrappers[i].value, undefined, 'the copied data-a wrapper is not treated as an input');
  }
  const checkbox = { type: 'checkbox', checked: true };
  context.document.querySelector = () => checkbox;
  vm.runInContext('setA("showGlow", false)', context);
  assert.equal(checkbox.checked, false);
  assert.equal(elements['#lblSize'].textContent, 40);
});

function fileEventsUI(fetch) {
  const elements = new Map(),
    sources = [],
    timers = [];
  const element = () => ({
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    children: [],
    classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null,
    appendChild(child) {
      this.children.push(child);
    }
  });
  const $ = selector => {
    if (selector === '#insThumb video') return null;
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const segments = ['all', 'video', 'image', 'audio', 'off'].map(type => {
    const count = element();
    return { dataset: { f: type }, querySelector: () => count };
  });
  const context = vm.createContext({
    document: {
      querySelector: $,
      querySelectorAll: selector => (selector === '#fSeg button' ? segments : []),
      createElement: element,
      addEventListener() {}
    },
    window: {},
    fetch,
    EventSource: class {
      constructor(url) {
        this.url = url;
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    }
  });
  for (const file of ['state', 'api', 'inspector', 'files', 'app']) {
    vm.runInContext(noModules(read('js/' + file + '.js')), context);
  }
  const state = vm.runInContext('state', context);
  state.cfg = {
    appearance: { font: 'Unsaved font' },
    mode: 'draft-mode',
    files: [{ id: 'selected', name: 'Original', file: 'original.png', type: 'image', enabled: true }]
  };
  state.runtimeState = { marker: 'runtime draft' };
  vm.runInContext('selectFile("selected", {}); connectEvents()', context);
  $('#iName').value = 'Unsaved inspector name';
  return {
    $,
    state,
    sources,
    segments,
    timers,
    send: () => sources.at(-1).onmessage({ data: JSON.stringify({ type: 'files_updated' }) }),
    pending: () => vm.runInContext('filesRefresh', context)
  };
}

test('files_updated refreshes files and counters only, preserving settings and the selected inspector draft', async () => {
  const calls = [];
  let respond;
  const ui = fileEventsUI(url => {
    calls.push(url);
    return new Promise(resolve => {
      respond = result => resolve({ json: async () => result });
    });
  });
  const cfg = ui.state.cfg,
    appearance = cfg.appearance,
    runtime = ui.state.runtimeState;
  ui.sources[0].onopen();
  assert.equal(calls.length, 0, 'initial load already fetched the file list');
  ui.send();
  const files = [
    { id: 'selected', name: 'Remote rename', file: 'original.png', type: 'image', enabled: false },
    { id: 'new-audio', name: 'Imported audio', file: 'new.mp3', type: 'audio' }
  ];
  respond({ config: { files, appearance: { font: 'server font' }, mode: 'server mode' }, state: {} });
  await ui.pending();
  assert.deepEqual(calls, ['/api/config']);
  assert.equal(ui.state.cfg, cfg);
  assert.equal(cfg.appearance, appearance);
  assert.equal(cfg.mode, 'draft-mode');
  assert.equal(ui.state.runtimeState, runtime);
  assert.equal(cfg.files, files);
  assert.equal(ui.state.selectedId, 'selected');
  assert.equal(ui.$('#iName').value, 'Unsaved inspector name');
  assert.equal(ui.$('#iEnabled').checked, true, 'server metadata does not fill over current inspector fields');
  assert.equal(ui.$('#inspector').hidden, false);
  assert.equal(ui.$('#navFiles').textContent, (2).toLocaleString('fa-IR'));
  assert.deepEqual(
    ui.segments.map(segment => segment.querySelector().textContent),
    [2, 0, 1, 1, 1].map(n => n.toLocaleString('fa-IR'))
  );
  const selectedCard = ui
    .$('#files')
    .children.slice(-2)
    .find(card => card.dataset.id === 'selected');
  assert.match(selectedCard.innerHTML, /Remote rename/);
  assert.match(selectedCard.className, /selected/);

  ui.send();
  respond({ config: { files: [files[1]] } });
  await ui.pending();
  assert.equal(ui.state.selectedId, null, 'remote deletion clears a now-invalid selection');
  assert.equal(ui.$('#inspector').hidden, true);
  assert.equal(ui.$('#iName').value, 'Unsaved inspector name', 'closing does not overwrite inspector fields');
});

test('file events coalesce in-flight requests and never apply snapshots superseded by newer events', async () => {
  const requests = [];
  const ui = fileEventsUI(
    () =>
      new Promise((resolve, reject) =>
        requests.push({
          resolve: files => resolve({ json: async () => ({ config: { files } }) }),
          reject
        })
      )
  );
  const original = ui.state.cfg.files;
  ui.send();
  const pending = ui.pending();
  ui.send();
  ui.send();
  assert.equal(requests.length, 1, 'only one fetch is active despite an event burst');
  assert.equal(ui.pending(), pending);
  requests[0].resolve([]);
  await new Promise(setImmediate);
  assert.equal(requests.length, 2, 'the burst requires just one follow-up snapshot');
  assert.equal(ui.state.cfg.files, original, 'a stale deletion snapshot is never applied');
  assert.equal(ui.state.selectedId, 'selected');
  ui.send();
  requests[1].reject(new Error('offline'));
  await new Promise(setImmediate);
  assert.equal(requests.length, 3, 'events arriving during a failed fetch still receive a fresh request');
  requests[2].resolve(original);
  await pending;
  assert.equal(ui.state.cfg.files, original);
  assert.equal(ui.$('#iName').value, 'Unsaved inspector name');
  assert.equal(ui.pending(), null);
});

test('file refresh failures release the flight, and SSE reopen catches disconnected file events without polling', async () => {
  const responses = [
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ json: async () => ({ error: 'unavailable' }) }),
    () => Promise.resolve({ json: async () => ({ config: { files: [] } }) })
  ];
  let calls = 0;
  const ui = fileEventsUI(() => responses[calls++]());
  const original = ui.state.cfg.files;
  for (let i = 0; i < 2; i++) {
    ui.send();
    await ui.pending();
    assert.equal(ui.pending(), null);
    assert.equal(ui.state.cfg.files, original);
    assert.equal(ui.state.selectedId, 'selected');
  }
  ui.sources[0].onerror();
  assert.equal(ui.sources[0].closed, true);
  assert.equal(ui.timers.length, 1);
  assert.equal(ui.timers[0].delay, 3000);
  ui.timers[0].callback();
  assert.equal(calls, 2, 'reconnect waits until the EventSource actually opens');
  assert.equal(ui.sources[1].url, '/events?role=admin');
  ui.sources[1].onopen();
  await ui.pending();
  assert.equal(calls, 3);
  assert.equal(ui.state.cfg.files.length, 0);
  assert.equal(ui.state.selectedId, null);
  assert.equal(ui.timers.length, 1, 'no file polling timer is installed');
});

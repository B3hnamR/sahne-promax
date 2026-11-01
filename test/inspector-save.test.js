'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function inspectorHarness() {
  const elements = new Map();
  const timers = new Map();
  const requests = [];
  const notices = [];
  let timerId = 0;
  let updates = 0;
  const state = {
    selectedId: null,
    cfg: {
      files: ['one', 'two'].map(id => ({ id, name: id, file: `${id}.png`, type: 'image', size: 1 }))
    }
  };
  const $ = selector => {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: '',
        checked: true,
        hidden: true,
        validity: { badInput: false },
        classList: {
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          contains: name => classes.has(name)
        },
        addEventListener(name, handler) {
          this[name] = handler;
        },
        setAttribute() {},
        setCustomValidity() {}
      });
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    state,
    setSelectedId: id => (state.selectedId = id),
    fmtToman: String,
    fmtSize: String,
    esc: String,
    setTimeout(fn, delay) {
      timers.set(++timerId, { fn, delay });
      return timerId;
    },
    clearTimeout: id => timers.delete(id),
    patch: (url, body) => new Promise((resolve, reject) => requests.push({ url, body, resolve, reject })),
    toast: (...args) => notices.push(args),
    spConfirm: async () => false,
    onUpdate: () => updates++
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'inspector.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\s*$/gm, '').replace(/\bexport\s+/g, ''), context);
  vm.runInContext('initInspector({ onUpdate })', context);
  const select = id => vm.runInContext(`selectFile(${JSON.stringify(id)}, {})`, context);
  const edit = (value, selector = '#iName') => {
    $(selector).value = value;
    $(selector).input();
  };
  const flush = async () => {
    // Drain the save chain and its cleanup without real debounce delays.
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const debounce = async () => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== 350) continue;
      timers.delete(id);
      timer.fn();
    }
    await flush();
  };
  const succeed = async (index, file = requests[index].body) => {
    requests[index].resolve({ ok: true, file });
    await flush();
  };
  select('one');
  return { $, state, requests, notices, select, edit, flush, debounce, succeed, updates: () => updates };
}

test('a deferred save cannot mark a newer visible draft Saved or discard it', async () => {
  const h = inspectorHarness();
  h.edit('draft A');
  await h.debounce();
  h.edit('draft B');
  await h.succeed(0);
  assert.equal(h.$('#insSaved').classList.contains('show'), false);
  assert.equal(h.$('#iName').value, 'draft B');
  h.select('two');
  h.select('one');
  assert.equal(h.$('#iName').value, 'draft B', 'the newer draft survives reselection');
  await h.debounce();
  await h.succeed(1);
  assert.equal(h.$('#insSaved').classList.contains('show'), true);
  assert.equal(h.state.cfg.files[0].name, 'draft B');
});

test('save feedback requires exact visible values and the current edit revision', async () => {
  const h = inspectorHarness();
  h.edit('draft A');
  await h.debounce();
  h.$('#iVol').value = '42'; // Visible changes must also be checked independently of input events.
  await h.succeed(0);
  assert.equal(h.$('#insSaved').classList.contains('show'), false);

  h.edit('draft A');
  await h.debounce();
  h.edit('draft B');
  h.edit('draft A');
  await h.succeed(1);
  assert.equal(h.$('#insSaved').classList.contains('show'), false, 'returning to A is still a newer edit');
});

test('invalid range edits invalidate in-flight save feedback', async () => {
  const h = inspectorHarness();
  h.edit('draft A');
  await h.debounce();
  h.$('#iMin').validity.badInput = true;
  h.edit('', '#iMin');
  await h.succeed(0);
  assert.equal(h.$('#insSaved').classList.contains('show'), false);
  await h.debounce();
  assert.equal(h.requests.length, 1, 'invalid edits do not schedule a save');
});

for (const failure of ['response', 'network']) {
  test(`stale ${failure} failures do not report an error for a newer draft`, async () => {
    const h = inspectorHarness();
    h.edit('draft A');
    await h.debounce();
    h.edit('draft B');
    if (failure === 'response') h.requests[0].resolve({ ok: false, error: 'old failure' });
    else h.requests[0].reject(new Error('offline'));
    await h.flush();
    assert.equal(h.notices.length, 0);
    await h.debounce();
    h.requests[1].resolve({ ok: false, error: 'current failure' });
    await h.flush();
    assert.equal(h.notices.length, 1, 'current failures still report an error');
    assert.equal(h.notices[0][1], 'err');
  });
}

test('selection switches isolate save feedback and preserve per-file drafts', async () => {
  const h = inspectorHarness();
  h.edit('one saved');
  await h.debounce();
  h.select('two');
  h.edit('two draft');
  await h.succeed(0);
  assert.equal(h.state.selectedId, 'two');
  assert.equal(h.$('#iName').value, 'two draft');
  assert.equal(h.$('#insSaved').classList.contains('show'), false);
  await h.debounce();
  await h.succeed(1);
  assert.equal(h.$('#insSaved').classList.contains('show'), true);
  h.select('one');
  assert.equal(h.$('#insSaved').classList.contains('show'), false, 'another file cannot inherit Saved');
  assert.equal(h.$('#iName').value, 'one saved');

  h.edit('one pending');
  await h.debounce();
  h.select('two');
  h.requests[2].reject(new Error('offline'));
  await h.flush();
  assert.equal(h.notices.length, 0, 'an old selection cannot display failure feedback');
});

test('serialized saves cannot apply older metadata after a newer success', async () => {
  const h = inspectorHarness();
  h.edit('draft A');
  await h.debounce();
  h.edit('draft B');
  await h.debounce();
  assert.equal(h.requests.length, 1, 'the newer PATCH waits for the old response');
  await h.succeed(0, { ...h.requests[0].body, size: 10 });
  assert.equal(h.requests.length, 2);
  assert.equal(h.$('#insSaved').classList.contains('show'), false);
  await h.succeed(1, { ...h.requests[1].body, size: 20 });
  assert.equal(h.state.cfg.files[0].name, 'draft B');
  assert.equal(h.state.cfg.files[0].size, 20);
  assert.equal(h.updates(), 2);
  assert.equal(h.$('#insSaved').classList.contains('show'), true);
});

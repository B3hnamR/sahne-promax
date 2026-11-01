'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const withoutModules = source => source.replace(/\bexport\s+/g, '');

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.document = document;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.tabIndex = tag === 'button' || tag === 'select' ? 0 : -1;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) classes.add(name);
        else classes.delete(name);
        this.className = [...classes].join(' ');
      }
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    child.parentNode = this;
    this.children.splice(this.children.indexOf(before), 0, child);
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners[event.type] || []) listener(event);
    this['on' + event.type]?.(event);
  }
  click() {
    this.dispatchEvent({ type: 'click', stopPropagation() {} });
  }
  focus() {
    this.document.activeElement = this;
  }
  contains(node) {
    return node === this || this.children.some(child => child.contains(node));
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector
        .split('.')
        .filter(Boolean)
        .every(name => child.classList.contains(name))
        ? [child]
        : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  getBoundingClientRect() {
    return { top: 10, bottom: 40 };
  }
  scrollIntoView() {}
}

function confirmationHarness() {
  const listeners = new Map();
  const document = { activeElement: null };
  const modal = new Element('dialog', document);
  modal.hidden = true;
  modal.showModal = () => {
    modal.open = true;
    modal.modalCalls = (modal.modalCalls || 0) + 1;
  };
  modal.close = () => {
    modal.open = false;
  };
  const elements = new Map([['#confirmModal', modal]]);
  for (const id of ['confirmTitle', 'confirmBody', 'confirmOk', 'confirmCancel', 'confirmIcon', 'confirmIcon use']) {
    const element = new Element(id === 'confirmOk' || id === 'confirmCancel' ? 'button' : 'div', document);
    elements.set('#' + id, element);
    modal.appendChild(element);
  }
  document.querySelector = selector => elements.get(selector) || null;
  const window = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)
  };
  const context = vm.createContext({ document, window, setTimeout, clearTimeout });
  vm.runInContext(withoutModules(read('js/api.js')), context);
  function key(key, shiftKey = false) {
    const event = {
      key,
      shiftKey,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    listeners.get('keydown')?.(event);
    return event;
  }
  return { context, document, modal, elements, listeners, key };
}

test('closed confirmation is a hidden native dialog with no rendered tab stops', async () => {
  const markup = read('app.html').match(/<dialog\b[^>]*id="confirmModal"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(markup, 'confirmation uses a native dialog for browser-enforced background inertness');
  assert.match(markup, /\bhidden\b/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="confirmTitle"/);
  assert.match(markup, /aria-describedby="confirmBody"/);
  assert.match(read('app.css'), /\.modal-backdrop\[hidden\],\s*\.modal-backdrop:not\(\[open\]\)\s*\{\s*display: none;/);

  const { context, modal, elements, listeners } = confirmationHarness();
  const pending = vm.runInContext('spConfirm()', context);
  assert.equal(modal.open, true);
  assert.equal(modal.hidden, false);
  assert.equal(modal.modalCalls, 1, 'showModal, not show, activates native focus/background isolation');
  elements.get('#confirmCancel').click();
  assert.equal(await pending, false);
  assert.equal(modal.open, false);
  assert.equal(modal.hidden, true);
  assert.equal(listeners.has('keydown'), false);
});

test('confirmation focuses Cancel, traps both Tab boundaries, and restores opener after Escape', async () => {
  const { context, document, modal, elements, key } = confirmationHarness();
  const opener = new Element('button', document);
  opener.focus();
  const pending = vm.runInContext('spConfirm()', context);
  const cancel = elements.get('#confirmCancel');
  const confirm = elements.get('#confirmOk');
  assert.equal(document.activeElement, cancel);
  assert.equal(key('Tab', true).defaultPrevented, true);
  assert.equal(document.activeElement, confirm);
  assert.equal(key('Tab').defaultPrevented, true);
  assert.equal(document.activeElement, cancel);
  assert.equal(key('Tab').defaultPrevented, undefined, 'interior tabbing retains native behavior');
  assert.equal(key('Enter').defaultPrevented, undefined, 'focused button retains native activation');
  assert.equal(key('Escape').defaultPrevented, true);
  assert.equal(await pending, false);
  assert.equal(modal.hidden, true);
  assert.equal(document.activeElement, opener);
});

test('native cancel resolves false and concurrent confirmations remain serial without orphaned promises', async () => {
  const { context, document, modal, elements } = confirmationHarness();
  const opener = new Element('button', document);
  opener.focus();
  const first = vm.runInContext('spConfirm({title: "First"})', context);
  const second = vm.runInContext('spConfirm({title: "Second"})', context);
  const third = vm.runInContext('spConfirm({title: "Third"})', context);
  assert.equal(elements.get('#confirmTitle').textContent, 'First');
  modal.oncancel({ preventDefault() {} });
  assert.equal(await first, false);
  assert.equal(elements.get('#confirmTitle').textContent, 'Second');
  elements.get('#confirmOk').click();
  assert.equal(await second, true);
  await Promise.resolve();
  assert.equal(elements.get('#confirmTitle').textContent, 'Third');
  elements.get('#confirmCancel').click();
  assert.equal(await third, false);
  assert.equal(modal.hidden, true);
  assert.equal(document.activeElement, opener);
});

function dropdownHarness() {
  const listeners = {};
  const document = {
    activeElement: null,
    addEventListener(type, listener) {
      (listeners[type] ||= []).push(listener);
    },
    createElement: tag => new Element(tag, document)
  };
  class Select extends Element {
    constructor() {
      super('select', document);
      this.options = [
        { value: 'one', textContent: 'One' },
        { value: 'two', textContent: 'Two' }
      ];
      this._value = 'one';
      const parent = new Element('div', document);
      parent.appendChild(this);
    }
    get value() {
      return this._value;
    }
    set value(value) {
      this._value = value;
    }
    get selectedOptions() {
      return this.options.filter(option => option.value === this.value);
    }
  }
  const context = vm.createContext({
    document,
    window: { innerHeight: 1000 },
    HTMLSelectElement: Select,
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    }
  });
  vm.runInContext(withoutModules(read('js/dropdown.js')), context);
  const select = new Select();
  context.select = select;
  const wrap = vm.runInContext('setupCustomSelect(select)', context);
  return { context, document, select, wrap, listeners, Select };
}

test('enhanced dropdown exposes only the custom trigger in the tab order and syncs native input/change', () => {
  const { select, wrap, Select } = dropdownHarness();
  const trigger = wrap.querySelector('.sp-select-trigger');
  const label = wrap.querySelector('.sp-select-label');
  assert.equal(select.tabIndex, -1);
  assert.equal(trigger.tabIndex, 0);
  assert.equal(typeof select._spSync, 'function');
  assert.equal(label.textContent, 'One');

  // Browser/user selection updates internal value without calling our instance setter.
  const nativeValue = Object.getOwnPropertyDescriptor(Select.prototype, 'value');
  nativeValue.set.call(select, 'two');
  select.dispatchEvent({ type: 'input' });
  assert.equal(label.textContent, 'Two');
  assert.equal(wrap.querySelector('.sp-select-option.selected').dataset.value, 'two');
  nativeValue.set.call(select, 'one');
  select.dispatchEvent({ type: 'change' });
  assert.equal(label.textContent, 'One');
  select.value = 'two';
  assert.equal(label.textContent, 'Two', 'programmatic setter remains synchronized');
});

test('custom dropdown retains Arrow, Enter/Space, and Escape keyboard behavior without duplicate change events', () => {
  const { document, select, wrap, listeners } = dropdownHarness();
  const trigger = wrap.querySelector('.sp-select-trigger');
  const events = [];
  select.addEventListener('input', event => events.push(event.type));
  select.addEventListener('change', event => events.push(event.type));
  trigger.focus();
  const key = key => trigger.dispatchEvent({ type: 'keydown', key, preventDefault() {} });
  key('ArrowDown');
  assert.equal(wrap.classList.contains('open'), true);
  key('ArrowDown');
  assert.equal(select.value, 'two');
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(events, ['input', 'change']);
  key(' ');
  assert.equal(trigger.attributes['aria-expanded'], 'true');
  key('Enter');
  assert.equal(wrap.classList.contains('open'), false);
  assert.deepEqual(events, ['input', 'change'], 'activating selected option emits no duplicate change');
  key('ArrowUp');
  for (const listener of listeners.keydown) listener({ key: 'Escape' });
  assert.equal(wrap.classList.contains('open'), false);
  assert.equal(trigger.attributes['aria-expanded'], 'false');
});

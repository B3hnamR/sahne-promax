'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = {
      add: name => this.setClass(name, true),
      remove: name => this.setClass(name, false),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => this.setClass(name, enabled)
    };
  }
  setClass(name, enabled) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    if (enabled) names.add(name);
    else names.delete(name);
    this.className = [...names].join(' ');
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners[event.type] || []) listener(event);
    if (event.type === 'change' && typeof this.onchange === 'function') this.onchange(event);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', stopPropagation() {} });
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (selector === '.sp-select-option' && child.classList.contains('sp-select-option')) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    if (selector === '.sp-select-option.selected')
      return this.querySelectorAll('.sp-select-option').find(item => item.classList.contains('selected')) || null;
    if (selector === '.sp-select-option-text') {
      const text = this.children.find(child => child.classList.contains('sp-select-option-text'));
      return text || null;
    }
    const all = [this, ...this.querySelectorAll('.sp-select-option')];
    return all.find(item => item.className.split(/\s+/).includes(selector.slice(1))) || null;
  }
  focus() {}
  scrollIntoView() {}
}

class FakeSelect extends FakeElement {
  constructor() {
    super('select');
    this.options = [
      { value: 'one', textContent: 'One' },
      { value: 'two', textContent: 'Two' }
    ];
    this._value = 'one';
    this.parentNode = new FakeElement('div');
    this.parentNode.appendChild(this);
    this.id = 'range';
  }
  get selectedOptions() {
    return [this.options.find(option => option.value === this.value)].filter(Boolean);
  }
}

Object.defineProperty(FakeSelect.prototype, 'value', {
  configurable: true,
  get() {
    return this._value;
  },
  set(value) {
    this._value = String(value);
  }
});

test('custom select dispatches one change event per selected option', () => {
  const source = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'js', 'dropdown.js'), 'utf8')
    .replace(/\bexport\s+(?=(function\b))/g, '');
  const sandbox = {
    document: { addEventListener() {}, createElement: tag => new FakeElement(tag), querySelectorAll: () => [] },
    window: { innerHeight: 1000 },
    HTMLSelectElement: FakeSelect,
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options.bubbles;
      }
    }
  };
  vm.runInNewContext(source + '\n;globalThis.setup = setupCustomSelect;', sandbox, { filename: 'dropdown.js' });
  const select = new FakeSelect();
  let changes = 0;
  select.onchange = () => changes++;

  const wrap = sandbox.setup(select);
  const option = wrap.querySelectorAll('.sp-select-option').find(item => item.dataset.value === 'two');
  option.click();

  assert.equal(select.value, 'two');
  assert.equal(changes, 1);
});

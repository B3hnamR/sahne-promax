// Sahne ProMax — Sleek Glassmorphic Custom Dropdown Component
'use strict';

let activeOpenDropdown = null;

// Global document click to close dropdown when clicking outside
document.addEventListener('click', e => {
  if (activeOpenDropdown && !activeOpenDropdown.contains(e.target)) {
    closeCustomDropdown(activeOpenDropdown);
  }
});

// Global Escape key listener
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && activeOpenDropdown) {
    closeCustomDropdown(activeOpenDropdown);
  }
});

export function closeCustomDropdown(wrap) {
  if (!wrap) return;
  wrap.classList.remove('open');
  const trigger = wrap.querySelector('.sp-select-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (activeOpenDropdown === wrap) activeOpenDropdown = null;
}

export function openCustomDropdown(wrap) {
  if (activeOpenDropdown && activeOpenDropdown !== wrap) {
    closeCustomDropdown(activeOpenDropdown);
  }

  const trigger = wrap.querySelector('.sp-select-trigger');
  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 230 && rect.top > spaceBelow) {
      wrap.classList.add('drop-up');
    } else {
      wrap.classList.remove('drop-up');
    }
  }

  wrap.classList.add('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  activeOpenDropdown = wrap;

  const sel = wrap.querySelector('.sp-select-option.selected');
  if (sel) {
    sel.scrollIntoView({ block: 'nearest' });
  }
}

export function setupCustomSelect(select) {
  if (!select || select.__spCustomized) return select.__spWrapper;
  select.__spCustomized = true;

  // Create wrapper
  const wrap = document.createElement('div');
  wrap.className = 'sp-select';
  if (select.id) wrap.dataset.for = select.id;
  if (select.dataset.a) wrap.dataset.a = select.dataset.a;
  if (select.style.width) wrap.style.width = select.style.width;

  // Create trigger
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'sp-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'sp-select-label';

  const chevron = document.createElement('span');
  chevron.className = 'sp-select-chevron';
  chevron.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

  trigger.appendChild(label);
  trigger.appendChild(chevron);

  // Create menu
  const menu = document.createElement('div');
  menu.className = 'sp-select-menu';
  menu.setAttribute('role', 'listbox');

  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  // Insert wrapper before select in DOM
  select.parentNode.insertBefore(wrap, select);
  select.classList.add('has-sp-select');
  select.__spWrapper = wrap;

  function rebuildOptions() {
    menu.innerHTML = '';
    const opts = Array.from(select.options);
    const currVal = select.value;
    let selectedText = '';

    opts.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'sp-select-option' + (opt.value === currVal ? ' selected' : '');
      item.dataset.value = opt.value;
      item.setAttribute('role', 'option');

      const text = document.createElement('span');
      text.className = 'sp-select-option-text';
      text.textContent = opt.textContent;

      const check = document.createElement('span');
      check.className = 'sp-select-check';
      check.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      item.appendChild(text);
      item.appendChild(check);

      if (opt.value === currVal) {
        selectedText = opt.textContent;
      }

      item.addEventListener('click', e => {
        e.stopPropagation();
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof select.onchange === 'function') {
            select.onchange({ target: select });
          }
        }
        syncFromSelect();
        closeCustomDropdown(wrap);
        trigger.focus();
      });

      menu.appendChild(item);
    });

    if (selectedText) {
      label.textContent = selectedText;
    } else {
      const selOpt = select.selectedOptions && select.selectedOptions[0];
      label.textContent = selOpt ? selOpt.textContent : opts[0] ? opts[0].textContent : '';
    }
  }

  function syncFromSelect() {
    const val = select.value;
    let matchText = '';
    menu.querySelectorAll('.sp-select-option').forEach(item => {
      if (item.dataset.value === val) {
        item.classList.add('selected');
        matchText = item.querySelector('.sp-select-option-text')?.textContent || '';
      } else {
        item.classList.remove('selected');
      }
    });

    if (matchText) {
      label.textContent = matchText;
    } else {
      const selOpt = select.selectedOptions && select.selectedOptions[0];
      if (selOpt) label.textContent = selOpt.textContent;
    }

    trigger.disabled = !!select.disabled;
    wrap.classList.toggle('disabled', !!select.disabled);
  }

  // Intercept value setter on this specific select instance
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    get() {
      return originalDescriptor.get.call(this);
    },
    set(newVal) {
      originalDescriptor.set.call(this, newVal);
      syncFromSelect();
    },
    configurable: true
  });

  // Observe option updates (e.g. innerHTML changes)
  const observer = new MutationObserver(() => {
    rebuildOptions();
    syncFromSelect();
  });
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  // Toggle dropdown on trigger click
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (select.disabled) return;
    if (wrap.classList.contains('open')) {
      closeCustomDropdown(wrap);
    } else {
      openCustomDropdown(wrap);
    }
  });

  // Keyboard navigation
  trigger.addEventListener('keydown', e => {
    if (select.disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!wrap.classList.contains('open')) {
        openCustomDropdown(wrap);
      } else {
        const items = Array.from(menu.querySelectorAll('.sp-select-option'));
        const idx = items.findIndex(i => i.classList.contains('selected'));
        let nextIdx = idx;
        if (e.key === 'ArrowDown') nextIdx = Math.min(items.length - 1, idx + 1);
        if (e.key === 'ArrowUp') nextIdx = Math.max(0, idx - 1);
        if (nextIdx >= 0 && items[nextIdx]) {
          items[nextIdx].click();
        }
      }
    }
  });

  rebuildOptions();
  syncFromSelect();

  wrap.sync = syncFromSelect;
  wrap.rebuild = rebuildOptions;

  return wrap;
}

export function initCustomSelects() {
  document.querySelectorAll('select').forEach(setupCustomSelect);
}

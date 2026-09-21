// Sahne ProMax — Kick chat command settings (viewers type !command in chat → mapped alert file plays).
'use strict';

import { $, $$, esc, post, toast } from './api.js';
import { state } from './state.js';
import { initCustomSelects } from './dropdown.js';

const TOKEN_RE = /^[a-z0-9_-]{1,31}$/;

function fileOptions(selectedId) {
  let h = '<option value="">— انتخاب فایل —</option>';
  for (const f of (state.cfg && state.cfg.files) || []) {
    h += `<option value="${esc(f.id)}"${f.id === selectedId ? ' selected' : ''}>${esc(f.name)}</option>`;
  }
  return h;
}

function updateCount() {
  if ($('#cmdCount')) $('#cmdCount').textContent = String($$('.cmd-row').length);
}

function addRow(command = '', fileId = '') {
  const list = $('#cmdList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'row cmd-row';
  row.style.cssText = 'gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML =
    `<input type="text" class="ltr cmd-token" maxlength="31" placeholder="dance" value="${esc(command)}" style="width:140px">` +
    `<select class="cmd-file" style="flex:1;min-width:150px">${fileOptions(fileId)}</select>` +
    `<button class="btn icon cmd-del" title="حذف"><svg><use href="#i-x"/></svg></button>`;
  list.appendChild(row);
  const del = row.querySelector('.cmd-del');
  if (del)
    del.onclick = () => {
      row.remove();
      updateCount();
    };
  initCustomSelects();
  updateCount();
}

export function fillCommands() {
  const c = state.cfg && state.cfg.chatCommands;
  if (!c || !$('#cmdEnabled')) return;
  $('#cmdEnabled').checked = !!c.enabled;
  $('#cmdPrefix').value = c.prefix || '!';
  $('#cmdGlobalCd').value = c.globalCooldownSec ?? 5;
  $('#cmdUserCd').value = c.userCooldownSec ?? 30;
  $('#cmdMax').value = c.maxPerMinute ?? 10;
  const list = $('#cmdList');
  if (!list) return;
  list.innerHTML = '';
  for (const e of c.entries || []) addRow(e.command, e.fileId);
  updateCount();
}

export function initCommands() {
  if ($('#btnAddCmd')) $('#btnAddCmd').onclick = () => addRow('', '');

  if ($('#btnSaveCmds')) {
    $('#btnSaveCmds').onclick = async () => {
      const entries = [];
      const seen = new Set();
      for (const row of $$('.cmd-row')) {
        const tokenEl = row.querySelector('.cmd-token');
        const fileEl = row.querySelector('.cmd-file');
        const command = (tokenEl ? tokenEl.value : '').trim().toLowerCase();
        const fileId = fileEl ? fileEl.value : '';
        if (!command && !fileId) continue;
        if (!TOKEN_RE.test(command)) {
          toast('دستور «' + command + '» معتبر نیست — فقط حروف انگلیسی، عدد، _ و - (حداکثر ۳۱)', 'err');
          return;
        }
        if (seen.has(command)) {
          toast('دستور «' + command + '» تکراری است', 'err');
          return;
        }
        if (!fileId) {
          toast('برای دستور «' + command + '» یک فایل انتخاب کنید', 'err');
          return;
        }
        seen.add(command);
        entries.push({ command, fileId, enabled: true });
      }

      const r = await post('/api/config', {
        chatCommands: {
          enabled: $('#cmdEnabled').checked,
          prefix: $('#cmdPrefix').value.trim() || '!',
          globalCooldownSec: Number($('#cmdGlobalCd').value) || 0,
          userCooldownSec: Number($('#cmdUserCd').value) || 0,
          maxPerMinute: Number($('#cmdMax').value) || 10,
          entries
        }
      });
      if (r && r.ok) {
        if (state.cfg && r.config) state.cfg.chatCommands = r.config.chatCommands;
        fillCommands();
        toast('دستورات چت ذخیره شد', 'ok');
      } else {
        toast((r && r.error) || 'خطا در ذخیره دستورات چت', 'err');
      }
    };
  }
}

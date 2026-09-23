// Sahne ProMax — File Inspector with Paired Media & Milestone Alerts
'use strict';

import { $, $$, esc, fmtToman, fmtSize, patch, toast, spConfirm } from './api.js';
import { state, setSelectedId } from './state.js';

const insT = new Map();
const pendingSaves = new Map();
const typeLabel = { video: 'ویدیو', image: 'تصویر', audio: 'صدا' };

export function selectFile(id, { onUpdate, onDelete }) {
  setSelectedId(id);
  const cfg = state.cfg;
  const f = (cfg.files || []).find(x => x.id === id);
  if (!f) return closeInspector();

  $$('.fcard').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
  const src = '/media/' + encodeURIComponent(f.file);

  $('#insThumb').innerHTML =
    f.type === 'image'
      ? `<img src="${src}">`
      : f.type === 'video'
        ? `<video src="${src}" muted autoplay loop playsinline></video>`
        : `<svg style="width:40px;height:40px;color:var(--muted)"><use href="#i-audio"/></svg>`;

  $('#insMeta').textContent = `${f.file} · ${fmtSize(f.size)} · ${typeLabel[f.type] || f.type}`;
  $('#iName').value = f.name || '';
  $('#iEnabled').checked = f.enabled !== false;
  $('#iMin').value = f.minToman ?? '';
  $('#iMax').value = f.maxToman ?? '';
  $('#iKw').value = (f.keywords || []).join(', ');
  $('#iVol').value = f.volume ?? 100;
  $('#iDur').value = f.duration ?? '';
  if ($('#iCardDelay')) $('#iCardDelay').value = f.cardDelay ?? '';
  $('#iMinChip').textContent = fmtToman(f.minToman);

  // Paired Media Audio Selection (Image Alerts)
  const audioRow = $('#iAudioRow');
  const audioSelect = $('#iAudioFile');
  if (audioRow && audioSelect) {
    if (f.type === 'image') {
      audioRow.hidden = false;
      const audioFiles = (cfg.files || []).filter(x => x.type === 'audio' && x.enabled !== false);
      let opts = '<option value="">بدون صدا (صامت)</option>';
      for (const a of audioFiles) {
        const sel = a.file === f.audioFile ? 'selected' : '';
        opts += `<option value="${esc(a.file)}" ${sel}>${esc(a.name)} (${esc(a.file)})</option>`;
      }
      audioSelect.innerHTML = opts;
    } else {
      audioRow.hidden = true;
    }
  }

  // Milestone Inputs
  const minM = $('#iMinMonths');
  const maxM = $('#iMaxMonths');
  const minC = $('#iMinCount');
  const maxC = $('#iMaxCount');
  if (minM) minM.value = f.minMonths ?? '';
  if (maxM) maxM.value = f.maxMonths ?? '';
  if (minC) minC.value = f.minCount ?? '';
  if (maxC) maxC.value = f.maxCount ?? '';

  $('#inspector').hidden = false;
  $('#shell').classList.add('has-inspector');
}

export function closeInspector() {
  setSelectedId(null);
  const ins = $('#inspector');
  if (ins) ins.hidden = true;
  const sh = $('#shell');
  if (sh) sh.classList.remove('has-inspector');
  $$('.fcard').forEach(c => c.classList.remove('selected'));
  const v = $('#insThumb video');
  if (v) {
    v.pause();
    v.src = '';
  }
}

export function collectInspector() {
  const num = v => (v === '' || v == null ? null : Number(v));
  const audioSelect = $('#iAudioFile');
  return {
    id: state.selectedId,
    name: $('#iName').value.trim() || state.selectedId,
    enabled: $('#iEnabled').checked,
    minToman: num($('#iMin').value),
    maxToman: num($('#iMax').value),
    keywords: $('#iKw')
      .value.split(',')
      .map(s => s.trim())
      .filter(Boolean),
    volume: Math.max(0, Math.min(100, Number($('#iVol').value) || 0)),
    duration: num($('#iDur').value),
    cardDelay: $('#iCardDelay') ? num($('#iCardDelay').value) : null,
    audioFile: audioSelect && !$('#iAudioRow').hidden && audioSelect.value ? audioSelect.value : null,
    minMonths: num($('#iMinMonths') ? $('#iMinMonths').value : null),
    maxMonths: num($('#iMaxMonths') ? $('#iMaxMonths').value : null),
    minCount: num($('#iMinCount') ? $('#iMinCount').value : null),
    maxCount: num($('#iMaxCount') ? $('#iMaxCount').value : null)
  };
}

export function initInspector({ onUpdate, onDelete, onPreview }) {
  $('#insClose').onclick = closeInspector;

  const fields = [
    '#iName',
    '#iEnabled',
    '#iMin',
    '#iMax',
    '#iKw',
    '#iVol',
    '#iDur',
    '#iCardDelay',
    '#iAudioFile',
    '#iMinMonths',
    '#iMaxMonths',
    '#iMinCount',
    '#iMaxCount'
  ];
  fields.forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => {
      if (!state.selectedId) return;
      $('#iMinChip').textContent = fmtToman($('#iMin').value);
      // Capture both the file and its edited values before selection can change.
      // Keep one debounce timer per file so editing another card cannot cancel it.
      const body = collectInspector();
      clearTimeout(insT.get(body.id));
      insT.set(
        body.id,
        setTimeout(() => {
          insT.delete(body.id);
          // Serialize requests for the same file so an older response cannot
          // finish after a newer save and restore stale values.
          const previous = (pendingSaves.get(body.id) || Promise.resolve()).catch(() => {});
          const pending = previous.then(async () => {
            try {
              const r = await patch('/api/file', body);
              if (r.ok) {
                const f = (state.cfg.files || []).find(x => x.id === body.id);
                if (f) Object.assign(f, r.file);
                if (typeof onUpdate === 'function') onUpdate();
                const s = $('#insSaved');
                if (s && state.selectedId === body.id) {
                  s.classList.add('show');
                  setTimeout(() => s.classList.remove('show'), 1200);
                }
              } else {
                toast(r.error || 'ذخیره نشد', 'err');
              }
            } catch {
              toast('ذخیره نشد؛ اتصال را بررسی کنید', 'err');
            }
          });
          pendingSaves.set(body.id, pending);
          pending
            .catch(() => {})
            .then(() => {
              if (pendingSaves.get(body.id) === pending) pendingSaves.delete(body.id);
            });
        }, 350)
      );
    });
  });

  $('#iPreview').onclick = () => {
    if (!state.selectedId) return;
    if (typeof onPreview === 'function') {
      onPreview(state.selectedId);
    }
  };

  $('#iDelete').onclick = async () => {
    const f = (state.cfg.files || []).find(x => x.id === state.selectedId);
    if (!f) return;
    const ok = await spConfirm({
      title: 'حذف فایل مدیا',
      body: 'حذف «' + f.name + '»؟ این فایل از روی دیسک هم پاک می‌شود.',
      confirmText: 'حذف فایل',
      cancelText: 'انصراف',
      icon: '#i-trash',
      danger: true
    });
    if (!ok) return;
    clearTimeout(insT.get(f.id));
    insT.delete(f.id);
    if (pendingSaves.has(f.id)) {
      try {
        await pendingSaves.get(f.id);
      } catch {}
    }
    try {
      const response = await fetch('/api/file?id=' + encodeURIComponent(f.id), { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.deleted) throw new Error(result.error || 'delete failed');
    } catch {
      toast('حذف فایل ناموفق بود؛ دوباره تلاش کنید', 'err');
      return;
    }
    closeInspector();
    toast('حذف شد', 'ok');
    if (typeof onDelete === 'function') onDelete();
  };
}

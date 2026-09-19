// Sahne ProMax — Files Grid & Media Management
'use strict';

import { $, $$, DESK, esc, fmtToman, fmtSize, faNum, toast, post } from './api.js';
import { state } from './state.js';
import { selectFile, closeInspector } from './inspector.js';

let fFilter = 'all';
let fQuery = '';
let fSort = 'amount';

const typeIcon = { video: 'i-video', image: 'i-image', audio: 'i-audio' };

export function visibleFiles() {
  let list = [...(state.cfg.files || [])];
  const counts = { all: list.length, video: 0, image: 0, audio: 0, off: 0 };
  for (const f of list) {
    if (counts[f.type] != null) counts[f.type]++;
    if (f.enabled === false) counts.off++;
  }
  $$('#fSeg button').forEach(b => {
    const el = b.querySelector('.n');
    if (el) el.textContent = counts[b.dataset.f] ?? 0;
  });

  if (fFilter === 'off') list = list.filter(f => f.enabled === false);
  else if (fFilter !== 'all') list = list.filter(f => f.type === fFilter);

  if (fQuery) {
    const q = fQuery.toLowerCase();
    list = list.filter(
      f =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.file || '').toLowerCase().includes(q) ||
        (f.keywords || []).join(' ').toLowerCase().includes(q)
    );
  }

  const by = {
    amount: (a, b) =>
      (Number(a.minToman) || 0) - (Number(b.minToman) || 0) || String(a.name).localeCompare(String(b.name)),
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'fa'),
    size: (a, b) => (b.size || 0) - (a.size || 0)
  };
  return list.sort(by[fSort] || by.amount);
}

export function renderFiles() {
  const navFiles = $('#navFiles');
  if (navFiles) navFiles.textContent = (state.cfg.files || []).length;
  const box = $('#files');
  if (!box) return;
  box.innerHTML = '';
  const list = visibleFiles();

  if (!list.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1">${
      (state.cfg.files || []).length
        ? 'چیزی با این فیلتر پیدا نشد.'
        : 'هنوز فایلی اضافه نشده. فایل‌ها رو اینجا رها کن یا «افزودن فایل» رو بزن.'
    }</div>`;
    return;
  }

  for (const f of list) {
    const el = document.createElement('div');
    el.className = 'fcard' + (f.enabled === false ? ' off' : '') + (f.id === state.selectedId ? ' selected' : '');
    el.dataset.id = f.id;
    const src = '/media/' + encodeURIComponent(f.file);

    // Render paired sound badge if image has sound
    const pairedBadge =
      f.type === 'image' && f.audioFile
        ? `<span class="chip on" style="font-size:10px;margin-right:4px;" title="صدای همزمان: ${esc(f.audioFile)}">🎵 صدا</span>`
        : '';

    const thumb =
      f.type === 'image'
        ? `<img src="${src}" loading="lazy">`
        : f.type === 'video'
          ? `<video data-src="${src}#t=0.5" muted preload="none" loop></video>`
          : `<svg><use href="#${typeIcon.audio}"/></svg>`;

    const kw = (f.keywords || []).filter(Boolean);
    const amount = kw.length
      ? `<span class="amount kw">${esc(kw.slice(0, 2).join('، '))}${kw.length > 2 ? ' …' : ''}</span>`
      : `<span class="amount${Number(f.minToman) ? '' : ' none'}">${Number(f.minToman) ? 'از ' + fmtToman(f.minToman) : 'بدون مبلغ'}</span>`;

    el.innerHTML = `<div class="thumb">${thumb}</div>${amount}${pairedBadge}${
      f.enabled === false ? '<span class="offlbl">غیرفعال</span>' : ''
    }<div class="cap"><div class="name">${esc(f.name)}</div><div class="meta">${fmtSize(f.size)}</div><span class="type"><svg><use href="#${
      typeIcon[f.type] || 'i-files'
    }"/></svg>${esc((f.file.split('.').pop() || '').toUpperCase())}</span></div>`;

    el.onclick = () => selectFile(f.id, { onUpdate: renderFiles, onDelete: renderFiles });

    // Lazy load preview video on hover
    const v = el.querySelector('video');
    if (v) {
      el.onmouseenter = () => {
        if (!v.src && v.dataset.src) {
          v.src = v.dataset.src;
        }
        v.play().catch(() => {});
      };
      el.onmouseleave = () => {
        v.pause();
        try {
          v.currentTime = 0.5;
        } catch {}
      };
    }
    box.appendChild(el);
  }
}

export function initFiles({ onLoadNeeded }) {
  $('#fSearch').oninput = e => {
    fQuery = e.target.value.trim();
    renderFiles();
  };

  $('#fSort').onchange = e => {
    fSort = e.target.value;
    renderFiles();
  };

  $$('#fSeg button').forEach(b => {
    b.onclick = () => {
      $$('#fSeg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      fFilter = b.dataset.f;
      renderFiles();
    };
  });

  $('#btnOpenFolder').onclick = () =>
    DESK ? window.sahne.app.openPath('media') : post('/api/open', { target: 'media' });

  $('#btnScan').onclick = async () => {
    const r = await post('/api/scan');
    toast(faNum(r.added) + ' فایل جدید اضافه شد', 'ok');
    if (typeof onLoadNeeded === 'function') onLoadNeeded();
  };

  $('#btnAdd').onclick = async () => {
    if (DESK) {
      const r = await window.sahne.files.pick();
      if (r.added.length) toast(faNum(r.added.length) + ' فایل اضافه شد', 'ok');
      if (r.skipped.length) toast('پشتیبانی نشد: ' + r.skipped.join('، '), 'err');
      if (r.added.length && typeof onLoadNeeded === 'function') onLoadNeeded();
    } else {
      $('#fileInput').click();
    }
  };

  $('#fileInput').onchange = () => {
    uploadHttp([...$('#fileInput').files], onLoadNeeded);
    $('#fileInput').value = '';
  };

  initDragDrop(onLoadNeeded);
}

async function uploadHttp(files, onLoadNeeded) {
  const st = $('#upStatus');
  for (let i = 0; i < files.length; i++) {
    st.textContent = `در حال آپلود ${i + 1}/${files.length}: ${files[i].name}`;
    const r = await fetch('/api/upload?name=' + encodeURIComponent(files[i].name), {
      method: 'PUT',
      body: files[i]
    }).then(res => res.json());
    if (r.error) toast(r.error, 'err');
  }
  st.textContent = '';
  toast('فایل‌ها اضافه شدند', 'ok');
  if (typeof onLoadNeeded === 'function') onLoadNeeded();
}

function initDragDrop(onLoadNeeded) {
  const content = $('#content');
  let dragDepth = 0;

  content.addEventListener('dragenter', e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    content.classList.add('dragover');
    window.goPage('files');
  });

  content.addEventListener('dragover', e => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });

  content.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      content.classList.remove('dragover');
    }
  });

  content.addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth = 0;
    content.classList.remove('dragover');
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    if (DESK) {
      const r = await window.sahne.files.importDropped(files);
      if (r.added.length) toast(faNum(r.added.length) + ' فایل اضافه شد', 'ok');
      if (r.skipped.length) toast('پشتیبانی نشد: ' + r.skipped.join('، '), 'err');
      if (typeof onLoadNeeded === 'function') onLoadNeeded();
    } else {
      uploadHttp(files, onLoadNeeded);
    }
  });
}

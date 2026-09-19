// Sahne ProMax — Main Frontend Coordinator (ES Module)
'use strict';

import { $, $$, DESK, api, post, toast, esc, fmtToman, faNum, copyText, spConfirm } from './api.js';
import { state, setConfig, setRuntimeState, setInfo } from './state.js';
import { initNav } from './nav.js';
import { initInspector, closeInspector } from './inspector.js';
import { initFiles, renderFiles } from './files.js';
import { initLook, fillLook, fitPreview } from './look.js';
import { initGoal, fillGoal } from './goal.js';
import { initControls } from './controls.js';
import { initBackup } from './backup.js';
import { initCustomSelects } from './dropdown.js';

const KB_TEXT = {
  connected: ['متصل', 'chip on'],
  connecting: ['در حال اتصال…', 'chip warn'],
  reconnecting: ['قطع شده، تلاش مجدد…', 'chip warn'],
  unconfigured: ['تنظیم نشده', 'chip']
};

async function load() {
  const r = await api('/api/config');
  setConfig(r.config);
  setRuntimeState(r.state);

  if (DESK && !state.info) {
    try {
      setInfo(await window.sahne.app.info());
    } catch {}
  }

  const ver = r.version || (state.info && state.info.version) || '2.0.0-pro';
  const brandVer = $('#brandVer');
  if (brandVer) brandVer.textContent = 'Sahne ProMax v' + ver;

  renderFiles();
  fillLook();
  renderState();
  fillSettings();
  renderRate();
  fillSetup();
  fillKick();
  fillApp();
  fillGoal(r.config.goal);

  const logBox = $('#log');
  if (logBox) {
    logBox.innerHTML = '';
    (r.logs || []).forEach(addLog);
  }
}

function fillSetup() {
  const cfg = state.cfg;
  const need = !(cfg.kickbot && cfg.kickbot.configured);
  const setupCard = $('#setupCard');
  if (setupCard) setupCard.hidden = !need;
}

async function doSetup(inputSel, msgSel) {
  const msg = $(msgSel);
  if (msg) msg.textContent = 'در حال بررسی…';
  const r = await post('/api/setup', { url: $(inputSel).value });
  if (r.ok) {
    toast('متصل شد', 'ok');
    if (msg) msg.textContent = 'انجام شد. Streamer ID: ' + r.streamer_id;
    load();
  } else {
    if (msg) msg.textContent = r.error || 'خطا';
    toast(r.error || 'خطا', 'err');
  }
}

function fillKick() {
  const k = (state.cfg && state.cfg.kick) || {};
  if ($('#kEnabled')) $('#kEnabled').checked = k.enabled !== false;
  if ($('#kChannel')) $('#kChannel').value = k.channel || '';
  if ($('#kGift')) $('#kGift').value = k.giftValueToman || 0;
  if ($('#kSub')) $('#kSub').value = k.subValueToman || 0;
  if ($('#kShowSubs')) $('#kShowSubs').checked = k.showNewSubs !== false;
  renderKickStatus();
}

function renderKickStatus() {
  const st = (state.runtimeState && state.runtimeState.kick) || {};
  const el = $('#kStatus');
  const pill = $('#stKick');
  const h = $('#hKick');
  let txt = '';
  let cls = 'chip';
  let pcls = 'status-pill';

  if (!state.cfg || !state.cfg.kick || state.cfg.kick.enabled === false) {
    txt = 'غیرفعال';
  } else if (!state.cfg.kick.channel) {
    txt = 'اسم کانال وارد نشده';
    pcls += ' warn';
  } else if (st.connected) {
    txt = 'متصل به چت ' + st.channel;
    cls += ' on';
    pcls += ' on';
  } else {
    txt = st.error ? 'خطا: ' + st.error : 'در حال اتصال…';
    cls += ' warn';
    pcls += ' warn';
  }

  if (el) {
    el.textContent = txt;
    el.className = cls;
  }
  if (h) {
    h.textContent = txt;
    h.className = cls;
  }
  if (pill) pill.className = pcls;
}

function renderKb() {
  const kb = (state.cfg && state.cfg.kickbot) || {};
  const st = (state.runtimeState && state.runtimeState.kbStatus) || (kb.configured ? 'reconnecting' : 'unconfigured');
  const [txt, cls] = KB_TEXT[st] || KB_TEXT.unconfigured;
  if ($('#kbChip')) {
    $('#kbChip').textContent = txt;
    $('#kbChip').className = cls;
  }
  if ($('#kbStreamer')) $('#kbStreamer').textContent = kb.streamer_id || '—';
  if ($('#kbSecret')) {
    $('#kbSecret').textContent = kb.configured
      ? kb.secretStorage === 'os'
        ? 'ذخیره شده (رمزنگاری‌شده با ویندوز DPAPI)'
        : 'ذخیره شده (بدون رمزنگاری؛ DPAPI در دسترس نیست)'
      : 'وارد نشده';
  }
  if ($('#btnDisconnect')) $('#btnDisconnect').disabled = !kb.configured;
}

function fillSettings() {
  const port = (state.cfg && state.cfg.port) || 7788;
  const base = `http://localhost:${port}`;
  if ($('#ovUrl')) $('#ovUrl').value = `${base}/overlay`;
  if ($('#ovUrlGameplay')) $('#ovUrlGameplay').value = `${base}/overlay?profile=gameplay`;
  if ($('#ovUrlChatting')) $('#ovUrlChatting').value = `${base}/overlay?profile=chatting`;
  if ($('#mode')) $('#mode').value = state.cfg.mode;
  if ($('#showNoMedia')) $('#showNoMedia').checked = state.cfg.showAlertWithoutMedia !== false;
  renderKb();
}

function fillApp() {
  const info = state.info;
  const cfg = state.cfg;
  if ($('#appVer')) $('#appVer').value = info ? info.version + ' · Electron ' + info.electron : (cfg && cfg.version) || '2.0.0-pro';
  if ($('#dataDir')) $('#dataDir').value = info ? info.dataDir : '';
  if ($('#autostart')) {
    $('#autostart').checked = !!(info && info.autostart);
    $('#autostart').disabled = !DESK;
  }
  if ($('#btnOpenData')) $('#btnOpenData').disabled = !DESK;
  if ($('#btnOpenLog')) $('#btnOpenLog').disabled = !DESK;
  if ($('#btnClearData')) $('#btnClearData').disabled = !DESK;

  if ($('#abVer')) {
    $('#abVer').textContent = info
      ? `${info.version} · Electron ${info.electron} · Chromium ${info.chrome}`
      : (cfg && cfg.version) || '2.0.0-pro';
  }
  if ($('#abData')) $('#abData').textContent = info ? info.dataDir : '—';
  if ($('#abServer')) $('#abServer').textContent = 'http://localhost:' + ((cfg && cfg.port) || 7788);
  if ($('#abSecret')) {
    $('#abSecret').textContent =
      cfg && cfg.kickbot && cfg.kickbot.secretStorage === 'os'
        ? 'رمزنگاری‌شده با ویندوز (DPAPI)'
        : 'متن ساده در config.json (DPAPI در دسترس نیست)';
  }
  if ($('#abSec')) $('#abSec').textContent = info ? info.securityContact : '—';
}

function renderState() {
  const s = state.runtimeState;
  if (!s) return;

  const stKb = $('#stKb');
  if (stKb) stKb.className = 'status-pill' + (s.connected ? ' on' : s.configured ? ' warn' : '');

  const kbt = KB_TEXT[s.kbStatus] || KB_TEXT.unconfigured;
  if ($('#hKb')) {
    $('#hKb').textContent = kbt[0];
    $('#hKb').className = kbt[1];
  }

  if (state.cfg) {
    renderKb();
    renderKickStatus();
  }

  if ($('#stOv')) $('#stOv').className = 'status-pill' + (s.overlays > 0 ? ' on' : ' warn');
  if ($('#stOvN')) $('#stOvN').textContent = s.overlays;
  if ($('#hOv')) $('#hOv').textContent = s.overlays;
  if ($('#hMode')) $('#hMode').textContent = s.mode === 'standalone' ? 'جایگزین ویجت' : 'کنار ویجت';

  if ($('#sPlaying')) {
    $('#sPlaying').innerHTML = s.playing
      ? `<span class="chip on">${esc(s.playing.name)} · $${s.playing.amount}</span>`
      : '—';
  }
  if ($('#sApproved')) $('#sApproved').textContent = s.approved;
  if ($('#sPending')) $('#sPending').textContent = s.pending;
  if ($('#sQueue')) $('#sQueue').textContent = s.queueStatus === 'play' ? 'در حال پخش' : 'متوقف';

  const pauseBtn = $('#btnPauseQueue');
  if (pauseBtn) {
    const isPaused = s.queueStatus !== 'play';
    pauseBtn.dataset.paused = isPaused ? '1' : '0';
    pauseBtn.textContent = isPaused ? '▶ از سرگیری صف' : '⏸ توقف صف';
  }

  if ($('#sDelay')) $('#sDelay').textContent = faNum(s.queueDelay) + ' ثانیه';
  if ($('#hRate')) $('#hRate').textContent = s.rate ? Number(s.rate).toLocaleString('en-US') : '—';

  if ($('#hRateMeta')) {
    $('#hRateMeta').textContent = s.rateManual
      ? 'دستی'
      : s.rateUpdatedAt
        ? (s.rateSource === 'nobitex' ? 'نوبیتکس' : s.rateSource === 'baha24' ? 'بهاء۲۴' : (s.rateSource || 'نوبیتکس')) +
          ' · ' +
          new Date(s.rateUpdatedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) +
          (s.rateError ? ' · آخرین تلاش ناموفق' : '')
        : s.rateError
          ? 'دریافت نرخ ناموفق'
          : 'هنوز دریافت نشده';
  }

  const rc = $('#recent');
  if (rc) {
    rc.innerHTML = s.recent.length ? '' : '<span class="hint">هنوز چیزی نیست</span>';
    s.recent.forEach(t => {
      const d = document.createElement('div');
      d.className = 'it';
      d.innerHTML = `<span class="a">${t.toman ? fmtToman(t.toman) : '$' + t.amount}</span><b>${esc(
        t.name || ''
      )}</b>${
        t.kind === 'gift'
          ? '<span class="chip">🎁 ' + faNum(t.count) + ' ساب‌گیفت</span>'
          : t.kind === 'sub'
            ? '<span class="chip">⭐ ساب</span>'
            : ''
      }<span class="m">${esc(t.message || '')}</span><span class="chip">${
        t.media ? esc(t.media) : 'بدون فایل'
      }</span>${t.test ? '<span class="chip warn">تست</span>' : ''}`;
      rc.appendChild(d);
    });
  }
}

function renderRate() {
  const r = (state.cfg && state.cfg.rate) || {};
  const eff = Number(r.manual) > 0 ? Number(r.manual) : r.value || 0;
  if ($('#rateVal')) $('#rateVal').textContent = eff ? eff.toLocaleString('en-US') + ' T' : '—';
  if ($('#rateMeta')) {
    $('#rateMeta').textContent =
      Number(r.manual) > 0
        ? '(دستی)'
        : r.updatedAt
          ? (r.source === 'nobitex' ? 'نوبیتکس' : r.source === 'baha24' ? 'بهاء۲۴' : (r.source || 'نوبیتکس')) + ' · ' + new Date(r.updatedAt).toLocaleTimeString('fa-IR')
          : 'هنوز دریافت نشده';
  }
  if ($('#rateAuto')) $('#rateAuto').checked = r.auto !== false;
  if ($('#rateInt')) $('#rateInt').value = r.intervalMin || 2;
  if ($('#rateManual')) $('#rateManual').value = r.manual || '';
  if ($('#rateProxy')) $('#rateProxy').value = r.proxy || '';
}

function addLog(e) {
  const l = $('#log');
  if (!l) return;
  const d = document.createElement('div');
  d.className = e.level;
  d.textContent = `[${e.t.slice(11, 19)}] ${e.msg}${e.extra !== undefined ? '  ' + JSON.stringify(e.extra) : ''}`;
  l.appendChild(d);
  while (l.children.length > 400) l.firstChild.remove();
  l.scrollTop = l.scrollHeight;
}

async function loadSim() {
  try {
    const r = await api('/api/simulate');
    const tb = $('#simTable tbody');
    if (!tb) return;
    tb.innerHTML = '';
    for (const row of r.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.label === 'sub' ? '⭐ ۱ ساب' : '🎁 ' + faNum(row.count) + ' ساب‌گیفت'}</td><td class="num">${faNum(
        row.toman
      )}</td><td>${
        row.media ? '<span class="chip on">' + esc(row.media.name) + '</span>' : '<span class="chip">بدون فایل</span>'
      }</td>`;
      tb.appendChild(tr);
    }
  } catch {}
}

async function showDoc(name) {
  const el = $('#docView');
  if (!el) return;
  el.textContent = '…';
  try {
    el.textContent = await fetch('/legal/' + name).then(r => (r.ok ? r.text() : 'سند پیدا نشد'));
  } catch {
    el.textContent = 'سند پیدا نشد';
  }
}

// Targeted Server-Sent Events listener (Zero Redundant Polling)
function connectEvents() {
  const es = new EventSource('/events?role=admin');
  es.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data);
      if (d.type === 'state') {
        setRuntimeState(d.state);
        renderState();
      } else if (d.type === 'config') {
        if (state.cfg) {
          state.cfg.appearance = d.appearance;
          fillLook();
        }
      } else if (d.type === 'goal_update') {
        if (state.cfg) state.cfg.goal = d.goal;
        fillGoal(d.goal);
      } else if (d.type === 'log') {
        addLog(d.entry);
      } else if (d.type === 'rate') {
        if (state.cfg) state.cfg.rate = d.rate;
        renderRate();
      }
    } catch {}
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectEvents, 3000);
  };
}

// Global App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  initNav({
    onPageChange: name => {
      if (name === 'look') setTimeout(fitPreview, 40);
      if (name === 'home') loadSim();
      if (name === 'about' && !$('#docView').textContent) showDoc('PRIVACY.md');
      if (name !== 'files') closeInspector();
    }
  });

  initInspector({
    onUpdate: renderFiles,
    onDelete: () => {
      renderFiles();
      load();
    },
    onPreview: id => {
      window.goPage('look');
      post('/api/preview', {
        name: $('#pvName').value,
        amount: $('#pvAmount').value,
        message: $('#pvMsg').value,
        fileId: id
      });
    }
  });

  initFiles({ onLoadNeeded: load });
  initLook();
  initGoal();
  initControls({ onStateChange: renderState });
  initBackup({ onRestoreComplete: load });

  // Home Test Buttons
  if ($('#btnTest')) {
    $('#btnTest').onclick = async () => {
      await post('/api/test', {
        name: $('#tName').value,
        amount: $('#tAmount').value,
        message: $('#tMsg').value
      });
      toast('ارسال شد', 'ok');
    };
  }

  if ($('#btnTestSub')) {
    $('#btnTestSub').onclick = () =>
      post('/api/test-sub', { kind: 'sub', name: 'AliGamer', months: 1 }).then(() => toast('ارسال شد', 'ok'));
  }

  if ($('#btnTestGift')) {
    $('#btnTestGift').onclick = () =>
      post('/api/test-sub', { kind: 'gift', name: 'AliGamer', count: 3 }).then(() => toast('ارسال شد', 'ok'));
  }

  if ($('#btnSetup')) $('#btnSetup').onclick = () => doSetup('#setupUrl', '#setupMsg');
  if ($('#btnSetup2')) $('#btnSetup2').onclick = () => doSetup('#setupUrl2', '#setupMsg2');

  if ($('#btnSaveKick')) {
    $('#btnSaveKick').onclick = async () => {
      await post('/api/config', {
        kick: {
          enabled: $('#kEnabled').checked,
          channel: $('#kChannel').value.trim(),
          giftValueToman: Number($('#kGift').value) || 0,
          subValueToman: Number($('#kSub').value) || 0,
          showNewSubs: $('#kShowSubs').checked
        }
      });
      toast('ذخیره شد', 'ok');
      setTimeout(load, 1200);
    };
  }

  if ($('#btnSaveRate')) {
    $('#btnSaveRate').onclick = async () => {
      await post('/api/config', {
        rate: {
          auto: $('#rateAuto').checked,
          manual: $('#rateManual').value,
          intervalMin: $('#rateInt').value,
          proxy: $('#rateProxy').value
        }
      });
      toast('ذخیره شد', 'ok');
      load();
    };
  }

  if ($('#btnRate')) {
    $('#btnRate').onclick = async () => {
      const r = await post('/api/refresh-rate');
      toast(r.ok ? 'نرخ به‌روز شد' : 'دریافت نرخ ناموفق بود', r.ok ? 'ok' : 'err');
      load();
    };
  }

  if ($('#hRateBtn')) {
    $('#hRateBtn').onclick = async () => {
      const r = await post('/api/refresh-rate');
      toast(r.ok ? 'نرخ به‌روز شد' : 'دریافت نرخ ناموفق بود', r.ok ? 'ok' : 'err');
      load();
    };
  }

  if ($('#btnDisconnect')) {
    $('#btnDisconnect').onclick = async () => {
      const ok = await spConfirm({
        title: 'قطع اتصال کیک‌بات',
        body: 'اتصال کیک‌بات قطع و کلید ویجت از این کامپیوتر حذف شود؟',
        confirmText: 'قطع اتصال',
        cancelText: 'انصراف',
        icon: '#i-trash',
        danger: true
      });
      if (!ok) return;
      await post('/api/disconnect-kickbot');
      toast('اتصال کیک‌بات حذف شد', 'ok');
      load();
    };
  }

  if ($('#btnResetSettings')) {
    $('#btnResetSettings').onclick = async () => {
      const ok = await spConfirm({
        title: 'بازنشانی تنظیمات',
        body: 'ظاهر، نرخ، حالت کار و تنظیمات ساب به پیش‌فرض برگردند؟',
        confirmText: 'بازنشانی',
        cancelText: 'انصراف',
        icon: '#i-refresh',
        danger: true
      });
      if (!ok) return;
      await post('/api/reset-settings');
      toast('تنظیمات بازگردانی شد', 'ok');
      load();
    };
  }

  if ($('#btnClearData')) {
    $('#btnClearData').onclick = () => {
      if (DESK) window.sahne.app.clearData();
    };
  }

  if ($('#btnOpenData')) $('#btnOpenData').onclick = () => DESK && window.sahne.app.openPath('data');
  if ($('#btnOpenLog')) $('#btnOpenLog').onclick = () => DESK && window.sahne.app.openPath('log');
  if ($('#abOpenData')) $('#abOpenData').onclick = () => DESK && window.sahne.app.openPath('data');
  if ($('#abOpenLog')) $('#abOpenLog').onclick = () => DESK && window.sahne.app.openPath('log');
  if ($('#btnClearLog')) $('#btnClearLog').onclick = () => { if ($('#log')) $('#log').innerHTML = ''; };

  $$('[data-doc]').forEach(b => {
    b.onclick = () => {
      $$('[data-doc]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      showDoc(b.dataset.doc);
    };
  });

  if ($('#autostart')) {
    $('#autostart').onchange = async e => {
      if (!DESK) return;
      const r = await window.sahne.app.autostart(e.target.checked);
      e.target.checked = !!r;
      await post('/api/config', { app: { autostart: !!r } });
      toast(r ? 'اجرای خودکار فعال شد' : 'اجرای خودکار غیرفعال شد', 'ok');
    };
  }

  if ($('#btnCopy')) {
    $('#btnCopy').onclick = () => {
      copyText($('#ovUrl').value);
      toast('لینک Browser Source کپی شد', 'ok');
    };
  }

  if ($('#btnCopyGameplay')) {
    $('#btnCopyGameplay').onclick = () => {
      copyText($('#ovUrlGameplay').value);
      toast('لینک پروفایل گیم‌پلی کپی شد', 'ok');
    };
  }

  if ($('#btnCopyChatting')) {
    $('#btnCopyChatting').onclick = () => {
      copyText($('#ovUrlChatting').value);
      toast('لینک پروفایل چت کپی شد', 'ok');
    };
  }

  if ($('#hCopyUrl')) {
    $('#hCopyUrl').onclick = () => {
      copyText($('#ovUrl').value);
      toast('لینک Browser Source کپی شد', 'ok');
    };
  }

  if ($('#btnSaveSettings')) {
    $('#btnSaveSettings').onclick = async () => {
      await post('/api/config', {
        mode: $('#mode').value,
        showAlertWithoutMedia: $('#showNoMedia').checked
      });
      toast('ذخیره شد', 'ok');
      load();
    };
  }

  initCustomSelects();
  await load();
  initCustomSelects();
  connectEvents();
  fitPreview();

  let initialPage = 'home';
  try {
    initialPage = localStorage.getItem('sp.page') || 'home';
  } catch {}
  window.goPage(initialPage);
  loadSim();
});

// Sahne ProMax — Main Frontend Coordinator (ES Module)
'use strict';

import {
  $,
  $$,
  DESK,
  api,
  post,
  toast,
  esc,
  fmtToman,
  faNum,
  copyText,
  spConfirm,
  saveSettings,
  settingsRequest,
  SETTINGS_SAVE_ERROR
} from './api.js';
import { state, setConfig, setRuntimeState, setInfo, setVersion } from './state.js';
import { initNav } from './nav.js';
import { initInspector, closeInspector } from './inspector.js';
import { initFiles, renderFiles } from './files.js';
import { initLook, fillLook, fitPreview } from './look.js';
import { initGoal, fillGoal } from './goal.js';
import { initHistory, refreshHistory, renderHistoryLive } from './history.js';
import './analytics.js';
import { initCommands, fillCommands } from './commands.js';
import { initRules, fillRules } from './rules.js';
import { initControls } from './controls.js';
import { initBackup } from './backup.js';
import { initCustomSelects } from './dropdown.js';
import { initUpdates } from './updates.js';

const KB_TEXT = {
  connected: ['متصل', 'chip on'],
  connecting: ['در حال اتصال…', 'chip warn'],
  reconnecting: ['قطع شده، تلاش مجدد…', 'chip warn'],
  unconfigured: ['تنظیم نشده', 'chip']
};
const SE_TEXT = {
  connected: ['متصل', 'chip on'],
  connecting: ['در حال اتصال…', 'chip warn'],
  reconnecting: ['قطع شده، تلاش مجدد…', 'chip warn'],
  error: ['خطا', 'chip warn'],
  unconfigured: ['تنظیم نشده', 'chip']
};

function originalAmount(t) {
  const amount = Number((t && (t.amount ?? t.usd)) || 0);
  const value = Math.round(amount * 100) / 100;
  const currency = String((t && t.currency) || 'USD').toUpperCase();
  if (currency === 'IRT' || currency === 'TMN' || currency === 'TOMAN') return fmtToman(value);
  return currency === 'USD' ? '$' + value : value + ' ' + currency;
}

function displayedAmount(t) {
  const original = originalAmount(t);
  const currency = String((t && t.currency) || 'USD').toUpperCase();
  return t && t.toman != null && !['IRT', 'TMN', 'TOMAN'].includes(currency)
    ? fmtToman(t.toman) + ' · ' + original
    : original;
}

function sourceLabel(source) {
  if (source === 'streamelements') return 'StreamElements';
  if (source === 'kickbot') return 'KickBot';
  if (source === 'kick') return 'Kick';
  if (source === 'donofa') return 'Donofa';
  return '';
}

function rateSourceLabel(source) {
  if (source === 'nobitex') return 'نوبیتکس';
  if (source === 'baha24') return 'بهاء۲۴';
  return source || 'نوبیتکس';
}

async function load() {
  const r = await api('/api/config');
  setConfig(r.config);
  setRuntimeState(r.state);
  setVersion(r.version || null);

  if (DESK && !state.info) {
    try {
      setInfo(await window.sahne.app.info());
    } catch {}
  }

  const ver = state.version || (state.info && state.info.version) || '—';
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
  fillCommands();

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
    if ($('#setupUrl')) $('#setupUrl').value = '';
    if ($('#setupUrl2')) $('#setupUrl2').value = '';
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

  // what to do about the error (filtered kick.com, VPN, wrong channel name)
  const hint = $('#kHint');
  if (hint) {
    const showHint = !!(
      st.hint &&
      state.cfg.kick &&
      state.cfg.kick.enabled !== false &&
      state.cfg.kick.channel &&
      !st.connected
    );
    hint.hidden = !showHint;
    hint.textContent = showHint ? st.hint : '';
  }
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
  if ($('#donofaEndpoint')) $('#donofaEndpoint').value = (state.cfg.donofa && state.cfg.donofa.endpoint) || 'ir';
  renderKb();
  renderSe();
  renderDonofa();
}

function renderSe() {
  const cfg = (state.cfg && state.cfg.streamelements) || {};
  const runtime = (state.runtimeState && state.runtimeState.se) || {};
  const status = runtime.status || (cfg.configured ? 'reconnecting' : 'unconfigured');
  const [txt, cls] = SE_TEXT[status] || SE_TEXT.unconfigured;
  const label = status === 'error' && runtime.error ? 'خطا: ' + runtime.error : txt;
  const configured = !!cfg.configured;

  if ($('#seChip')) {
    $('#seChip').textContent = label;
    $('#seChip').className = cls;
  }
  if ($('#hSe')) {
    $('#hSe').textContent = label;
    $('#hSe').className = cls;
  }
  if ($('#hSeRow')) $('#hSeRow').hidden = !configured;
  if ($('#stSe')) {
    $('#stSe').hidden = !configured;
    $('#stSe').className = 'status-pill' + (status === 'connected' ? ' on' : configured ? ' warn' : '');
  }
  if ($('#seAccount')) {
    $('#seAccount').textContent = configured
      ? (cfg.username || '—') + (cfg.provider ? ' (' + cfg.provider + ')' : '')
      : 'وصل نشده';
  }
  if ($('#seSecret')) {
    $('#seSecret').textContent = configured
      ? cfg.secretStorage === 'os'
        ? 'ذخیره شده (رمزنگاری‌شده با سیستم‌عامل)'
        : 'متن ساده ذخیره شده (رمزنگاری سیستم‌عامل در دسترس نیست)'
      : 'وارد نشده';
  }
  if ($('#btnSeDisconnect')) $('#btnSeDisconnect').disabled = !configured;
}

function renderDonofa() {
  const cfg = (state.cfg && state.cfg.donofa) || {};
  const runtime = (state.runtimeState && state.runtimeState.donofa) || {};
  const configured = !!cfg.configured;
  const status = runtime.status || (configured ? 'reconnecting' : 'unconfigured');
  const [txt, cls] = SE_TEXT[status] || SE_TEXT.unconfigured;
  const label = status === 'error' && runtime.error ? 'خطا: ' + runtime.error : txt;
  for (const id of ['#donofaChip', '#hDonofa']) {
    if ($(id)) {
      $(id).textContent = label;
      $(id).className = cls;
    }
  }
  if ($('#hDonofaRow')) $('#hDonofaRow').hidden = !configured;
  if ($('#stDonofa')) {
    $('#stDonofa').hidden = !configured;
    $('#stDonofa').className = 'status-pill' + (status === 'connected' ? ' on' : configured ? ' warn' : '');
  }
  if ($('#donofaSecret'))
    $('#donofaSecret').textContent = configured
      ? cfg.secretStorage === 'os'
        ? 'کلید ذخیره و رمزنگاری شده است.'
        : 'کلید در فایل تنظیمات محلی ذخیره شده است.'
      : '';
  if ($('#donofaConnected')) $('#donofaConnected').hidden = !configured;
  if ($('#donofaKeyLabel')) $('#donofaKeyLabel').textContent = configured ? 'کلید API جدید' : 'کلید API';
  if ($('#btnDonofaSetup')) $('#btnDonofaSetup').textContent = configured ? 'تغییر اتصال' : 'اتصال به Donofa';
  renderDonofaBridge();
}

function renderDonofaBridge() {
  const cfg = (state.cfg && state.cfg.donofa) || {};
  const st = (state.runtimeState && state.runtimeState.donofaBridge) || {};
  const enabled = cfg.timer === true || cfg.goal === true;
  const status = !cfg.configured ? 'unconfigured' : !enabled ? 'off' : st.status || 'connecting';
  const [text, cls] = status === 'off' ? ['خاموش', 'chip'] : SE_TEXT[status] || SE_TEXT.unconfigured;
  $('#dfBridgeChip').textContent = text;
  $('#dfBridgeChip').className = cls;
  for (const [id, key] of [
    ['#dfTimerOn', 'timer'],
    ['#dfGoalOn', 'goal']
  ]) {
    // State pushes must not undo a checkbox while its save is in flight.
    if (!$(id).dataset.saving) $(id).checked = cfg[key] === true;
    $(id).disabled = !cfg.configured || !!$(id).dataset.saving;
  }
  $('#btnDfRefresh').disabled = !cfg.configured || !enabled;
  const g = st.goal,
    tm = st.timer;
  const unit = g && (g.unit === 'USD' ? ' دلار' : g.unit === 'PIECE' ? ' عدد' : ' تومان');
  $('#dfGoal').textContent =
    !enabled || !cfg.configured
      ? '—'
      : g
        ? g.title +
          ': ' +
          faNum(g.progress) +
          ' از ' +
          faNum(g.total) +
          unit +
          (g.total ? ' (' + faNum(Math.floor((g.progress / g.total) * 100)) + '٪)' : '')
        : 'هدفی در دونوفا ساخته نشده';
  const duration = sec => {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60);
    return h ? faNum(h) + ' ساعت و ' + faNum(m) + ' دقیقه' : faNum(m) + ' دقیقه و ' + faNum(sec % 60) + ' ثانیه';
  };
  const timerStatus = { running: 'در حال اجرا', paused: 'متوقف', finished: 'تمام شده' };
  $('#dfTimer').textContent =
    !enabled || !cfg.configured
      ? '—'
      : tm
        ? (timerStatus[tm.status] || tm.status) +
          (['running', 'paused'].includes(tm.status) ? ' · ' + duration(tm.remaining) + ' مانده' : '') +
          (tm.rate ? ' · هر ' + faNum(tm.rate.amount) + ' تومان = ' + faNum(tm.rate.seconds) + ' ثانیه' : '')
        : 'تایمری در دونوفا ساخته نشده';
  $('#dfQueue').textContent = faNum(st.queue || 0);
  const notes = [];
  if (enabled && st.error) notes.push(st.error);
  if (cfg.timer === true && tm && !['running', 'paused'].includes(tm.status))
    notes.push('تایمر دونوفا فعال نیست؛ ابتدا در پنل دونوفا شروعش کن.');
  if (enabled && ((g && g.subKick) || (tm && tm.subKick)))
    notes.push(
      'کلید «ساب کیک» هدف یا تایمر دونوفا روشن است؛ برای جلوگیری از دوباره‌شماری آن را در پنل دونوفا خاموش کن.'
    );
  $('#dfNote').textContent = notes.join(' ');
  $('#dfNote').hidden = !notes.length;
  const kinds = { tip: 'دونیت', sub: 'ساب', gift: 'ساب‌گیفت', kicks: 'KICKs' };
  const reasons = {
    'no-timer': 'تایمر فعال نیست',
    'no-rate': 'نرخ تایمر خاموش',
    'no-goal': 'هدف فعال نیست',
    'not-counted': 'در هدف تعدادی شمرده نمی‌شود',
    completed: 'هدف تکمیل شده',
    off: 'خاموش'
  };
  const recent = $('#dfRecent');
  recent.textContent = '';
  for (const r of (cfg.configured && st.recent) || []) {
    const line = document.createElement('div'),
      name = document.createElement('b'),
      value = document.createElement('span');
    line.className = 'kv';
    name.textContent = (kinds[r.kind] || r.kind) + ' · ' + (r.name || 'ناشناس');
    value.textContent =
      (r.timerNote ? 'تایمر: ' + (reasons[r.timerNote] || r.timerNote) : '+' + faNum(r.seconds) + ' ثانیه') +
      ' · ' +
      (r.goalNote ? 'هدف: ' + (reasons[r.goalNote] || r.goalNote) : '+' + faNum(Math.round(r.goal)) + ' به هدف');
    line.append(name, value);
    recent.append(line);
  }
}

function fillApp() {
  const info = state.info;
  const cfg = state.cfg;
  if ($('#appVer')) $('#appVer').value = info ? info.version + ' · Electron ' + info.electron : state.version || '—';
  if ($('#dataDir')) $('#dataDir').value = info ? info.dataDir : '';
  if ($('#autostart')) {
    $('#autostart').checked = !!(info && info.autostart);
    $('#autostart').disabled = !DESK;
  }
  if ($('#updCheck')) {
    $('#updCheck').checked = !(cfg && cfg.app && cfg.app.updateCheck === false);
    $('#updCheck').disabled = !DESK;
  }
  if ($('#recordHistory')) $('#recordHistory').checked = !(cfg && cfg.app && cfg.app.recordHistory === false);
  if ($('#btnOpenData')) $('#btnOpenData').disabled = !DESK;
  if ($('#btnOpenLog')) $('#btnOpenLog').disabled = !DESK;
  if ($('#btnClearData')) $('#btnClearData').disabled = !DESK;

  if ($('#abVer')) {
    $('#abVer').textContent = info
      ? `${info.version} · Electron ${info.electron} · Chromium ${info.chrome}`
      : state.version || '—';
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
    renderSe();
    renderDonofa();
  }

  if ($('#stOv')) $('#stOv').className = 'status-pill' + (s.overlays > 0 ? ' on' : ' warn');
  if ($('#stOvN')) $('#stOvN').textContent = faNum(s.overlays);
  if ($('#hOv')) $('#hOv').textContent = faNum(s.overlays);
  if ($('#hMode')) $('#hMode').textContent = s.mode === 'standalone' ? 'جایگزین ویجت' : 'کنار ویجت';

  if ($('#sPlaying')) {
    $('#sPlaying').innerHTML = s.playing
      ? `<span class="chip on">${esc(s.playing.name)} · ${esc(displayedAmount(s.playing))}</span>`
      : '—';
  }
  if ($('#sApproved')) $('#sApproved').textContent = faNum(s.approved);
  if ($('#sPending')) $('#sPending').textContent = faNum(s.pending);
  if ($('#sQueue')) $('#sQueue').textContent = s.queueStatus === 'play' ? 'در حال پخش' : 'متوقف';

  const pauseBtn = $('#btnPauseQueue');
  if (pauseBtn) {
    const isPaused = s.queueStatus !== 'play';
    pauseBtn.dataset.paused = isPaused ? '1' : '0';
    pauseBtn.textContent = isPaused ? '▶ از سرگیری صف' : '⏸ توقف صف';
  }

  if ($('#sDelay')) $('#sDelay').textContent = faNum(s.queueDelay) + ' ثانیه';
  if ($('#hRate')) $('#hRate').textContent = s.rate ? faNum(s.rate) : '—';
  renderProxy();

  if ($('#hRateMeta')) {
    $('#hRateMeta').textContent = s.rateManual
      ? 'دستی'
      : s.rateUpdatedAt
        ? rateSourceLabel(s.rateSource) +
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
      d.innerHTML = `<span class="a">${t.kind === 'command' ? 'دستور چت' : esc(displayedAmount(t))}</span><b>${esc(t.name || '')}</b>${
        t.kind === 'gift'
          ? '<span class="chip">🎁 ' + faNum(t.count) + ' ساب‌گیفت</span>'
          : t.kind === 'sub'
            ? '<span class="chip">⭐ ساب</span>'
            : t.kind === 'command'
              ? '<span class="chip acc">⌨️ دستور</span>'
              : ''
      }${sourceLabel(t.source) ? '<span class="chip">' + esc(sourceLabel(t.source)) + '</span>' : ''}<span class="m">${esc(t.message || '')}</span><span class="chip">${
        t.media ? esc(t.media) : 'بدون فایل'
      }</span>${t.test ? '<span class="chip warn">تست</span>' : ''}`;
      rc.appendChild(d);
    });
  }
}

function renderRate() {
  const r = (state.cfg && state.cfg.rate) || {};
  const eff = Number(r.manual) > 0 ? Number(r.manual) : r.value || 0;
  if ($('#rateVal')) $('#rateVal').textContent = eff ? faNum(eff) + ' تومان' : '—';
  if ($('#rateMeta')) {
    $('#rateMeta').textContent =
      Number(r.manual) > 0
        ? '(دستی)'
        : r.updatedAt
          ? rateSourceLabel(r.source) + ' · ' + new Date(r.updatedAt).toLocaleTimeString('fa-IR')
          : 'هنوز دریافت نشده';
  }
  if ($('#rateAuto')) $('#rateAuto').checked = r.auto !== false;
  if ($('#rateInt')) $('#rateInt').value = r.intervalMin || 2;
  if ($('#rateManual')) $('#rateManual').value = r.manual || '';
  if ($('#rateProxy')) $('#rateProxy').value = r.proxy || '';
  if ($('#fxMeta')) {
    const currencies = Object.keys(r.fx || {}).sort();
    $('#fxMeta').textContent = currencies.length
      ? 'ارزهای دارای نرخ تبدیل: ' +
        currencies.join('، ') +
        (r.fxSource ? ' · منبع: ' + rateSourceLabel(r.fxSource) : '')
      : 'نرخ تبدیل ارزهای دیگر هنوز دریافت نشده.';
  }
  renderProxy();
}

// the detected Windows system proxy under the manual-proxy field (updated on every state push, so toggling the VPN refreshes it live)
function renderProxy() {
  const s = state.runtimeState;
  if ($('#sysProxy'))
    $('#sysProxy').textContent =
      s && s.systemProxy
        ? 'پراکسی سیستم ویندوز: ' +
          s.systemProxy +
          ' — اگر کادر بالا خالی باشد، برای kick.com و منابع نرخ خودکار از همین استفاده می‌شود.'
        : 'پراکسی سیستم ویندوز پیدا نشد. اگر VPN در حالت TUN است یا kick.com بدون VPN باز می‌شود، نیازی به پراکسی نیست.';
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

let filesRefresh;
let filesRefreshPending = false;

function refreshFiles() {
  filesRefreshPending = true;
  if (filesRefresh) return filesRefresh;
  filesRefresh = (async () => {
    while (filesRefreshPending) {
      filesRefreshPending = false;
      try {
        const r = await api('/api/config');
        // Another event invalidates this snapshot; fetch again before applying it.
        if (filesRefreshPending || !state.cfg || !Array.isArray(r?.config?.files)) continue;
        state.cfg.files = r.config.files;
        if (state.selectedId && !state.cfg.files.some(f => f.id === state.selectedId)) closeInspector();
        renderFiles();
      } catch {}
    }
  })().finally(() => {
    filesRefresh = null;
    if (filesRefreshPending) return refreshFiles();
  });
  return filesRefresh;
}

// Targeted Server-Sent Events listener (Zero Redundant Polling)
function connectEvents(reconnecting = false) {
  const es = new EventSource('/events?role=admin');
  es.onopen = () => {
    if (reconnecting) refreshFiles();
  };
  es.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data);
      if (window.ANALYTICS) window.ANALYTICS.onEvent(d);
      if (d.type === 'state') {
        setRuntimeState(d.state);
        renderState();
      } else if (d.type === 'config') {
        if (state.cfg) {
          state.cfg.appearance = d.appearance;
          fillLook();
        }
      } else if (d.type === 'files_updated') {
        refreshFiles();
      } else if (d.type === 'goal_update') {
        if (state.cfg) state.cfg.goal = d.goal;
        fillGoal(d.goal);
      } else if (d.type === 'log') {
        addLog(d.entry);
      } else if (d.type === 'history_update') {
        renderHistoryLive(d);
      } else if (d.type === 'rate') {
        if (state.cfg) state.cfg.rate = d.rate;
        renderRate();
      }
    } catch {}
  };
  es.onerror = () => {
    es.close();
    setTimeout(() => connectEvents(true), 3000);
  };
}

// Global App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  document.body.classList.toggle('web', !DESK);
  initNav({
    onPageChange: name => {
      if (name === 'look') setTimeout(fitPreview, 40);
      if (name === 'home') loadSim();
      if (name === 'history') refreshHistory();
      if (name === 'analytics' && window.ANALYTICS) window.ANALYTICS.open();
      if (name === 'rules') fillRules();
      if (name === 'about' && !$('#docView').textContent) showDoc('PRIVACY.md');
      if (name !== 'files') closeInspector();
    }
  });

  initInspector({
    onUpdate: renderFiles,
    onDelete: () => {
      renderFiles();
      refreshFiles();
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

  initFiles({ onLoadNeeded: refreshFiles });
  initLook();
  initGoal();
  initHistory();
  initCommands();
  initRules();
  initControls({ onStateChange: renderState });
  initBackup({ onRestoreComplete: load });
  initUpdates();

  for (const [id, key] of [
    ['#dfTimerOn', 'timer'],
    ['#dfGoalOn', 'goal']
  ]) {
    $(id).onchange = async e => {
      const el = e.target,
        on = el.checked;
      el.dataset.saving = '1';
      el.disabled = true;
      try {
        if (await saveSettings({ donofa: { [key]: on } })) {
          state.cfg.donofa = { ...state.cfg.donofa, [key]: on };
          toast('ذخیره شد', 'ok');
        }
      } finally {
        delete el.dataset.saving;
        renderDonofaBridge();
      }
    };
  }
  $('#btnDfRefresh').onclick = async () => {
    const btn = $('#btnDfRefresh');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await post('/api/donofa/refresh');
      if (!r || r.ok === false) throw new Error(r && r.error);
      if (r.donofaBridge) state.runtimeState.donofaBridge = r.donofaBridge;
      renderDonofaBridge();
      toast('هدف و تایمر دونوفا به‌روز شد', 'ok');
    } catch (error) {
      toast(error.message || 'دریافت هدف و تایمر ناموفق بود', 'err');
    } finally {
      btn.setAttribute('aria-busy', 'false');
      renderDonofaBridge();
    }
  };

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

  if ($('#btnSeSetup')) {
    $('#btnSeSetup').onclick = async () => {
      const btn = $('#btnSeSetup');
      const msg = $('#seMsg');
      const token = $('#seToken').value.trim();
      if (!token) {
        toast('توکن JWT را وارد کنید', 'err');
        return;
      }
      btn.disabled = true;
      if (msg) msg.textContent = 'در حال بررسی اتصال…';
      try {
        const r = await post('/api/se/setup', { token });
        if (r && r.ok) {
          $('#seToken').value = '';
          if (msg) msg.textContent = 'انجام شد: ' + (r.username || '') + (r.provider ? ' (' + r.provider + ')' : '');
          toast('StreamElements وصل شد', 'ok');
          await load();
        } else {
          if (msg) msg.textContent = (r && r.error) || 'خطا در اتصال StreamElements';
          toast((r && r.error) || 'خطا در اتصال StreamElements', 'err');
        }
      } catch (err) {
        if (msg) msg.textContent = 'ارتباط با سرور برقرار نشد';
        toast('ارتباط با سرور برقرار نشد', 'err');
      } finally {
        btn.disabled = false;
      }
    };
  }

  if ($('#btnSeDisconnect')) {
    $('#btnSeDisconnect').onclick = async () => {
      const ok = await spConfirm({
        title: 'قطع اتصال StreamElements',
        body: 'اتصال StreamElements قطع و توکن ذخیره‌شده حذف شود؟',
        confirmText: 'قطع اتصال',
        cancelText: 'انصراف',
        icon: '#i-x',
        danger: true
      });
      if (!ok) return;
      try {
        const r = await post('/api/se/disconnect');
        if (r && r.ok) {
          toast('اتصال StreamElements حذف شد', 'ok');
          await load();
        } else toast((r && r.error) || 'قطع اتصال ناموفق بود', 'err');
      } catch {
        toast('قطع اتصال ناموفق بود', 'err');
      }
    };
  }

  if ($('#btnDonofaSetup')) {
    $('#btnDonofaSetup').onclick = async () => {
      const btn = $('#btnDonofaSetup');
      const key = $('#donofaKey').value.trim();
      if (!key) return toast('کلید API دونوفا را وارد کنید', 'err');
      btn.disabled = true;
      $('#donofaMsg').textContent = 'در حال بررسی کلید…';
      $('#donofaMsg').dataset.state = '';
      try {
        const r = await post('/api/donofa/setup', { key, endpoint: $('#donofaEndpoint').value });
        if (!r || !r.ok) throw new Error((r && r.error) || 'اتصال ناموفق بود');
        $('#donofaKey').value = '';
        $('#donofaMsg').textContent = 'کلید تأیید شد';
        $('#donofaMsg').dataset.state = 'success';
        toast('Donofa وصل شد', 'ok');
        await load();
      } catch (error) {
        $('#donofaMsg').textContent = error.message || 'اتصال ناموفق بود';
        $('#donofaMsg').dataset.state = 'error';
        toast('اتصال Donofa ناموفق بود', 'err');
      } finally {
        btn.disabled = false;
      }
    };
    $('#donofaKey').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('#btnDonofaSetup').click();
      }
    });
  }
  if ($('#btnDonofaDisconnect')) {
    $('#btnDonofaDisconnect').onclick = async () => {
      const ok = await spConfirm({
        title: 'قطع اتصال Donofa',
        body: 'اتصال Donofa قطع و کلید ذخیره‌شده حذف شود؟',
        confirmText: 'قطع اتصال',
        cancelText: 'انصراف',
        icon: '#i-x',
        danger: true
      });
      if (!ok) return;
      try {
        const r = await post('/api/donofa/disconnect');
        if (r && r.ok) {
          $('#donofaMsg').textContent = '';
          $('#donofaMsg').dataset.state = '';
          toast('اتصال Donofa حذف شد', 'ok');
          await load();
        } else toast((r && r.error) || 'قطع اتصال ناموفق بود', 'err');
      } catch {
        toast('قطع اتصال ناموفق بود', 'err');
      }
    };
  }

  if ($('#btnSaveKick')) {
    $('#btnSaveKick').onclick = async () => {
      if (
        !(await saveSettings({
          kick: {
            enabled: $('#kEnabled').checked,
            channel: $('#kChannel').value.trim(),
            giftValueToman: Number($('#kGift').value) || 0,
            subValueToman: Number($('#kSub').value) || 0,
            showNewSubs: $('#kShowSubs').checked
          }
        }))
      )
        return;
      toast('ذخیره شد', 'ok');
      setTimeout(load, 1200);
    };
  }

  if ($('#btnSaveRate')) {
    $('#btnSaveRate').onclick = async () => {
      if (
        !(await saveSettings({
          rate: {
            auto: $('#rateAuto').checked,
            manual: $('#rateManual').value,
            intervalMin: $('#rateInt').value,
            proxy: $('#rateProxy').value
          }
        }))
      )
        return;
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

  const meldButtons = [$('#hMeld'), $('#btnMeld')].filter(Boolean);
  let meldReloading = false;
  const meldReload = async () => {
    if (meldReloading) return;
    meldReloading = true;
    const disabled = meldButtons.map(button => button.disabled);
    meldButtons.forEach(button => (button.disabled = true));
    const failure = 'ری‌لود Meld ناموفق بود؛ اتصال Meld و لایه‌های Browser را بررسی کنید و دوباره تلاش کنید';
    try {
      const result = await settingsRequest('/api/meld-reload');
      if (result.ok === true) toast('لایه‌های Meld ری‌لود شدند', 'ok');
      else toast(result.error && result.error !== SETTINGS_SAVE_ERROR ? result.error : failure, 'err');
    } catch {
      toast(failure, 'err');
    } finally {
      meldButtons.forEach((button, index) => (button.disabled = disabled[index]));
      meldReloading = false;
    }
  };
  meldButtons.forEach(button => (button.onclick = meldReload));

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
      const result = await settingsRequest('/api/reset-settings');
      if (!result.ok) return toast(result.error, 'err');
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
  if ($('#btnClearLog'))
    $('#btnClearLog').onclick = () => {
      if ($('#log')) $('#log').innerHTML = '';
    };

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
      const requested = e.target.checked;
      e.target.disabled = true;
      try {
        const r = await window.sahne.app.autostart(requested);
        e.target.checked = !!r;
        if (state.info) state.info.autostart = !!r;
        toast(r ? 'اجرای خودکار فعال شد' : 'اجرای خودکار غیرفعال شد', 'ok');
      } catch {
        e.target.checked = !requested;
        try {
          e.target.checked = !!(await window.sahne.app.autostart());
        } catch {}
        if (state.info) state.info.autostart = e.target.checked;
        toast(SETTINGS_SAVE_ERROR, 'err');
      } finally {
        e.target.disabled = false;
      }
    };
  }

  if ($('#updCheck')) {
    $('#updCheck').onchange = async e => {
      if (!(await saveSettings({ app: { updateCheck: e.target.checked } }))) {
        e.target.checked = !e.target.checked;
        return;
      }
      toast(e.target.checked ? 'بررسی خودکار آپدیت روشن شد' : 'بررسی خودکار آپدیت خاموش شد', 'ok');
    };
  }
  if ($('#recordHistory')) {
    $('#recordHistory').onchange = async e => {
      if (!(await saveSettings({ app: { recordHistory: e.target.checked } }))) {
        e.target.checked = !e.target.checked;
        return;
      }
      load();
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
      if (
        !(await saveSettings({
          mode: $('#mode').value,
          showAlertWithoutMedia: $('#showNoMedia').checked
        }))
      )
        return;
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

// Desktop update discovery; downloads and verification remain in the main process.
import { $, DESK, faNum, toast, spConfirm } from './api.js';

export function initUpdates() {
  const desktop = DESK && !!window.sahne.update;
  let update = null,
    dismissed = null,
    starting = false;
  const render = next => {
    if (next) update = next;
    const st = update?.status;
    const v = update?.latest || '';
    const busy = starting || ['downloading', 'ready', 'installing'].includes(st);
    const checking = st === 'checking';
    const available = desktop && st === 'available';
    const progress = Math.min(100, Math.max(0, Number(update?.progress) || 0));
    const visible = desktop && (available || ['downloading', 'ready', 'installing'].includes(st));
    const labels = {
      idle: 'هنوز بررسی نشده',
      checking: 'در حال بررسی…',
      uptodate: 'به‌روز است (' + (update?.current || '') + ')',
      available: 'نسخه‌ی ' + v + ' آمده',
      downloading: 'در حال دانلود نسخه‌ی ' + v + '… ' + faNum(progress) + '٪',
      ready: 'نسخه‌ی ' + v + ' دانلود و با چک‌سام رسمی بررسی شد (حالت تست؛ نصب نمی‌شود).',
      installing: 'در حال نصب نسخه‌ی ' + v + '… برنامه چند ثانیه بسته و دوباره باز می‌شود.',
      error: update?.error || 'بررسی آپدیت ناموفق بود؛ دوباره تلاش کنید'
    };
    $('#abUpd').textContent = !desktop ? 'فقط در برنامه‌ی دسکتاپ' : labels[st] || '—';
    $('#updBar').hidden = !visible || (available && dismissed === v);
    $('#updText').textContent = available
      ? 'نسخه‌ی جدید صحنه پرومکس (' + v + ') آماده است.' + (update.error ? ' ' + update.error : '')
      : labels[st] || '';
    $('#updGo').disabled = !available || busy;
    $('#updGo').textContent = (update?.canInstall ? 'نصب نسخه‌ی ' : 'دانلود نسخه‌ی ') + v;
    $('#updLater').hidden = busy;
    $('#updNotes').disabled = !update?.page;
    $('#updBar').setAttribute('aria-busy', String(busy));
    $('#railUpd').hidden = !visible;
    $('#railUpd').disabled = !available || busy;
    $('#railUpd').classList.toggle('busy', busy);
    $('#railUpd').setAttribute('aria-busy', String(busy));
    $('#railUpdTitle').textContent = starting
      ? 'در حال شروع آپدیت…'
      : st === 'downloading'
        ? 'در حال دانلود… ' + faNum(progress) + '٪'
        : st === 'installing'
          ? 'در حال نصب…'
          : st === 'ready'
            ? 'دانلود شد'
            : 'نسخه‌ی جدید آمده';
    $('#railUpdSub').textContent =
      'نسخه‌ی ' + v + (available ? ' · ' + (update.canInstall ? 'کلیک برای نصب' : 'دانلود از GitHub') : '');
    $('#railUpdProg').style.width = (['ready', 'installing'].includes(st) ? 100 : progress) + '%';
    $('#abInstall').hidden = !available;
    $('#abInstall').disabled = busy;
    $('#abInstallText').textContent = (update?.canInstall ? 'نصب نسخه‌ی ' : 'دانلود از GitHub: نسخه‌ی ') + v;
    $('#abCheckUpd').disabled = !desktop || checking || busy;
    $('#abCheckUpd').classList.toggle('checking', checking);
    $('#abCheckUpd').setAttribute('aria-busy', String(checking));
    $('#abCheckText').textContent = checking ? 'در حال بررسی…' : 'بررسی آپدیت';
  };
  render();
  if (!desktop) return;
  window.sahne.update.onStatus(render);
  window.sahne.update
    .get()
    .then(render)
    .catch(() => render({ status: 'error' }));
  const start = async () => {
    if (starting || update?.status !== 'available') return;
    const candidate = update;
    starting = true;
    render();
    try {
      if (!candidate.canInstall) {
        if (candidate.page) await window.sahne.app.openExternal(candidate.page);
        return;
      }
      const ok = await spConfirm({
        title: 'آپدیت صحنه پرومکس',
        body:
          'نسخه‌ی ' +
          candidate.latest +
          ' دانلود و نصب شود؟ برنامه چند ثانیه بسته و دوباره باز می‌شود؛ تنظیمات و فایل‌ها سر جایشان می‌مانند.',
        confirmText: 'آپدیت',
        cancelText: 'انصراف',
        icon: '#i-refresh'
      });
      if (!ok || update.status !== 'available' || update.latest !== candidate.latest) return;
      render({ ...update, status: 'downloading', progress: 0 });
      const result = await window.sahne.update.install();
      if (!result) throw new Error('شروع آپدیت ناموفق بود؛ دوباره تلاش کنید');
      render(result);
    } catch (error) {
      render({ ...candidate, status: 'available', error: error.message || 'شروع آپدیت ناموفق بود' });
      toast(update.error, 'err');
    } finally {
      starting = false;
      render();
    }
  };
  for (const id of ['#updGo', '#railUpd', '#abInstall']) $(id).onclick = start;
  $('#updNotes').onclick = () => update?.page && window.sahne.app.openExternal(update.page);
  $('#updLater').onclick = () => {
    dismissed = update?.latest;
    render();
    $('#railUpd').focus();
  };
  $('#abCheckUpd').onclick = async () => {
    if (starting || ['checking', 'downloading', 'ready', 'installing'].includes(update?.status)) return;
    const before = update;
    dismissed = null;
    render({ ...update, status: 'checking' });
    try {
      const result = await window.sahne.update.check();
      if (!result) throw new Error('بررسی آپدیت ناموفق بود؛ دوباره تلاش کنید');
      render(result);
      if (result.status === 'uptodate') toast('صحنه پرومکس به‌روز است', 'ok');
      else if (result.status === 'available') {
        toast('نسخه‌ی ' + result.latest + ' آمده است؛ نصب در نوار کناری و کنار «بررسی آپدیت» در دسترس است', 'ok');
        $('#updBar').classList.remove('flash');
        void $('#updBar').offsetWidth;
        $('#updBar').classList.add('flash');
      } else toast(result.error || 'بررسی آپدیت ناموفق بود', 'err');
    } catch (error) {
      const message = error.message || 'بررسی آپدیت ناموفق بود';
      render(
        before?.status === 'available' ? { ...before, error: message } : { ...before, status: 'error', error: message }
      );
      toast(message, 'err');
    }
  };
}

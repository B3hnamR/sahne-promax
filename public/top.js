// Sahne ProMax — Top Donors OBS widget. Bootstrap via /api/top, then refresh on every alert (SSE role "top").
// Query params: ?range=daily|weekly|all&limit=1..20&title=...
'use strict';

(function () {
  const qs = new URLSearchParams(location.search);
  const range = ['daily', 'weekly', 'all'].includes(qs.get('range')) ? qs.get('range') : 'all';
  const limit = Math.min(20, Math.max(1, Number(qs.get('limit')) || 5));
  const title = qs.get('title');

  const listEl = document.getElementById('top-list');
  const emptyEl = document.getElementById('top-empty');
  const rangeEl = document.getElementById('top-range');
  const faDigits = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const LABELS = { daily: 'امروز', weekly: '۷ روز اخیر', all: 'همه‌وقت' };
  const MEDALS = ['🥇', '🥈', '🥉'];

  if (title) document.getElementById('top-title').textContent = title.slice(0, 60);
  rangeEl.textContent = LABELS[range];

  function fmtToman(n) {
    const t = Number(n || 0);
    if (t >= 1000000) return faDigits((t / 1000000).toFixed(t % 1000000 === 0 ? 0 : 1).replace('.', '٫')) + ' م تومان';
    if (t >= 1000)
      return (
        faDigits(
          Math.round(t / 1000)
            .toLocaleString('en-US')
            .replace(/,/g, '٬')
        ) + ' ه تومان'
      );
    return faDigits(Math.round(t).toLocaleString('en-US').replace(/,/g, '٬')) + ' تومان';
  }

  function render(donors) {
    listEl.innerHTML = '';
    emptyEl.hidden = donors.length > 0;
    donors.forEach((d, i) => {
      const li = document.createElement('li');
      li.className = 'top-row' + (i < 3 ? ' top-' + (i + 1) : '');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = MEDALS[i] || faDigits(String(d.rank || i + 1));
      const name = document.createElement('span');
      name.className = 'name';
      name.dir = 'auto';
      name.textContent = d.name || 'ناشناس';
      const amt = document.createElement('span');
      amt.className = 'amt';
      amt.textContent = fmtToman(d.toman);
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(amt);
      listEl.appendChild(li);
    });
  }

  async function refresh() {
    try {
      const r = await fetch('/api/top?range=' + range + '&limit=' + limit);
      const j = await r.json();
      render(Array.isArray(j.donors) ? j.donors : []);
    } catch {}
  }

  function connect() {
    const es = new EventSource('/events?role=top');
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === 'history_update') refresh();
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setTimeout(connect, 3000);
    };
  }

  refresh();
  connect();
  setInterval(refresh, 60000); // fallback when nothing is streaming
})();

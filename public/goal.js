'use strict';

(function () {
  const titleEl = document.getElementById('goal-title');
  const percentEl = document.getElementById('goal-percent');
  const barEl = document.getElementById('goal-bar');
  const currentEl = document.getElementById('goal-current');
  const targetEl = document.getElementById('goal-target');
  const container = document.getElementById('goal-widget');
  const celebration = document.getElementById('celebration');
  const confettiHolder = document.getElementById('confetti');
  const timerEl = document.getElementById('goal-timer');
  const timerValEl = document.getElementById('goal-timer-val');
  const countersEl = document.getElementById('goal-counters');

  let wasReached = false;
  let timerDeadline = null,
    timerOffset = 0,
    timerInterval = null,
    timerExpired = false;

  const faDigits = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

  function fmtToman(n) {
    const num = Number(n || 0);
    const s = Math.round(num).toLocaleString('en-US');
    return faDigits(s.replace(/,/g, '٬')) + ' تومان';
  }

  function updateWidget(goal) {
    if (!goal) return;

    if (goal.title) {
      titleEl.textContent = goal.title;
    }

    // Timed goal: live countdown under the bar (serverNow corrects for a skewed client clock)
    if (timerEl && goal.mode === 'timed' && Number(goal.deadline) > 0) {
      timerDeadline = Number(goal.deadline);
      timerOffset = Number(goal.serverNow || Date.now()) - Date.now();
      timerExpired = false;
      container.classList.remove('expired');
      timerEl.hidden = false;
      startTimer();
    } else if (timerEl) {
      timerDeadline = null;
      timerEl.hidden = true;
      stopTimer();
    }

    const current = Math.max(0, Number(goal.currentToman || 0));
    const target = Math.max(1, Number(goal.targetToman || 1));
    const rawPct = (current / target) * 100;
    const clampedPct = Math.min(100, Math.max(0, rawPct));

    percentEl.textContent = faDigits(Math.round(clampedPct)) + '%';
    barEl.style.width = clampedPct + '%';

    currentEl.textContent = fmtToman(current);
    targetEl.textContent = fmtToman(target);

    // Live counters (subs / gift-subs / subs today) — hidden when off or still all zero
    if (countersEl) {
      const subs = Math.max(0, Number(goal.subCount || 0));
      const gifts = Math.max(0, Number(goal.giftSubCount || 0));
      const today = Math.max(0, Number(goal.subsToday || 0));
      const visible = goal.showCounters !== false && (subs > 0 || gifts > 0 || today > 0);
      countersEl.hidden = !visible;
      const set = (id, valId, n) => {
        const el = document.getElementById(id);
        const val = document.getElementById(valId);
        if (el) el.hidden = n <= 0;
        if (val) val.textContent = faDigits(String(n));
      };
      set('gc-subs', 'gc-subs-val', subs);
      set('gc-gifts', 'gc-gifts-val', gifts);
      set('gc-today', 'gc-today-val', today);
    }

    const isReached = current >= target;
    if (isReached) {
      container.classList.add('reached');
      if (!wasReached) {
        triggerCelebration();
      }
    } else {
      container.classList.remove('reached');
    }
    wasReached = isReached;
  }

  function triggerCelebration() {
    celebration.hidden = false;
    confettiHolder.innerHTML = '';

    const colors = ['#10b981', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#ffffff'];

    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = 2 + Math.random() * 2 + 's';
      p.style.animationDelay = Math.random() * 0.5 + 's';
      p.style.width = 6 + Math.random() * 6 + 'px';
      p.style.height = 6 + Math.random() * 6 + 'px';
      confettiHolder.appendChild(p);
    }

    setTimeout(() => {
      celebration.hidden = true;
      confettiHolder.innerHTML = '';
    }, 4500);
  }

  // ---- timed goal countdown ----
  function fmtRemaining(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = n => String(n).padStart(2, '0');
    const clock = p(h) + ':' + p(m) + ':' + p(s);
    return d > 0 ? faDigits(String(d)) + ' روز ' + faDigits(clock) : faDigits(clock);
  }

  function tickTimer() {
    if (!timerDeadline || !timerValEl) return;
    const remaining = timerDeadline - (Date.now() + timerOffset);
    if (remaining <= 0) {
      timerExpired = true;
      timerValEl.textContent = 'زمان تمام شد';
      container.classList.add('expired');
      stopTimer();
      return;
    }
    timerValEl.textContent = fmtRemaining(remaining);
  }

  function startTimer() {
    if (timerExpired) return;
    tickTimer();
    if (timerInterval || timerExpired) return;
    timerInterval = setInterval(tickTimer, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Fetch initial goal via REST
  fetch('/api/goal')
    .then(r => r.json())
    .then(data => {
      if (data && data.goal) {
        updateWidget(data.goal);
      }
    })
    .catch(() => {});

  // Real-time SSE listener
  function connect() {
    const es = new EventSource('/events?role=goal');

    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === 'goal_update' && d.goal) {
          updateWidget(d.goal);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setTimeout(connect, 3000);
    };
  }

  connect();
})();

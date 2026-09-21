'use strict';

// Local (streamer machine) calendar-day helpers, shared by the goal milestones and the history ledger.
function localDayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function startOfDay(ms) {
  const d = new Date(Number(ms) || Date.now());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

module.exports = {
  localDayKey,
  startOfDay
};

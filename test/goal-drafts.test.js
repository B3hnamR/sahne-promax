'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const originalGoal = {
  title: 'Original goal',
  targetToman: 5000000,
  currentToman: 100,
  autoIncrement: true,
  mode: 'amount',
  deadline: null,
  confettiOnComplete: true,
  confettiOnFirstSub: true,
  milestoneToman: 1000,
  showCounters: true
};

function fixture() {
  const fields = Object.fromEntries(
    [
      'gTitle',
      'gTarget',
      'gCurrent',
      'gAutoReset',
      'gTimed',
      'gDeadline',
      'gConfettiDone',
      'gConfettiSub',
      'gMilestone',
      'gCounters',
      'gDeadlineRow',
      'gCurrentLbl',
      'gTargetLbl',
      'btnSaveGoal',
      'btnResetGoal'
    ].map(id => [id, { value: '', checked: false, hidden: false, textContent: '' }])
  );
  const requests = [];
  const feedback = [];
  const context = vm.createContext({
    window: { location: { port: '7788' } },
    document: { activeElement: null },
    $: selector => fields[selector.slice(1)] || null,
    settingsRequest: (route, body) => new Promise(resolve => requests.push({ route, body, resolve })),
    toast: (message, kind) => feedback.push({ message, kind }),
    copyText() {},
    fmtToman: value => String(value),
    spConfirm: async () => true
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'goal.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  context.initGoal();
  context.fillGoal(originalGoal);
  return { fields, requests, feedback, fill: context.fillGoal };
}

test('live goal updates preserve unfocused drafts in every field while labels stay live', () => {
  const { fields, fill } = fixture();
  const drafts = {
    gTitle: 'Unsaved title',
    gTarget: '9000000',
    gCurrent: '42',
    gDeadline: '2099-03-04T12:30',
    gMilestone: '2000'
  };
  for (const [id, value] of Object.entries(drafts)) fields[id].value = value;
  for (const id of ['gAutoReset', 'gConfettiDone', 'gConfettiSub', 'gCounters']) fields[id].checked = false;
  fields.gTimed.checked = true;
  fields.gTimed.onchange();
  for (const currentToman of [200, 300]) fill({ ...originalGoal, currentToman, targetToman: 6000000 });
  for (const [id, value] of Object.entries(drafts)) assert.equal(fields[id].value, value, id);
  for (const id of ['gAutoReset', 'gConfettiDone', 'gConfettiSub', 'gCounters'])
    assert.equal(fields[id].checked, false, id);
  assert.equal(fields.gTimed.checked, true);
  assert.equal(fields.gDeadlineRow.hidden, false);
  assert.equal(fields.gCurrentLbl.textContent, '300');
  assert.equal(fields.gTargetLbl.textContent, '6000000');
});

test('live goal updates refresh untouched fields independently of dirty fields', () => {
  const { fields, fill } = fixture();
  fields.gTitle.value = 'Draft';
  const goal = {
    ...originalGoal,
    targetToman: 7000000,
    currentToman: 200,
    autoIncrement: false,
    mode: 'timed',
    deadline: new Date(2099, 0, 2, 12, 30).getTime(),
    confettiOnComplete: false,
    confettiOnFirstSub: false,
    milestoneToman: 3000,
    showCounters: false
  };
  fill(goal);
  assert.equal(fields.gTitle.value, 'Draft');
  assert.equal(fields.gTarget.value, '7000000');
  assert.equal(fields.gCurrent.value, '200');
  assert.equal(fields.gMilestone.value, '3000');
  assert.equal(fields.gDeadline.value, '2099-01-02T12:30');
  assert.equal(fields.gTimed.checked, true);
  assert.equal(fields.gDeadlineRow.hidden, false);
  for (const id of ['gAutoReset', 'gConfettiDone', 'gConfettiSub', 'gCounters'])
    assert.equal(fields[id].checked, false, id);
  fill({ ...goal, currentToman: 300 });
  assert.equal(fields.gCurrent.value, '300', 'successive server baselines track DOM string values');
});

test('failed save retains the draft through subsequent live updates', async () => {
  const { fields, requests, feedback, fill } = fixture();
  fields.gTitle.value = 'Retry this draft';
  fields.gCurrent.value = '25';
  const pending = fields.btnSaveGoal.onclick();
  requests[0].resolve({ ok: false, error: 'Disk full' });
  await pending;
  fill({ ...originalGoal, currentToman: 500 });
  assert.equal(fields.gTitle.value, 'Retry this draft');
  assert.equal(fields.gCurrent.value, '25');
  assert.equal(fields.gCurrentLbl.textContent, '500');
  assert.equal(feedback.at(-1).kind, 'err');
});

test('successful save shows the normalized response and restores a live-update baseline', async () => {
  const { fields, requests, feedback, fill } = fixture();
  fields.gTitle.value = '  Saved title  ';
  fields.gTarget.value = '8000000';
  const pending = fields.btnSaveGoal.onclick();
  assert.equal(requests[0].route, '/api/goal');
  assert.equal(requests[0].body.title, 'Saved title');
  const saved = { ...originalGoal, title: 'Saved title', targetToman: 8000000 };
  // The broadcast may arrive before the request resolves.
  fill(saved);
  requests[0].resolve({ ok: true, goal: saved });
  await pending;
  assert.equal(fields.gTitle.value, 'Saved title');
  assert.equal(fields.gTarget.value, '8000000');
  assert.equal(feedback.at(-1).kind, 'ok');
  fill({ ...saved, title: 'Later server title', targetToman: 9000000, currentToman: 600 });
  assert.equal(fields.gTitle.value, 'Later server title');
  assert.equal(fields.gTarget.value, '9000000');
  assert.equal(fields.gCurrent.value, '600');
});

test('edits made during an async save survive its response and later broadcasts', async () => {
  const { fields, requests, fill } = fixture();
  fields.gTitle.value = 'Submitted';
  const pending = fields.btnSaveGoal.onclick();
  fields.gTitle.value = 'Newer draft';
  fields.gCurrent.value = '45';
  fields.gTarget.value = '7500000';
  fields.gAutoReset.checked = false;
  fields.gTimed.checked = true;
  fields.gDeadline.value = '2099-06-01T10:00';
  const saved = { ...originalGoal, title: 'Submitted' };
  requests[0].resolve({ ok: true, goal: saved });
  await pending;
  fill({ ...saved, currentToman: 700 });
  assert.equal(fields.gTitle.value, 'Newer draft');
  assert.equal(fields.gCurrent.value, '45');
  assert.equal(fields.gTarget.value, '7500000');
  assert.equal(fields.gAutoReset.checked, false);
  assert.equal(fields.gTimed.checked, true);
  assert.equal(fields.gDeadline.value, '2099-06-01T10:00');
  assert.equal(fields.gDeadlineRow.hidden, false);
  assert.equal(fields.gCurrentLbl.textContent, '700');
  fields.gTitle.value = saved.title;
  fill({ ...saved, title: 'Next title' });
  assert.equal(fields.gTitle.value, 'Next title', 'response became the baseline even for a preserved field');
});

test('reset applies its response without losing edits made while awaiting it', async () => {
  const { fields, requests, fill } = fixture();
  fields.gCurrent.value = '50';
  const pending = fields.btnResetGoal.onclick();
  await new Promise(setImmediate);
  assert.equal(requests[0].route, '/api/goal/reset');
  fields.gTitle.value = 'Draft during reset';
  requests[0].resolve({ ok: true, goal: { ...originalGoal, currentToman: 0 } });
  await pending;
  assert.equal(fields.gCurrent.value, '0');
  assert.equal(fields.gTitle.value, 'Draft during reset');
  fill({ ...originalGoal, currentToman: 10 });
  assert.equal(fields.gCurrent.value, '10');
  assert.equal(fields.gTitle.value, 'Draft during reset');
});

test('a pending save cannot replace a newer edit even when it equals the old server baseline', async () => {
  const { fields, requests, fill } = fixture();
  fields.gTitle.value = 'Submitted title';
  const pending = fields.btnSaveGoal.onclick();
  fields.gTitle.value = originalGoal.title;
  const saved = { ...originalGoal, title: 'Submitted title' };
  requests[0].resolve({ ok: true, goal: saved });
  await pending;
  assert.equal(fields.gTitle.value, originalGoal.title);
  fill({ ...saved, currentToman: 800 });
  assert.equal(fields.gTitle.value, originalGoal.title);
});

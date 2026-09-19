# Sahne ProMax 2.0.0-pro — Code Review Fix Plan

End-to-end review of the fork (server, frontend, Electron, tests) performed 2026-09-19.
All 14 server tests pass (`npm test`); issues below were verified against source.
Priority order: P0 = app-breaking, P1 = functional bug, P2 = edge case, P3 = hardening/hygiene.

---

## P0 — Critical (app cannot run / data loss)

### 1. `electron/main.js` uses the old monolithic server API
`server/index.js:256` returns only `{ start, stop, clearData, saveConfig, testHooks, configStore, playbackQueue, goalManager }`, but `electron/main.js` still calls APIs that no longer exist:

| Call | main.js lines | Effect |
| --- | --- | --- |
| `server.appUrl()` | 131, 148 | `win.loadURL()` throws on launch; window never loads |
| `server.overlayUrl()` | 173, 232 | tray menu crashes |
| `server.config` | 269, 361 | line 361 (`server.config.app.autostart`) throws **outside** any try/catch inside `whenReady`, aborting `createWindow()`/`createTray()` |
| `server.importFiles()` | 294, 299 | "Add file" dialog crashes |
| `server.port`, `server.mediaDir` | 230–231, 260, 371 | undefined (info dialog / open-path / port-error text) |
| `server.log()` | 381 | legacy-import log line crashes |

**Fix (choose one, prefer A):**
- A) Extend the object returned by `createServer()` in `server/index.js` with the compat surface:
  `appUrl()`, `overlayUrl()`, `importFiles()` (delegate to `mediaManager.importFilesAsync`),
  `log()` (delegate to logger), and getters `port`, `mediaDir`, `config` (→ `configStore.config`).
  Keeps `main.js` untouched and preserves the old public API for anything else.
- B) Rewrite `main.js` to use `configStore` / `mediaManager` directly (bigger diff, more risk).

### 2. `clearData()` references undefined `DEFAULT_CONFIG`
`server/index.js:215` — `DEFAULT_CONFIG` is never imported in `index.js` (it lives in `server/constants.js`).
**Fix:** add `DEFAULT_CONFIG` to the `require('../constants')`-style import at the top of `server/index.js`
(or import `{ ...DEFAULT_CONFIG.appearance }` from `./constants`). "Clear data" currently throws
`ReferenceError` and wipes nothing.

---

## P1 — Functional bugs

### 3. Goal `autoIncrement` never editable from UI
- `public/js/goal.js:11` reads `goal.autoReset`; server field is `autoIncrement` (`sanitizers.js:111`, `constants.js:98`).
- `public/js/goal.js:34` posts `autoReset`, which `sanitizeGoal` silently drops.
- Defaults disagree: UI falls back to `10000000` (goal.js:9,13) vs server default `5000000` (`constants.js:96`).

**Fix:** rename UI field to `autoIncrement` (read + post), align fallbacks to `5000000`.

### 4. Orphaned legacy frontend `public/app.js` (946 lines)
`public/app.html:433` loads the ES-module app (`/js/app.js`). Root `public/app.js` is referenced by no HTML
and still targets dead routes (`/api/meld-reload`, `/api/clear-queue`, `/api/rate`, `/api/open-media-folder`).
**Fix:** delete `public/app.js` (verify with grep first). Keep `/js/app.js` as the single controller.

### 5. Mute/Volume not applied to live alerts
- Server **does** broadcast `{type:'mute'}` (queue.js:247) and `{type:'volume'}` (queue.js:255).
- `public/overlay.js:486-496` handles only `config`/`play`/`stop` — mute/volume events are ignored.
- `showTip()` (queue.js:161) applies mute only at alert start.

**Fix (in overlay.js):**
- Add `else if (d.type === 'mute')` / `else if (d.type === 'volume')` handlers that update
  `current.media` volumes live (store per-element base volume so mute → 0 → restore works).
- Also wire a UI volume control to `POST /api/control/volume` (endpoint + `queue.setVolume()` exist, no caller).

### 7. Skip does nothing to `playing` in companion mode
`queue.js:190` — `finishPlaying()` returns early when `mode === 'companion'`, so `/api/control/skip`
broadcasts `stop` (overlay visually stops) but the server-side `playing` slot stays occupied until the
`(maxDuration + 15)s` safety timer fires, blocking the next alert.
**Fix:** in `skipCurrent()`, clear `this.playing` / `lastEnd` / `playTimeout` directly (bypass the
companion guard in `finishPlaying`), or split `finishPlaying` into an internal `_endPlaying()` that both use.

### 6. `makeTestTip` count/months unvalidated
`queue.js:260-272` copies `count`/`months` raw from the request body.
**Fix:** clamp with existing helpers: `count: intOrNull(count, 1, 100)`, `months: intOrNull(months, 1, 240)`.

---

## P2 — Edge cases

### 8. Backup: ZIP32 overflow + full in-RAM buffering
`features/backup.js` writes 32-bit ZIP offsets; total media >4 GB (up to 500 × 512 MB allowed) silently
corrupts the archive. `exportBackup` reads every file into memory at once.
**Fix options:** reject export when total size approaches 4 GB with a clear error (short-term), or
implement Zip64 / stream entries to disk (long-term). At minimum, sum sizes first and fail fast.

### 9. Restore: wholesale `config.json` replacement + media renaming
- `importBackup` (backup.js:182) writes the zip's `config.json` verbatim — may restore a *plain-text*
  `secret_id` on machines with DPAPI available. Consider re-encrypting via `configStore.serializedConfig()`
  after reload.
- Media names are re-run through `safeMediaName()`, which can mangle unicode names and break
  `config.files` references. After restore, reconcile `config.files[].file` against the actual written names.

### 15. Meld self-heal false trigger at startup
`meld.js:11` initializes `overlayMissingSince = Date.now()`, so if no overlay connects within 20 s of
startup (user simply hasn't added the browser source yet), a reload fires every 2 min.
**Fix:** set `overlayMissingSince = null` and start counting only after the first overlay disconnect
(or after the first successful start signal).

---

## P3 — Hardening / hygiene

### 10. `sanitizeAppearance` wrong enum fallback
`sanitizers.js:97` — `['mediaMode','mediaFit','amountStyle','currency'].forEach(k => en(k, 'pop'))`.
`'pop'` is only valid for `animation`. Currently unreachable (out is always seeded from
`DEFAULT_APPEARANCE`), but a latent landmine.
**Fix:** per-key defaults: `mediaMode:'full'`, `mediaFit:'cover'`, `amountStyle:'pill'`,
`animation:'pop'`, `currency:'toman'`.

### 14. Kick chat duplicate reconnect timers
`kick-chat.js` schedules reconnect from both `onclose` (`setTimeout(connect, kickRetry)`) and
`startKeepAlive` (15 s check). `connect()` guards on readyState, so no duplicate sockets — but clear the
pending close-timer in `connect()` and in `stop()` to avoid redundant attempts.

### 11–13. Verified safe / by design — no action
- `servePublic` traversal check (`streaming.js:76`) — secure, covered by test 12.
- Unauthenticated admin SSE — protected by Host/Origin checks; matches upstream threat model.
- `parseThreshold` T/K = 1,000 — intentional (Persian "هزار تومان" convention).

### Code-quality (non-blocking)
- `router.js:421,449` — hoist inline `require('../playback/picker')` to the top.
- `config/store.js` — `saveConfig()` (sync) and `saveConfigAsync()` share the same `.tmp` path; a sync
  save racing a debounced async save can clobber the temp file. Use a distinct tmp name per mode or
  route all writes through one path.
- Tests to add: backup/restore roundtrip, `/api/control/*` endpoints, goal auto-increment, `clearData`.

---

## Execution order

1. Item 2 (one-line import fix) + Item 1 option A (server compat surface) → smoke-run `npm start`.
2. Item 3 (goal field), Item 4 (delete legacy app.js), Item 6 (test tip clamp).
3. Item 5 (overlay mute/volume handlers + volume UI), Item 7 (companion skip).
4. Items 8–10, 14, 15 as follow-ups.
5. Add regression tests for every changed endpoint; keep `npm test` green.

# Changelog — Sahne ProMax

All notable changes to the public builds. Versions follow semantic versioning.

## 2.3.0 — 2026-09-21 (stats pack: counters, alert history, top-donors widget)

Three streamer tools built on one shared ledger:

- **🔢 Live sub & gift counters on the goal widget:** running totals of subs, gifted subs and today's subs (`⭐ ۱۲ ساب · 🎁 ۳۴ سابگیفت · امروز ۵ ساب`), updating on every sub/gift-sub, persisted in the goal config, zeroed by the goal reset, hidden when off or still all zero. Test/replay traffic is excluded; the daily counter rolls at the streamer's local midnight.
- **📜 Alert history:** every alert actually shown on the overlay is persisted to `history.json` (newest 20 000 entries kept) together with per-day totals and per-donor sums that pruning never shrinks. New `GET /api/history` (+ `?limit=&day=`), an admin SSE `history_update` per alert, a **History** page in the controller (today / 7-day / all-time cards, alert list, daily breakdown, top donors), and the ledger now rides along in 1-click backups (export + restore).
- **🥇 Top-donors OBS widget:** a second Browser Source at `/top` (`?range=daily|weekly|all`, `&limit=1..20`, `&title=…`) rendering a live leaderboard with medals for the top 3, Persian Toman figures, SSE-driven refresh and a 60 s fallback poll. Backed by `GET /api/top`, with a new `top` SSE role (capped at 4 concurrent streams) and its own CSP.
- **Fixed:** donor grouping is case/space-insensitive and display names are trimmed before storage.
- New tests (29 total): the history store (aggregates, pruning, persistence, clear), counters end-to-end with reset behaviour, history API + SSE, top-donor ranges/ordering, widget page/asset serving, and a backup round-trip that carries `history.json`.

## 2.2.0 — 2026-09-21 (chat commands, queue priority, milestone confetti, timed goal)

Four streamer tools unique to ProMax:

- **⌨️ Kick chat commands:** viewers type `!dance` (any configured token) in Kick chat and the mapped alert file plays on stream. Counterpart to the existing sub/gift pipeline: no money, no capture. Each command maps to any uploaded file; three rate-limit layers (per viewer, global, per minute) plus a queue-length cap stop spam waves; duplicate commands and references to deleted files are rejected by the config validator. Command alerts use a dedicated card template (`commandTemplate`) and never show an amount.
- **🥇 Sub-first queue priority:** subscription and gift-sub alerts jump ahead of regular tips while keeping FIFO inside each class. Capture retries (which re-queue at the back) and manual replays (which stay at the very front) keep their original ordering; companion mode is unaffected. The KickBot flood cap now drops the oldest _tips_ first, so a sync burst can never evict sub alerts.
- **🎊 Milestone confetti:** the overlay throws a confetti burst when the goal completes (exactly once per goal — resetting or raising the target arms it again), when a single donation reaches a configurable toman threshold (`milestoneToman`), or on the first sub of the day. Test/replay traffic never triggers or consumes milestones; goals that are already complete when upgrading do not fire retroactively. All three effects are toggleable on the Goal page.
- **⏳ Timed goal countdown:** optional deadline (`mode: 'timed'`) on the goal widget with a live `DD روز HH:MM:SS` countdown, an expired "زمان تمام شد" state, and `serverNow` clock-skew correction. The controller validates that the deadline is in the future before saving.
- **Fixed:** the goal page's auto-increment switch carried a wrong label ("صفر شدن خودکار…" instead of "افزودن خودکار دونیت‌ها…").
- New tests (26 total): queue-priority unit test, chat-command sanitizer + end-to-end flow (mapped file plays, cooldown, flood cap, disabled state), confetti milestones (complete-once, threshold, first-sub, test-traffic silence), timed-goal REST fields and expiry, and overlay-side confetti/template DOM checks.

## 2.1.1 — 2026-09-21 (Sahne+ 1.3.2 security fixes ported to ProMax)

Security fixes and UI polish from upstream [Sahne+ 1.3.2](https://github.com/AmirEyZed/sahne-plus/releases/tag/v1.3.2):

- **Security (reported by [KernelDotDLL](https://github.com/KernelDotDLL)):** a web page open in the streamer's browser could connect to the alert event stream (`/events`). It could not read anything, but the connection counted as a Browser Source, so an alert could be consumed while OBS was closed, and the number of connections was unbounded. The stream now refuses requests from another site (`Origin` / `Sec-Fetch-Site` checks) and caps concurrent connections per role (8 overlay / 4 preview / 4 admin / 4 goal).
- **Security (same report):** `/media/…` served every file in the media folder, including notes or a partial upload. Only files registered as alerts (or paired audio) are served now.
- **Hardening:** the installed app ignores Chromium's remote-debugging switches (`--remote-debugging-port`, `--remote-debugging-pipe`, `--remote-debugging-address`), so it can no longer be started with the DevTools protocol open; the ignored switch is noted in the log. Development runs (`electron .`) are unchanged.
- **Fixed:** in the file editor the header icon was oversized and the preview could collapse when the window was short; the panel now scrolls instead of squashing its parts. (The upstream "setup card gap" fix was already present in ProMax's stylesheet.)
- Tests for the SSE origin/cap rules and the registered-only media serving.

## 2.1.0 — 2026-09-19 (Sahne+ 1.3.1 features ported to ProMax)

All four headline features of upstream [Sahne+ 1.3.1](https://github.com/AmirEyZed/sahne-plus/releases/tag/v1.3.1), ported onto the modular ProMax architecture (goal widget, paired media, profiles, Stream Deck API, Nobitex rates and the glassmorphic UI are unchanged):

- **Updates inside the app:** 30 s after start and every 6 hours the app checks this repository's latest GitHub release (can be turned off in Settings) and shows a banner and a Windows notification when a newer version exists. «آپدیت» downloads the official installer, verifies it against the release's `SHA256SUMS.txt`, closes the app and installs it; the new version starts by itself, settings and media stay. Nothing is downloaded or installed without a click. (`electron/updater.js` + `electron/update-core.js`, checks `B3hnamR/sahne-promax` releases.)
- **Kick subs with a VPN, no extra setup:** if kick.com is filtered on your network, Sahne ProMax now uses your VPN app's Windows system proxy automatically (for example v2rayN in "system proxy" mode) for kick.com and the rate sources — after a manually entered proxy and before a direct connection. Only plain HTTP proxies are used; a SOCKS-only setup needs the VPN's TUN mode or a manual HTTP proxy. The detected proxy is shown under the proxy field in Settings.
- **Readable Kick errors:** instead of raw codes such as `read ECONNRESET`, the Kick card says what happened (kick.com filtered, channel not found, request refused by Kick, …) and what to do, in Persian. A "channel not found" answer is no longer hidden by a later network error.
- **Card delay:** the name/amount card (and the KickBot TTS) can appear a few seconds after the alert media starts — a global setting on the Look page and an optional per-file value in the file editor. A delayed card always stays up for a few seconds.
- The uninstaller removes the autostart entry only on a real uninstall, not while updating.
- The in-app copies of PRIVACY.md / TERMS.md (About page) are synced with the 1.3.1 repository copies.
- Tests for proxy parsing, route order, the new Kick messages, the card delay and the update helpers.

## 2.0.0-pro — 2026-09-19 (initial ProMax release)

- Modular server architecture (`server/config`, `server/http`, `server/integrations`, `server/media`, `server/playback`, `server/rates`, `server/utils`), goal widget, paired media, appearance profiles, Stream Deck / hardware REST endpoints, 1-click zip backup & restore, Nobitex USDT/IRT rate source, glassmorphic custom dropdowns and modal UI, dark theme overhaul.

## 1.3.0 — 2026-09-19 (open source)

- Sahne+ is now open source under the Apache License 2.0 (names and icons excluded, see BRANDING.md). Source: https://github.com/AmirEyZed/sahne-plus
- Official installers are built by GitHub Actions from the tagged source and published with a build provenance attestation (`gh attestation verify`).
- Unit tests (`npm test`): server validation, loopback hardening, overlay XSS.
- About page: license and NOTICE tabs.
- Clearer error when a Kick channel name is not found (was "kick api HTTP 404").
- Fixed (found by an independent code audit by [B3hnamR](https://github.com/B3hnamR), thank you): imported **image** alerts (PNG/JPG/GIF/WebP) did not render in the Browser Source since 1.1.0 because the same-origin check rejected the relative `/media/…` URL. Video and audio alerts were not affected.
- Fixed (same audit): a donation whose payment capture failed for a transient reason (network drop, KickBot 5xx, timeout) was marked as played and never retried. Capture is now retried (3 attempts, 15 s apart) and an uncaptured tip is never marked as played; only a definitive "declined" answer from KickBot ends it.
- Fixed: the "text-only alert when no file matches" option was accepted by the API but ignored; it now works and has a switch on the Settings page.
- Fixed: Persian/Arabic-Indic digits in file names (`۱۵۰T`) and donor messages are recognised for thresholds and keywords.
- Fixed: HTTP suffix Range requests (`bytes=-500`) returned the first bytes instead of the last; sub alerts received before the first exchange rate showed 0 instead of the USD price; the autostart switch is saved immediately.
- Changed: duplicate detection for Kick chat events is 2.5 s and keyed by gifter + recipients (identical back-to-back gift batches are no longer merged); the rate-interval field defaults to 2 minutes like the server.
- Hardening: Content-Security-Policy is also sent as an HTTP header (so `frame-ancestors` applies), the app accepts `cardpos` messages only from its own origin, uploads stream to disk instead of being buffered in RAM, oversized third-party responses fail instead of being silently truncated, `POST /api/config` can no longer drop file entries (use `DELETE /api/file`), "clear application data" also removes the log and config backups, and Meld self-heal is opt-in (only the installed app enables it).
- Fixed: launching the app while it is already running now only brings the existing window to the front; it could briefly start a second server and show a "port in use" error.
- Electron updated to 43.7.3 (Chromium security fixes).
- The uninstaller now removes the "run at Windows login" registry entry; test instances started with `SAHNE_PLUS_DATA_DIR` never register themselves for login.
- Code formatted with Prettier (120 columns); `npm run format:check` runs in CI. `engines` declares Node 22+.
- Tests: regression tests for the image-alert and capture-retry fixes, upload / Range / config handling and digit normalisation.

## 1.2.0 — 2026-09-18

- Exchange rate now comes from the baha24.com public JSON API (live sell rate, refreshed every 2 minutes by default, minimum 1). bonbast.com is only used as a fallback, at most every 5 minutes. The rate source is shown next to the rate in the app.
- Fixed: the first-run setup card stayed visible after the KickBot link was configured.

## 1.1.1 — 2026-09-18

- Removed an unnecessary mention of an unrelated third-party product from the About page and documents. No functional change.

## 1.1.0 — 2026-09-18 (release-readiness hardening)

Security

- KickBot widget key is now stored encrypted with Windows DPAPI (`secret_id_enc`); existing plaintext keys are migrated on first start and the plaintext field is removed. The key is no longer returned by any API, masked in the UI and redacted from logs.
- Local server: `Host` validation (DNS rebinding) and `Origin` validation for state-changing requests (CSRF); `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` headers.
- Browser Source: strict Content-Security-Policy, scripts and styles moved to files, single-pass safe template rendering for donor names/messages (all values escaped), only `https:` GIF/TTS URLs and same-origin media URLs are loaded, `postMessage` restricted to the app origin.
- Imported media: content sniffing (a `.webm` must really be a WebM, etc.), 512 MB limit, Windows reserved names and Unicode control characters stripped from file names, symlinks resolved, sources never modified.
- Every field accepted by the API is validated (numeric bounds, enums, colour format, font allow-list, text length limits). Third-party text (names, messages, usernames) is stripped of control and bidi-override characters and length-limited.
- Electron: `sandbox: true`, DevTools disabled in packaged builds, permission requests denied, IPC calls accepted only from the app window, external links limited to an allow-list, Electron fuses (RunAsNode / NODE_OPTIONS / inspect off, ASAR integrity on).

Privacy

- Google Fonts removed from the Browser Source; all fonts are bundled locally.
- New in-app About page with privacy policy, terms, third-party notices, data location and security contact.

Reliability

- Played-alert ids are persisted (`played.json`) so a donation is not replayed after a restart.
- Corrupted `config.json` is preserved as `config.json.corrupt-<timestamp>` instead of being overwritten; config writes are atomic.
- Bonbast: malformed or out-of-range responses are rejected and the previous rate is kept; the failure is shown in the UI; minimum refresh interval 5 minutes; requests have timeouts.
- Kick chat reconnect uses exponential back-off (5 s → 60 s).
- Queue advance is guarded against re-entrancy; in-memory queues are capped.

Data controls

- Disconnect KickBot, Reset settings, Clear application data (with confirmation dialogs).

## 1.0.1 — 2026-09-18

- First hardening pass: loopback Host/Origin checks, sandboxed renderer, Electron fuses.

## 1.0.0 — 2026-09-18

- Initial desktop release: Electron shell around the KickAlerts engine, SAHNE-style UI, NSIS installer.

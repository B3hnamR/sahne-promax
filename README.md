<div align="center">

# ⚡ Sahne ProMax

**High-Performance, Modular, Zero-Dependency Stream Alerts & Widgets for Kick on Windows**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-43.7.3-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org)
[![Zero Dependencies](https://img.shields.io/badge/Runtime%20Dependencies-0-brightgreen?style=flat-square)](#architecture)
[![Tests](https://img.shields.io/badge/Tests-Node.js%20suite-success?style=flat-square)](#testing)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.5.1-D2B4A3?style=flat-square)](https://github.com/B3hnamR/sahne-promax/releases/latest)

<p align="center">
  <a href="#key-features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#stream-deck--hardware-rest-api">Stream Deck API</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#performance--optimization">Performance</a> •
  <a href="docs/README-FA.md">راهنمای فارسی</a>
</p>

</div>

---

## 📖 Overview

**Sahne ProMax** is a modernized, modular fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) designed for Kick streamers. It plays transparent WebM animations, GIFs, images, and audio alerts for **KickBot donations**, **StreamElements tips**, **Kick subscriptions**, and **Kick gifted subscriptions**. The controller and alert server run locally, with no cloud backend and no runtime npm packages.

ProMax incorporates upstream Sahne+ changes through **1.3.5**. The current **2.5.1** release fixes the Alert Rules editor, simulator, and preview. Version 2.5.0 added **alert media routing rules** and replay fidelity: ordered conditions choose the alert file, the Rules page explains decisions, and replay keeps its original currency and media. Version 2.4.1 fixed rate timing, stale connection events, portable backup/restore, controller feedback, and update downloads; 2.4.0 brought **StreamElements tip alerts** and **multi-currency conversion** into ProMax. ProMax also includes OBS goal and top-donors widgets, Stream Deck controls, paired media, Kick chat commands, sub-first queue priority, milestone confetti, timed goals, counters, and persistent alert history.

> **Note:** Sahne ProMax is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24, or Bonbast.

---

## What's new in 2.5.1

- **Accurate rule simulation:** the event tester now gives the tier/keyword picker the entered tip, uses full gift-bundle value, and includes subscription months. Its preview keeps the selected alert type and currency.
- **Lossless rule editing:** choose multiple providers and alert types, set maximum subscription months and gift counts, and keep a missing file reference visible while repairing it.
- **Safer preview:** changing an input or receiving an older test result cannot play a stale match. A deleted file reference no longer blocks unrelated rule edits; newly selected missing files are still rejected.

See the [2.5.1 release notes](docs/releases/RELEASE_NOTES_2.5.1.md) for the full list.

---

## 🚀 ProMax Features

These tools are ProMax additions built on its modular server and overlay architecture. Upstream-derived features are described separately under Updates & Connectivity:

| Feature                         | What it does                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⌨️ Kick Chat Commands**       | Viewers type `!command` in Kick chat and the mapped file plays — free, rate-limited (per viewer / global / per minute), with a dedicated card template.                                                               |
| **🥇 Sub-First Queue Priority** | Sub and gift-sub alerts jump ahead of regular tips (FIFO inside each class); capture retries return to the back and manual replays go to the front.                                                                   |
| **🎊 Milestone Confetti**       | Overlay confetti on goal completion (once per goal), on donations above a configurable toman threshold, and on the first sub of the day.                                                                              |
| **⏳ Timed Goal Countdown**     | Optional deadline on the goal widget with a live Persian countdown, expiry state, and server-clock skew correction.                                                                                                   |
| **🔢 Sub & Gift Counters**      | The goal widget counts subscription events, gifted subscriptions, and today's subs — reset with the goal or hidden entirely.                                                                                          |
| **📜 Alert History**            | Every displayed alert is persisted (20k entries) with per-day totals and per-donor sums that survive restarts; included in backups.                                                                                   |
| **🥇 Top-Donors Widget**        | A second OBS Browser Source (`/top`) with a live leaderboard for today / last 7 days / all-time, medals included.                                                                                                     |
| **🎯 Live Goal Widget**         | A standalone OBS Browser Source (`/goal`) with an animated progress bar, Persian Toman figures, and confetti at 100%. Eligible live alerts update the amount when auto-increment is on.                               |
| **🎨 Multi-Profile Overlays**   | Independent appearance profiles per OBS scene via URL (`/overlay?profile=gameplay`, `?profile=chatting`) — no duplicate server, no re-editing.                                                                        |
| **🎵 Paired Media**             | Attach an audio track (`.mp3`/`.wav`/`.ogg`) to a static image alert; the overlay shows the image for exactly the audio's length.                                                                                     |
| **🎖️ Milestone & Tier Alerts**  | Per-file thresholds for sub-renewal months (`minMonths`/`maxMonths`) and gift-sub counts (`minCount`/`maxCount`).                                                                                                     |
| **🎛️ Stream Deck REST API**     | Local endpoints (`/api/control/skip`, `/replay`, `/pause`, `/resume`, `/mute`, `/volume`, `/clear`) for hardware keypads and macros.                                                                                  |
| **💾 1-Click Backup & Restore** | Export/import settings, media and alert history (see Backup & Restore below) as a standard `.zip` using Node's native `zlib` — no external tools.                                                                     |
| **🧭 Media Routing Rules**      | Ordered conditions (provider, alert type, currency, toman range, message, sub months, gift count) pick the alert file; first match wins, otherwise the existing tier/keyword picker. Explainable from the Rules page. |
| **🪙 Live Currency Rates**      | USD→Toman from Nobitex's USDT/IRT orderbook, with Baha24 as the USD fallback; Baha24 and Bonbast provide supported non-USD quotes.                                                                                    |
| **⚡ Performance Engineering**  | Async `fs.promises` I/O for uploads/scans/restores, lazy on-hover video decoding in the file grid, targeted SSE, and HTTP 304 ETag caching.                                                                           |
| **🧩 Modular Server**           | The backend is split into focused modules (`config`, `http`, `integrations`, `media`, `playback`, `rates`, `utils`) instead of one monolithic file — easier to audit, test, and extend.                               |
| **🪟 Modern Glassmorphic UI**   | Dark glass design system with custom dropdowns, modal dialogs, slim scrollbars, and a bento-grid layout.                                                                                                              |

---

## ✨ Key Features

### ⚡ Performance & Resource Efficiency

- **Non-Blocking Asynchronous I/O (`fs.promises`):** File uploads, media scans, and zip backup/restore use asynchronous file and stream operations to keep large media work off the main event loop.
- **Lazy On-Hover Video Decoding:** File cards in the controller render lightweight static posters; video preview elements decode only on mouse hover, dramatically reducing GPU decoder saturation and RAM spikes.
- **Targeted Server-Sent Events (SSE):** Controller and widgets receive live pushes (`state`, `config`, `goal_update`, `rate`, `backup_restored`); the top-donors widget also has a fallback refresh.
- **HTTP 304 ETag Static Caching:** Fonts, static CSS/JS, and branding assets leverage `ETag` headers to return `304 Not Modified`, saving socket bandwidth and speeding up OBS browser source refreshes.

### 🪙 Real-Time Currency Conversion

- **Nobitex USDT/IRT Orderbook (Primary):** Live dollar-to-toman conversion powered by Nobitex's real-time orderbook API (`/v3/orderbook/USDTIRT`), converting Iranian Rials to Toman with zero external dependencies.
- **Baha24 and Bonbast FX:** Baha24 supplies supported non-USD quotes during normal Nobitex operation and the fallback USD quote if Nobitex fails. Bonbast supplies fallback non-USD quotes.
- **Proxy & Manual Pinning:** Configurable HTTP/HTTPS proxy support and manual rate locking — plus automatic use of the **Windows system proxy** (e.g. v2rayN in "system proxy" mode) for kick.com and rate sources when the manual field is empty.

### 🎬 Advanced Streamer Tools

- **⌨️ Kick Chat Commands:** Viewers type a command in Kick chat (`!dance`, `!hype`, …) and the mapped alert file plays on stream — free of charge. Three rate-limit layers (per viewer, global, per minute) plus a queue cap stop spam waves; each command maps to any uploaded file and has its own card template.
- **🥇 Queue Priority for Subs:** Subscriptions and gift-sub alerts jump ahead of regular tips in the queue (FIFO inside each class), so live moments play while they are fresh. Capture retries return to the back after their delay; manual replays go to the front.
- **🎊 Milestone Confetti:** Bursts of confetti on the overlay when the goal completes (once per goal), when a single donation passes a configurable threshold, or on the first sub of the day — all toggleable on the Goal page.
- **⏳ Timed Goal (Countdown):** Optional deadline for the goal widget with a live `DD روز HH:MM:SS` countdown, "زمان تمام شد" state, and server-clock correction against client clock skew.
- **🔢 Live Sub & Gift Counters:** The goal widget shows running totals — `⭐ ۱۲ ساب · 🎁 ۳۴ سابگیفت · امروز ۵ ساب` — updating on live sub and gift-sub events, persisting across restarts, and zeroing with the goal reset. Test and replay alerts do not increase them.
- **📜 Alert History & Daily Totals:** A dedicated page (and API) with alerts shown on stream, today's/7-day/all-time sums, per-day breakdown, and top donors. The ledger keeps the newest 20,000 entries; aggregate totals survive pruning until history is cleared. History is included in backups.
- **🥇 Top-Donors OBS Widget:** `/top` Browser Source rendering a live leaderboard (`?range=daily|weekly|all&limit=1..20&title=…`) with medals for the top 3 and Persian Toman figures, refreshed by SSE on every alert.
- **🎵 Paired Media (Sound for Images):** Attach custom audio files (`.mp3`, `.wav`, `.ogg`) to static PNG/GIF/WebP images. The overlay displays the graphic and locks alert duration to the audio track.
- **🎨 Multi-Profile Scene Overlays:** Tailor appearance, positioning, and card scale for different OBS scenes via URL query parameters (e.g. `/overlay?profile=gameplay`, `/overlay?profile=chatting`) without running duplicate server instances.
- **🎯 Live Donation & Sub Goal Widget:** Dedicated OBS Browser Source (`/goal` & `/goal.html`) rendering real-time animated progress bars and Persian Toman figures, complete with celebratory confetti at 100%.
- **🎖️ Milestone & Tier Alerts:** Configure tier thresholds for subscription renewals (`minMonths` / `maxMonths`) and bulk gifted subscriptions (`minCount` / `maxCount`).
- **⏱️ Card Delay:** Show the name/amount card (and KickBot TTS) a few seconds after the alert media starts — globally on the Look page, or per file in the file editor.
- **💾 Backup & Restore:** Export and import settings, media and alert history as standard `.zip` archives. The limit is 512 MB per entry, 1 GB per archive, and 1,000 entries. Backups omit provider and proxy credentials, so reconnect KickBot and StreamElements after restoring. Restore validates before replacing live files, keeps media absent from the archive and the current port, and leaves previously played alert IDs local to each installation.

### 🔄 Updates & Connectivity (upstream parity through Sahne+ 1.3.5)

- **In-App Updater:** The desktop app checks this fork's GitHub Releases 30 s after start and every 6 hours (can be turned off in Settings). Clicking **آپدیت** downloads the ProMax installer, checks it against the release's `SHA256SUMS.txt`, and starts installation after the download; it never downloads or installs an update on its own.
- **Kick Behind a Filter:** If kick.com is filtered on your network, Sahne ProMax automatically uses your VPN app's Windows system proxy (manual proxy still wins; SOCKS-only setups need TUN mode or a manual HTTP proxy).
- **Readable Kick Errors:** The Kick card explains problems in Persian — kick.com filtered, channel not found, request refused — instead of raw codes like `read ECONNRESET`.
- **StreamElements Tips:** Connect with the JWT token from StreamElements → Account → Channels → Show secrets. The credential is stored locally and uses Electron `safeStorage` encryption when available; disconnect it from Settings to remove it.
- **Other Tip Currencies:** Supported StreamElements currencies are converted using the available rate and matched against the same toman-based alert tiers. The alert card retains the original amount and currency; an unsupported currency stays labeled without an invented toman conversion. In card templates, `{original}` shows the source amount and `{usd}` is populated only for USD tips.

---

## 🎛️ Stream Deck & Hardware REST API

Sahne ProMax provides loopback endpoints for Elgato Stream Deck, Loupedeck, Touch Portal, or custom macro keypads:

| Endpoint              | Method | Parameters   | Description                                          |
| --------------------- | ------ | ------------ | ---------------------------------------------------- |
| `/api/control/skip`   | `POST` | None         | Immediately stops current alert and advances to next |
| `/api/control/replay` | `POST` | None         | Re-enqueues and replays the last finished alert      |
| `/api/control/pause`  | `POST` | None         | Pauses alert queue playback                          |
| `/api/control/resume` | `POST` | None         | Resumes alert queue playback                         |
| `/api/control/mute`   | `POST` | None         | Toggles master overlay audio mute                    |
| `/api/control/volume` | `POST` | `val=0..100` | Sets master overlay volume                           |
| `/api/control/clear`  | `POST` | None         | Clears all pending alerts in queue                   |

---

## 🚀 Quick Start

### Prerequisites

- **Operating System:** Windows 10 or 11 (x64)
- **OBS Studio** or **Meld Studio** to display alerts and widgets on stream
- **Node.js `>= 22.0.0`** only if running or building from source; the Windows installer includes the app runtime

### Installation & Running

**Download the installer** from the [Releases page](https://github.com/B3hnamR/sahne-promax/releases/latest) — or run from source:

```bash
# Clone the repository
git clone https://github.com/B3hnamR/sahne-promax.git
cd sahne-promax

# Install the locked development dependencies (Electron & Prettier)
npm ci

# Run the automated test suite
npm test

# Launch the desktop application
npm start
```

### OBS Studio Setup

1. In OBS, add a **Browser Source**.
2. **Alert Overlay URL:** `http://localhost:7788/overlay` (Width: `1920`, Height: `1080`).
   - For specific scenes: `http://localhost:7788/overlay?profile=gameplay`
3. **Goal Widget URL:** `http://localhost:7788/goal` (Width: `640`, Height: `170` — use `200` when the timer is on).
4. **Top-Donors URL:** `http://localhost:7788/top?range=all&limit=5` (Width: `420`, Height: `240`).
5. Check **Shutdown source when not visible** and **Refresh browser when scene becomes active**.

---

## 🏗️ Architecture

Sahne ProMax follows a strict **zero-runtime-dependency** philosophy. All core server functionality relies exclusively on standard Node.js native modules (`http`, `https`, `crypto`, `fs`, `path`, `zlib`).

```
sahne-promax/
├── electron/                 # Electron main process, tray menu, DPAPI bridge, in-app updater
├── server/                   # Decoupled backend domain modules
│   ├── index.js              # Server orchestrator & lifecycle management
│   ├── constants.js          # System limits, MIME types, default configuration
│   ├── logger.js             # Redacted in-memory ring buffer & file logging
│   ├── sse.js                # SSE subscriber hub (overlay, admin, goal, preview)
│   ├── config/               # Atomic config persistence, played-tip & history ledgers
│   ├── features/             # Goal widget engine & 1-click zip backup/restore
│   ├── http/                 # Hardened loopback router, static server, range streaming
│   ├── integrations/         # KickBot/StreamElements WebSockets, Kick chat feed, Meld monitor
│   ├── media/                # Async media manager & streaming upload sniffer
│   ├── playback/             # Priority queue scheduler & payment capture engine
│   ├── rates/                # Nobitex USD, Baha24/Bonbast FX and fallback
│   └── utils/                # Magic byte sniffing, sanitizers, HTTP client, proxy routing
├── public/                   # Frontend assets
│   ├── app.html              # Main controller dashboard
│   ├── goal.html             # Standalone OBS goal widget
│   ├── overlay.html          # OBS alert overlay
│   ├── top.html              # Standalone OBS top-donors widget
│   └── js/                   # Native ES Modules (api, state, files, look, goal, etc.)
├── docs/                     # Documentation & guides
│   ├── ARCHITECTURE.md       # Technical architecture specification
│   ├── DATA_FLOW.md          # Network flows & privacy disclosures
│   ├── README-FA.md          # راهنمای جامع فارسی
│   ├── legal/                # Privacy, terms, and third-party notices
│   └── releases/             # Historical release notes
└── test/                     # Automated test suites
    ├── server.test.js        # Hardening, loopback security, SSE caps, media gating
    ├── update.test.js        # Update version/redirect/checksum helpers
    ├── features.test.js      # Queue priority, chat commands, confetti, timed goal
    ├── stats.test.js         # History ledger, top donors, live counters, backup round-trip
    ├── overlay-xss.test.js   # XSS & CSS injection prevention, card delay, confetti DOM
    ├── backend-audit.test.js # Restore, connection, rate and persistence regressions
    ├── frontend-audit.test.js # Controller and overlay behavior regressions
    ├── updater-audit.test.js # Download streaming and error handling
    └── promax.test.js        # ProMax features & Nobitex rate tests
```

---

## 🛡️ Security & Privacy

- **No Cloud Backend:** Your media, settings, logs, and alert history remain on your machine (`Documents\Sahne Plus`); the app connects directly to the third-party services its features need.
- **Local Secrets:** KickBot and StreamElements credentials use Windows DPAPI through Electron `safeStorage` when available. If encryption is unavailable, they are stored locally in plaintext; portable backups omit them. The local HTTP API does not return the credentials, and logs redact them.
- **Strict Loopback Protection:** The local server binds exclusively to `127.0.0.1` and enforces strict `Host` and `Origin` validation to block DNS rebinding and cross-site request forgery (CSRF).
- **Event-Stream Gating:** `/events` refuses cross-site pages (`Origin` / `Sec-Fetch-Site`) and caps concurrent streams per role, so a random open browser tab can't consume alerts while OBS is closed.
- **Registered-Media Only:** `/media/…` serves only files registered as alerts (or their paired audio) — never notes or partial uploads left in the folder.
- **No Remote Debugging:** The packaged app strips Chromium's `--remote-debugging-*` switches so the controller window can't be scripted over the DevTools protocol.
- **Hardened CSP:** Content Security Policies isolate overlay rendering, block remote script executions, and prevent XSS or CSS iframe escapes.
- **Checksum-Checked Updates:** The updater downloads solely from this fork's Releases and runs the installer only if its SHA-256 matches the release's `SHA256SUMS.txt` — and only after you click. The installer is not code-signed.

For detailed privacy information and network flow mapping, see [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md) and [`docs/legal/PRIVACY.md`](docs/legal/PRIVACY.md).

---

## 🧪 Testing

Run the automated test suite with Node's native test runner:

```bash
npm test
```

The integration and unit tests run in offline test-harness mode:

- ✅ Paired Media & Milestone Sub Alerts matching logic
- ✅ Stream Deck & Hardware REST Controls
- ✅ Donation & Sub Goal Engine (auto-increment, target reset, SSE)
- ✅ Zero-Dependency 1-Click Backup & Restore (.zip round-trip)
- ✅ ETag Static Caching (HTTP 304 Not Modified)
- ✅ Nobitex USDT/IRT Rate Provider & Baha24 Fallback
- ✅ Magic byte sniffing (blocks renamed executables)
- ✅ Persian & Arabic-Indic digit normalization
- ✅ Loopback hardening (Host / Origin / Traversal guards)
- ✅ Overlay XSS & CSS escape sanitization
- ✅ System-proxy parsing, route order & readable Kick errors
- ✅ Card delay (per-file over appearance; TTS waits for the card)
- ✅ Update version parsing, release-redirect pinning & checksum lookup
- ✅ StreamElements tip normalization and non-USD currency conversion
- ✅ Event-stream origin refusal & per-role connection caps
- ✅ Media route serves registered alerts only
- ✅ Queue priority (subs/gift-subs first, FIFO inside a class, replay/retry safe, flood cap keeps subs)
- ✅ Chat commands (file mapping, cooldowns, flood cap, orphan-file rejection)
- ✅ Milestone confetti (goal complete once, big-donation threshold, first sub of the day)
- ✅ Timed goal countdown (fields, expiry, clearing)
- ✅ Live counters (subs / gift-subs / subs today; test traffic and reset behaviour)
- ✅ History ledger (day & donor aggregates, 20k pruning, persistence, clear)
- ✅ History API + live `history_update` SSE, top-donors ranges & ordering
- ✅ Backup round-trip carries `history.json`
- ✅ Bounded streaming backups, validation before restore, credential omission, local-media preservation, and provider reconnection guidance
- ✅ Stale connection and save sequencing, failed-delete media edits, rate timing, and browser version display
- ✅ Installer download stream errors and release checksum verification

---

## 📜 License

Open source under the [Apache License 2.0](LICENSE).  
Copyright © 2026 Behnam & Contributors. Based on upstream work by [AmirEyZed](https://github.com/AmirEyZed/sahne-plus).

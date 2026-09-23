<div align="center">

# ⚡ Sahne ProMax

**High-Performance, Modular, Zero-Dependency Stream Alerts & Widgets for Kick on Windows**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-43.7.3-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org)
[![Zero Dependencies](https://img.shields.io/badge/Runtime%20Dependencies-0-brightgreen?style=flat-square)](#architecture)
[![Tests](https://img.shields.io/badge/Tests-automated-success?style=flat-square)](#testing)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.4.1-D2B4A3?style=flat-square)](https://github.com/B3hnamR/sahne-promax/releases/latest)

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

ProMax combines its modular architecture and streamer tools with upstream Sahne+ 1.3.1–1.3.5 fixes and features. Version **2.4.1** completes the upstream 1.3.5 gold preset wording and fixes alert rate timing, connection state, portable backup/restore, controller feedback, and update verification. Version 2.4.0 introduced **StreamElements tip alerts** and **multi-currency conversion**: tips enter the same queue as KickBot donations, use the same media tiers, and supported non-USD amounts are converted to toman while preserving the original amount and currency on the alert card. Earlier ProMax releases added a standalone OBS Goal Widget, Stream Deck controls, Paired Media, backup and restore, Kick chat commands, sub-first queue priority, milestone confetti, timed goals, counters, persistent alert history, and a top-donors widget.

> **Note:** Sahne ProMax is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24, or Bonbast.

---

## 🚀 ProMax Features

These tools are ProMax additions built on its modular server and overlay architecture. Upstream-derived features are described separately under Updates & Connectivity:

| Feature                         | What it does                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⌨️ Kick Chat Commands**       | Viewers type `!command` in Kick chat and the mapped file plays — free, rate-limited (per viewer / global / per minute), with a dedicated card template.                                 |
| **🥇 Sub-First Queue Priority** | Sub and gift-sub alerts jump ahead of regular tips (FIFO inside each class); retries and replays keep their original ordering.                                                          |
| **🎊 Milestone Confetti**       | Overlay confetti on goal completion (once per goal), on donations above a configurable toman threshold, and on the first sub of the day.                                                |
| **⏳ Timed Goal Countdown**     | Optional deadline on the goal widget with a live Persian countdown, expiry state, and server-clock skew correction.                                                                     |
| **🔢 Sub & Gift Counters**      | The goal widget also counts people: total subs, gifted subs, and today's subs — reset with the goal or hidden entirely.                                                                 |
| **📜 Alert History**            | Every displayed alert is persisted (20k entries) with per-day totals and per-donor sums that survive restarts; included in backups.                                                     |
| **🥇 Top-Donors Widget**        | A second OBS Browser Source (`/top`) with a live leaderboard for today / last 7 days / all-time, medals included.                                                                       |
| **🎯 Live Goal Widget**         | A standalone OBS Browser Source (`/goal`) with an animated progress bar, Persian Toman figures, and confetti at 100%. Auto-increments on every donation/sub.                            |
| **🎨 Multi-Profile Overlays**   | Independent appearance profiles per OBS scene via URL (`/overlay?profile=gameplay`, `?profile=chatting`) — no duplicate server, no re-editing.                                          |
| **🎵 Paired Media**             | Attach an audio track (`.mp3`/`.wav`/`.ogg`) to a static image alert; the overlay shows the image for exactly the audio's length.                                                       |
| **🎖️ Milestone & Tier Alerts**  | Per-file thresholds for sub-renewal months (`minMonths`/`maxMonths`) and gift-sub counts (`minCount`/`maxCount`).                                                                       |
| **🎛️ Stream Deck REST API**     | Sub-5ms loopback endpoints (`/api/control/skip`, `/replay`, `/pause`, `/resume`, `/mute`, `/volume`, `/clear`) for hardware keypads and macros.                                         |
| **💾 1-Click Backup & Restore** | Export/import settings, media and alert history (see Backup & Restore below) as a standard `.zip` using Node's native `zlib` — no external tools.                                                          |
| **🪙 Live Currency Rates**      | USD→Toman from Nobitex's USDT/IRT orderbook, with Baha24 as the USD fallback; Baha24 and Bonbast provide supported non-USD quotes.                                                      |
| **⚡ Performance Engineering**  | Async `fs.promises` I/O for uploads/scans/restores, lazy on-hover video decoding in the file grid, targeted SSE (no polling), and HTTP 304 ETag caching.                                |
| **🧩 Modular Server**           | The backend is split into focused modules (`config`, `http`, `integrations`, `media`, `playback`, `rates`, `utils`) instead of one monolithic file — easier to audit, test, and extend. |
| **🪟 Modern Glassmorphic UI**   | Dark glass design system with custom dropdowns, modal dialogs, slim scrollbars, and a bento-grid layout.                                                                                |

---

## ✨ Key Features

### ⚡ Performance & Resource Efficiency

- **Non-Blocking Asynchronous I/O (`fs.promises`):** File uploads, media scans, and zip backup/restore use asynchronous file and stream operations to keep large media work off the main event loop.
- **Lazy On-Hover Video Decoding:** File cards in the controller render lightweight static posters; video preview elements decode only on mouse hover, dramatically reducing GPU decoder saturation and RAM spikes.
- **Targeted Server-Sent Events (SSE):** Replaced repetitive 8-second HTTP polling with instant, event-driven server pushes (`state`, `config`, `goal_update`, `rate`, `backup_restored`).
- **HTTP 304 ETag Static Caching:** Fonts, static CSS/JS, and branding assets leverage `ETag` headers to return `304 Not Modified`, saving socket bandwidth and speeding up OBS browser source refreshes.

### 🪙 Real-Time Currency Conversion

- **Nobitex USDT/IRT Orderbook (Primary):** Live dollar-to-toman conversion powered by Nobitex's real-time orderbook API (`/v3/orderbook/USDTIRT`), converting Iranian Rials to Toman with zero external dependencies.
- **Baha24 and Bonbast FX:** Baha24 supplies supported non-USD quotes during normal Nobitex operation and the fallback USD quote if Nobitex fails. Bonbast supplies fallback non-USD quotes.
- **Proxy & Manual Pinning:** Configurable HTTP/HTTPS proxy support and manual rate locking — plus automatic use of the **Windows system proxy** (e.g. v2rayN in "system proxy" mode) for kick.com and rate sources when the manual field is empty.

### 🎬 Advanced Streamer Tools

- **⌨️ Kick Chat Commands:** Viewers type a command in Kick chat (`!dance`, `!hype`, …) and the mapped alert file plays on stream — free of charge. Three rate-limit layers (per viewer, global, per minute) plus a queue cap stop spam waves; each command maps to any uploaded file and has its own card template.
- **🥇 Queue Priority for Subs:** Subscriptions and gift-sub alerts jump ahead of regular tips in the queue (FIFO inside each class), so live moments play while they are fresh; capture retries and replays keep their original ordering.
- **🎊 Milestone Confetti:** Bursts of confetti on the overlay when the goal completes (once per goal), when a single donation passes a configurable threshold, or on the first sub of the day — all toggleable on the Goal page.
- **⏳ Timed Goal (Countdown):** Optional deadline for the goal widget with a live `DD روز HH:MM:SS` countdown, "زمان تمام شد" state, and server-clock correction against client clock skew.
- **🔢 Live Sub & Gift Counters:** The goal widget shows running totals — `⭐ ۱۲ ساب · 🎁 ۳۴ سابگیفت · امروز ۵ ساب` — updating on every sub and gift-sub, persisting across restarts, and zeroing with the goal reset.
- **📜 Alert History & Daily Totals:** A dedicated page (and API) with every alert shown on stream, today's/7-day/all-time sums, per-day breakdown, and top donors. The ledger is pruned at 20k entries while day totals and donor sums are kept forever; it rides along in backups.
- **🥇 Top-Donors OBS Widget:** `/top` Browser Source rendering a live leaderboard (`?range=daily|weekly|all&limit=1..20&title=…`) with medals for the top 3 and Persian Toman figures, refreshed by SSE on every alert.
- **🎵 Paired Media (Sound for Images):** Attach custom audio files (`.mp3`, `.wav`, `.ogg`) to static PNG/GIF/WebP images. The overlay displays the graphic and locks alert duration to the audio track.
- **🎨 Multi-Profile Scene Overlays:** Tailor appearance, positioning, and card scale for different OBS scenes via URL query parameters (e.g. `/overlay?profile=gameplay`, `/overlay?profile=chatting`) without running duplicate server instances.
- **🎯 Live Donation & Sub Goal Widget:** Dedicated OBS Browser Source (`/goal` & `/goal.html`) rendering real-time animated progress bars and Persian Toman figures, complete with celebratory confetti at 100%.
- **🎖️ Milestone & Tier Alerts:** Configure tier thresholds for subscription renewals (`minMonths` / `maxMonths`) and bulk gifted subscriptions (`minCount` / `maxCount`).
- **⏱️ Card Delay:** Show the name/amount card (and KickBot TTS) a few seconds after the alert media starts — globally on the Look page, or per file in the file editor.
- **💾 Backup & Restore:** Export and import settings, media and alert history as standard `.zip` archives. Each media entry is limited to 512 MB and an archive to 1 GB. Provider credentials are omitted from portable backups; reconnect KickBot and StreamElements after restoring. Media files that are not part of the backup stay on this computer; the configured port is unchanged by a restore; proxy credentials are stripped from exports like other credentials. Previously played alert IDs are local to each installation.

### 🔄 Updates & Connectivity (upstream parity through Sahne+ 1.3.5)

- **In-App Updater:** The app checks this repository's GitHub Releases 30 s after start and every 6 hours (can be turned off in Settings). One click downloads the official installer, verifies it against the release's `SHA256SUMS.txt`, and installs it — never silently, never automatically.
- **Kick Behind a Filter:** If kick.com is filtered on your network, Sahne ProMax automatically uses your VPN app's Windows system proxy (manual proxy still wins; SOCKS-only setups need TUN mode or a manual HTTP proxy).
- **Readable Kick Errors:** The Kick card explains problems in Persian — kick.com filtered, channel not found, request refused — instead of raw codes like `read ECONNRESET`.
- **StreamElements Tips:** Connect with the JWT token from StreamElements → Account → Channels → Show secrets. The credential is stored locally and uses Electron `safeStorage` encryption when available; disconnect it from Settings to remove it.
- **Other Tip Currencies:** Supported StreamElements currencies are converted using the configured rate and matched against the same toman-based alert tiers. The alert card retains the tip's original amount and currency.

---

## 🎛️ Stream Deck & Hardware REST API

Sahne ProMax provides sub-5ms loopback endpoints for Elgato Stream Deck, Loupedeck, Touch Portal, or custom macro keypads:

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
- **Node.js:** `>= 22.0.0`
- **OBS Studio** or **Meld Studio**

### Installation & Running

**Download the installer** from the [Releases page](https://github.com/B3hnamR/sahne-promax/releases/latest) — or build from source:

```bash
# Clone the repository
git clone https://github.com/B3hnamR/sahne-promax.git
cd sahne-promax

# Install dev dependencies (Electron & Prettier)
npm install

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
    └── promax.test.js        # ProMax features & Nobitex rate tests
```

---

## 🛡️ Security & Privacy

- **No Cloud Backend:** Your media, settings, logs, and alert history remain on your machine (`Documents\Sahne Plus`); the app connects directly to the third-party services its features need.
- **Encrypted Secrets:** KickBot and StreamElements credentials use Windows DPAPI through Electron `safeStorage` when available; they are not returned by the local HTTP API or written to logs.
- **Strict Loopback Protection:** The local server binds exclusively to `127.0.0.1` and enforces strict `Host` and `Origin` validation to block DNS rebinding and cross-site request forgery (CSRF).
- **Event-Stream Gating:** `/events` refuses cross-site pages (`Origin` / `Sec-Fetch-Site`) and caps concurrent streams per role, so a random open browser tab can't consume alerts while OBS is closed.
- **Registered-Media Only:** `/media/…` serves only files registered as alerts (or their paired audio) — never notes or partial uploads left in the folder.
- **No Remote Debugging:** The packaged app strips Chromium's `--remote-debugging-*` switches so the controller window can't be scripted over the DevTools protocol.
- **Hardened CSP:** Content Security Policies isolate overlay rendering, block remote script executions, and prevent XSS or CSS iframe escapes.
- **Verified Updates Only:** The updater downloads solely from this repository's Releases and runs the installer only if its SHA-256 matches the release's `SHA256SUMS.txt` — and only after you click.

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

---

## 📜 License

Open source under the [Apache License 2.0](LICENSE).  
Copyright © 2026 Behnam & Contributors. Based on upstream work by [AmirEyZed](https://github.com/AmirEyZed/sahne-plus).

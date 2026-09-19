<div align="center">

# ⚡ Sahne ProMax

**High-Performance, Modular, Zero-Dependency Stream Alerts & Widgets for Kick on Windows**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-43.7.3-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org)
[![Zero Dependencies](https://img.shields.io/badge/Runtime%20Dependencies-0-brightgreen?style=flat-square)](#architecture)
[![Tests](https://img.shields.io/badge/Tests-14%2F14%20Passing-success?style=flat-square)](#testing)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

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

**Sahne ProMax** is a modernized, modular fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) designed specifically for Kick streamers. It plays transparent WebM animations, GIFs, images, and audio alerts on stream for **KickBot donations**, **Kick subscriptions**, and **Kick gifted subscriptions** — completely local on your machine with **zero cloud dependencies** and **zero runtime npm packages**.

ProMax elevates the foundation with **asynchronous non-blocking file I/O**, **GPU decoder throttling via lazy loading**, **Nobitex USDT/IRT live currency conversions**, a **standalone OBS Goal Widget**, **Stream Deck / hardware REST endpoints**, **Paired Media audio synchronization**, and **1-Click native `.zip` Backup & Restore**.

> **Note:** Sahne ProMax is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, Nobitex, or Baha24.

---

## ✨ Key Features

### ⚡ Performance & Resource Efficiency
- **Non-Blocking Asynchronous I/O (`fs.promises`):** File uploads, media scans, and zip restores run asynchronously off the event loop, preventing UI freezes when handling large 50–200 MB media files.
- **Lazy On-Hover Video Decoding:** File cards in the controller render lightweight static posters; video preview elements decode only on mouse hover, dramatically reducing GPU decoder saturation and RAM spikes.
- **Targeted Server-Sent Events (SSE):** Replaced repetitive 8-second HTTP polling with instant, event-driven server pushes (`state`, `config`, `goal_update`, `rate`, `backup_restored`).
- **HTTP 304 ETag Static Caching:** Fonts, static CSS/JS, and branding assets leverage `ETag` headers to return `304 Not Modified`, saving socket bandwidth and speeding up OBS browser source refreshes.

### 🪙 Real-Time Currency Conversion
- **Nobitex USDT/IRT Orderbook (Primary):** Live dollar-to-toman conversion powered by Nobitex's real-time orderbook API (`/v3/orderbook/USDTIRT`), converting Iranian Rials to Toman with zero external dependencies.
- **Baha24 API (Fallback):** Seamless automatic failover to Baha24 if local or foreign network interruptions occur.
- **Proxy & Manual Pinning:** Configurable HTTP/HTTPS proxy support and manual rate locking.

### 🎬 Advanced Streamer Tools
- **🎵 Paired Media (Sound for Images):** Attach custom audio files (`.mp3`, `.wav`, `.ogg`) to static PNG/GIF/WebP images. The overlay displays the graphic and locks alert duration to the audio track.
- **🎨 Multi-Profile Scene Overlays:** Tailor appearance, positioning, and card scale for different OBS scenes via URL query parameters (e.g. `/overlay?profile=gameplay`, `/overlay?profile=chatting`) without running duplicate server instances.
- **🎯 Live Donation & Sub Goal Widget:** Dedicated OBS Browser Source (`/goal` & `/goal.html`) rendering real-time animated progress bars and Persian Toman figures, complete with celebratory confetti at 100%.
- **🎖️ Milestone & Tier Alerts:** Configure tier thresholds for subscription renewals (`minMonths` / `maxMonths`) and bulk gifted subscriptions (`minCount` / `maxCount`).
- **💾 Zero-Dependency 1-Click Backup & Restore:** Export and import complete backups (`config.json` + all media files) as standard `.zip` archives via Node's native `zlib`.

---

## 🎛️ Stream Deck & Hardware REST API

Sahne ProMax provides sub-5ms loopback endpoints for Elgato Stream Deck, Loupedeck, Touch Portal, or custom macro keypads:

| Endpoint | Method | Parameters | Description |
|---|---|---|---|
| `/api/control/skip` | `POST` | None | Immediately stops current alert and advances to next |
| `/api/control/replay` | `POST` | None | Re-enqueues and replays the last finished alert |
| `/api/control/pause` | `POST` | None | Pauses alert queue playback |
| `/api/control/resume` | `POST` | None | Resumes alert queue playback |
| `/api/control/mute` | `POST` | None | Toggles master overlay audio mute |
| `/api/control/volume` | `POST` | `val=0..100` | Sets master overlay volume |
| `/api/control/clear` | `POST` | None | Clears all pending alerts in queue |

---

## 🚀 Quick Start

### Prerequisites
- **Operating System:** Windows 10 or 11 (x64)
- **Node.js:** `>= 22.0.0`
- **OBS Studio** or **Meld Studio**

### Installation & Running

```bash
# Clone the repository
git clone https://github.com/B3hnamR/sahne-promax.git
cd sahne-promax

# Install dev dependencies (Electron & Prettier)
npm install

# Run the test suite (14 automated tests)
npm test

# Launch the desktop application
npm start
```

### OBS Studio Setup
1. In OBS, add a **Browser Source**.
2. **Alert Overlay URL:** `http://localhost:7788/overlay` (Width: `1920`, Height: `1080`).
   - For specific scenes: `http://localhost:7788/overlay?profile=gameplay`
3. **Goal Widget URL:** `http://localhost:7788/goal` (Width: `640`, Height: `120`).
4. Check **Shutdown source when not visible** and **Refresh browser when scene becomes active**.

---

## 🏗️ Architecture

Sahne ProMax follows a strict **zero-runtime-dependency** philosophy. All core server functionality relies exclusively on standard Node.js native modules (`http`, `https`, `crypto`, `fs`, `path`, `zlib`).

```
sahne-promax/
├── electron/                 # Electron main process, tray menu, DPAPI bridge
├── server/                   # Decoupled backend domain modules
│   ├── index.js              # Server orchestrator & lifecycle management
│   ├── constants.js          # System limits, MIME types, default configuration
│   ├── logger.js             # Redacted in-memory ring buffer & file logging
│   ├── sse.js                # SSE subscriber hub (overlay, admin, goal)
│   ├── config/               # Atomic config persistence & played tip ledger
│   ├── features/             # Goal widget engine & 1-click zip backup/restore
│   ├── http/                 # Hardened loopback router, static server, range streaming
│   ├── integrations/         # KickBot WebSocket, Kick chat feed, Meld monitor
│   ├── media/                # Async media manager & streaming upload sniffer
│   ├── playback/             # Priority queue scheduler & payment capture engine
│   ├── rates/                # Nobitex USDT/IRT (primary) & Baha24 (fallback)
│   └── utils/                # Magic byte sniffing, input sanitizers, HTTP client
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
    ├── server.test.js        # Hardening, loopback security, traversal tests
    ├── overlay-xss.test.js   # XSS & CSS injection prevention tests
    └── promax.test.js        # ProMax features & Nobitex rate tests
```

---

## 🛡️ Security & Privacy

- **No Cloud Backend:** Your media, settings, and logs remain strictly local on your machine (`%APPDATA%\Sahne ProMax` or `Documents\Sahne Plus`).
- **Encrypted Secrets:** KickBot API keys are encrypted at rest using Windows DPAPI (`CryptProtectData`) and never exposed over HTTP or written to logs.
- **Strict Loopback Protection:** The local server binds exclusively to `127.0.0.1` and enforces strict `Host` and `Origin` validation to block DNS rebinding and cross-site request forgery (CSRF).
- **Hardened CSP:** Content Security Policies isolate overlay rendering, block remote script executions, and prevent XSS or CSS iframe escapes.

For detailed privacy information and network flow mapping, see [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md) and [`docs/legal/PRIVACY.md`](docs/legal/PRIVACY.md).

---

## 🧪 Testing

Run the automated test suite with Node's native test runner:

```bash
npm test
```

All 14 integration and unit tests run in offline test-harness mode:
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

---

## 📜 License

Open source under the [Apache License 2.0](LICENSE).  
Copyright © 2026 Behnam & Contributors. Based on upstream work by AmirEyZed.

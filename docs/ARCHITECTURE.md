# Sahne ProMax 2.0.0 — Modernized High-Performance Architecture & Feature Guide

**Sahne ProMax** is a modernized, modular, high-performance fork of Sahne Plus built upon the stable v1.3.0 foundation. It retains the strict **zero-runtime-dependency philosophy** and loopback security model while eliminating event-loop blocking, reducing CPU/RAM/GPU spikes, refactoring monolithic code into clean domain modules, and delivering advanced streamer tools.

---

## 1. Architectural Highlights

### 1.1 Backend Modularization (`server/`)
The previous monolithic `server.js` (~2,200 lines) has been decomposed into domain-specific modules:

```
server/
├── index.js                  # Application orchestrator: createServer(), lifecycle hooks
├── constants.js              # Limits, MIME types, default configuration, font definitions
├── utils/
│   ├── validation.js         # Magic byte sniffing (sniffOk), safeMediaName, cleanText, normFa
│   ├── sanitizers.js         # sanitizeFile, sanitizeAppearance, sanitizeProfile, sanitizeGoal
│   └── http-client.js        # Native HTTPS request client with HTTP CONNECT proxy support
├── config/
│   ├── store.js              # Atomic JSON config persistence, secretStore DPAPI bridge
│   └── played.js             # Played tip IDs memory cache and debounced flush
├── logger.js                 # Redacted in-memory ring buffer & file logging
├── sse.js                    # SSE subscriber registry (overlay, admin, goal) & heartbeat
├── rates/
│   ├── nobitex.js            # Nobitex USDTIRT orderbook rate fetcher (Primary)
│   ├── baha24.js             # Baha24 currency rate fetcher (Fallback)
│   └── manager.js            # Rate manager with caching, polling scheduler, manual overrides
├── integrations/
│   ├── kickbot.js            # KickBot WebSocket client, pulse keep-alives, capture loop
│   ├── kick-chat.js          # Kick Pusher chat client, channel slug resolver, gift debouncer
│   └── meld.js               # Meld Studio loopback WebSocket monitor
├── media/
│   ├── manager.js            # Async file scanner, safe file imports, disk removals
│   └── upload.js               # Streaming temp write stream with magic byte sniffing
├── playback/
│   ├── queue.js              # Priority queue scheduling, queue pause/resume, skip, replay
│   ├── picker.js             # Amount, keyword, and sub milestone media matching
│   └── capture.js            # Stripe/KickBot payment capture loop with exponential backoff
├── features/
│   ├── goal.js               # Donation & sub goal engine with auto-increment & SSE sync
│   └── backup.js             # Zero-dependency .zip creation & restore via Node zlib
└── http/
    ├── router.js             # HTTP request dispatching, Host/Origin loopback security
    └── streaming.js          # Static asset server (ETag / 304) + byte-range (HTTP 206) media streaming
```

### 1.2 Frontend Native ES Modules (`public/js/`)
`public/app.js` has been converted into native ECMAScript Modules loaded via `<script type="module" src="/js/app.js">`:
- `api.js`: Low-level network fetch helpers, formatters (`fmtToman`, `fmtSize`, `faNum`), toast notifications.
- `state.js`: Global reactive application store.
- `nav.js`: Tab switching and window control hooks.
- `inspector.js`: Inspector sidebar with Paired Audio selector and Milestone inputs.
- `files.js`: File card rendering with hover-activated video decoding.
- `look.js`: Interactive canvas drag-and-drop card positioning and appearance settings.
- `goal.js`: Goal widget controller tab bindings and preview frame.
- `controls.js`: Stream Deck and hardware REST endpoint handlers (`skip`, `replay`, `pause`, `resume`, `mute`, `clear`).
- `backup.js`: 1-Click Backup download and restore modal logic.
- `app.js`: Main coordinator bootstrapping all modules and maintaining the administrative SSE link.

---

## 2. Resource & Performance Optimizations

1. **Non-Blocking Asynchronous File I/O (`fs.promises`):**
   - Media imports, uploads, file scanning, and backup extractions use asynchronous operations (`fs.promises.copyFile`, `fs.promises.readdir`, `fs.promises.writeFile`).
   - Eliminates event-loop stalls when streamers upload high-bitrate 50–200 MB alert videos during live streams.

2. **Lazy On-Hover Video Element Initialization:**
   - File cards in the controller grid render lightweight static poster placeholders (`preload="none"`).
   - Video sources are attached only when the mouse hovers over a specific card.
   - Prevents saturating hardware video decoders and saves significant RAM when handling large media libraries.

3. **Targeted SSE Push Pipeline (Eliminated 8s Polling):**
   - Replaced periodic `setInterval` HTTP polling with real-time SSE broadcasts (`state`, `config`, `goal_update`, `rate`, `backup_restored`).
   - UI updates instantly upon state mutations with zero idle network traffic.

4. **HTTP ETag & 304 Not Modified Caching:**
   - Static assets (`InterVariable.woff2`, `Vazirmatn-wght.woff2`, `Lalezar-Regular.ttf`, styles) return `ETag` headers derived from file size and modification timestamps.
   - Returns HTTP `304 Not Modified` on subsequent requests, reducing browser and OBS source reload latency.

---

## 3. New Streamer ProMax Features

### 3.1 Paired Media (Custom Sound for Image Alerts)
- Link any audio file (`.mp3`, `.wav`, `.ogg`) to a static image alert.
- When triggered, `overlay.js` renders the image and synchronizes playback duration with the paired audio track.

### 3.2 Multi-Profile Scene Overlays
- Configure scene-specific visual appearances (e.g., `gameplay`, `chatting`, `vertical`).
- Load profiles in OBS Browser Source via `/overlay?profile=<name>` (or `/overlay.html?profile=<name>`).
- Supports different positioning, card scaling, and font sizes without running separate server instances.

### 3.3 Hardware & Stream Deck REST API
Sub-5ms loopback endpoints for hardware deck buttons and macro keypads:

| Endpoint | Method | Description |
|---|---|---|
| `/api/control/skip` | `POST` | Immediately skips the currently playing alert and plays the next in queue |
| `/api/control/replay` | `POST` | Re-enqueues and replays the last finished alert |
| `/api/control/pause` | `POST` | Pauses alert queue playback |
| `/api/control/resume` | `POST` | Resumes paused alert queue |
| `/api/control/mute` | `POST` | Toggles overlay master audio mute |
| `/api/control/volume?val=N` | `POST` | Sets master volume (`0` to `100`) |
| `/api/control/clear` | `POST` | Empties all queued pending alerts |

### 3.4 Live Donation & Subscription Goal Widget
- OBS Browser Source URL: `http://127.0.0.1:7788/goal` (or `/goal.html`).
- Tracks donations and subscriptions towards customizable financial targets.
- Real-time animated CSS progress bar driven by Server-Sent Events (`goal_update`).
- Automatically fires a celebratory confetti animation upon reaching 100%.

### 3.5 Milestone Subscription & Gift-Tier Alerts
- Configure distinct alerts for subscription renewals:
  - `minMonths` & `maxMonths` (e.g. 3-month, 6-month, 12-month loyalty tiers).
- Configure distinct alerts for bulk gifted subscriptions:
  - `minCount` & `maxCount` (e.g. 5+, 20+, 50+ gift bombs).

### 3.6 Zero-Dependency 1-Click Backup & Restore (.zip)
- Built-in ZIP generation and decompression engine leveraging Node's native `zlib` library.
- **Export Backup:** `GET /api/backup` creates a complete zip archive of all media files and `config.json`.
- **Restore Backup:** `POST /api/restore` extracts the archive directly into the data folder and reloads configuration dynamically.

---

## 4. Verification & Testing

The complete test suite runs via:
```bash
npm test
```

### Verified Test Suites
- **`test/server.test.js`**: Core security hardening (Host/Origin header verification, path traversal prevention, secret redaction, Persian/Arabic digit normalization, HTTP range streaming, and capture retry resiliency).
- **`test/overlay-xss.test.js`**: Overlay XSS sanitation, CSS escape injection, HTML entity escaping, and foreign URL blocking.
- **`test/promax.test.js`**:
  1. Paired Media & Milestone Sub Alerts matching logic.
  2. Stream Deck & Hardware REST Controls.
  3. Live Donation & Sub Goal Engine (auto-increment, target reset, SSE broadcast).
  4. Zero-Dependency 1-Click Backup & Restore (.zip round-trip).
  5. HTTP ETag Static Caching (304 Not Modified).

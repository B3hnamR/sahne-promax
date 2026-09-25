# Sahne ProMax 2.6.0

**Release date:** 2026-09-26 · **Base:** ProMax 2.5.1 with upstream Sahne+ features through 1.3.5

This release adds Donofa donations and a local analytics dashboard, and ports fixes from upstream pull requests into ProMax's provider and playback architecture.

## New features

- **Donofa support:** Connect a Donofa API key from Settings and select `donofa.ir` or `donofa.com`. Paid toman donations enter the existing alert queue and can use media tiers, routing rules, the goal widget, history, and analytics. Optional Donofa TTS audio plays with its donation. The key is stored locally, encrypted with Electron `safeStorage` when available, and omitted from portable backups; reconnect after restoring. Live delivery requires a real Donofa account and donation to verify.
- **Local analytics dashboard:** Explore history by date range and source, including trends, donors, currency and playback breakdowns. It uses the local alert ledger and sends no analytics data to a remote service. Detailed coverage is limited to the most recent 20,000 retained events.

## Fixes

- Disconnecting KickBot no longer discards queued alerts from other providers.
- The playing alert shows its original currency with the toman equivalent.
- Removed the Bonbast FX fallback and old stored Bonbast quotes. Nobitex supplies primary USD; Baha24 supplies fallback USD and supported non-USD rates. If Baha24 is unavailable, the app retains previous non-USD quotes when present and labels them as previous in the log.
- Refined the Donofa settings card with clearer fields, status and connection feedback.

## Updating

From 2.5.1, click **آپدیت** in the desktop app or download the installer from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases). The app verifies the downloaded installer against `SHA256SUMS.txt` before running it. Existing settings, rules, media and history remain in the local data folder. Connect Donofa in Settings with your own API key.

## Release files

- `Sahne-ProMax-Setup-2.6.0.exe` — Windows installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — Persian guide

The installer is not Authenticode-signed, so Windows SmartScreen may warn. Check the release page for the build-provenance attestation. Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with its external providers.

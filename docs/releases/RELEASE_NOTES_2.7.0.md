# Sahne ProMax 2.7.0

**Release date:** 2026-10-06 · **Base:** ProMax 2.6.0 with Sahne+ changes through 1.4.1 adapted to ProMax

This release brings the upstream Sahne+ 1.4.1 behavior into ProMax while retaining Donofa, StreamElements, the analytics dashboard, and ProMax's sub-first queue.

## Alert playback and recovery

- Waiting KickBot, StreamElements, Donofa, and Kick subscription alerts survive an app restart. A paid KickBot tip captured just as the OBS Browser Source disconnects waits for playback instead of disappearing. Donofa TTS arriving after its donation is retained with the waiting alert.
- Video and audio alerts can play to their actual end beyond the global duration; a file-specific duration also works for images. A one-hour safety limit prevents a stuck alert from occupying the queue indefinitely.
- KickBot queue delay and pause/play settings apply. Disconnecting KickBot removes its own dashboard test tips without clearing ProMax test alerts or other providers' alerts. Capture retries preserve subscription priority.

## Settings and reliability

- **Local history recording switch:** Turn off recording in Settings → App to keep new alerts out of saved history and the analytics dashboard. Live totals and the top-donors widget continue updating in memory until the app restarts. Logs and waiting-alert storage are separate from this setting; previously saved history remains available.
- KickBot widget-link fields are masked and cleared after connecting. The media editor rejects an amount range whose maximum is below its minimum.
- The updater times out stalled downloads and distinguishes stalled disk writes from network failures.
- Pull request CI is configured for Ubuntu and Windows; the screenshot script accepts a custom local port.

## Updating

From 2.6.0, click **آپدیت** in the desktop app or download the installer from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases). The app checks the download against `SHA256SUMS.txt` before running it. Settings, rules, media, and saved history remain in the local data folder. Portable backups omit provider credentials, so reconnect providers after a restore.

## Release files

- `Sahne-ProMax-Setup-2.7.0.exe` — Windows installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — Persian guide

The installer is not Authenticode-signed, so Windows SmartScreen may warn. Check the release page for any build-provenance attestation. Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with its external providers.

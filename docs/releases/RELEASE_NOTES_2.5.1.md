## Sahne ProMax 2.5.1

**Version:** 2.5.1 · **Release date:** 2026-09-23 · **Base:** ProMax 2.5.0 with upstream Sahne+ 1.3.5

This patch corrects Alert Rules editing, simulation and preview.

### Fixes

- The "Try this event" panel now passes the entered tip to the existing tier and keyword picker. Gift bundles use their full value, and simulated subscriptions include their month count.
- Rule editing preserves multiple providers and event types, maximum subscription months and maximum gift counts.
- Rules referencing deleted media stay visible and no longer block unrelated edits. New references to unregistered files are still rejected.
- Preview is tied to the latest successful simulation and retains the event type, count, subscription months and original currency. Changed inputs and older responses cannot replay a stale match.

### Updating

In the desktop app, click **آپدیت** after the new-version notice, or download the installer from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases). The app checks the installer against `SHA256SUMS.txt` before running it. Existing settings, routing rules and media remain in the local data folder.

### Files in this release

- `Sahne-ProMax-Setup-2.5.1.exe` — Windows installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — راهنمای فارسی

### Notice

The installer is not Authenticode-signed; Windows SmartScreen may warn. A checksum checks the installer against the published manifest; it does not prove publisher identity. Check the release page for any build-provenance attestation, and download Sahne ProMax only from this fork's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus), not an official Sahne+ release. It is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24 or Bonbast.

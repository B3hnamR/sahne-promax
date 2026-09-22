## Sahne ProMax 2.4.0

**Version:** 2.4.0 · **Release date:** 2026-09-23 · **Base:** Sahne ProMax 2.3.0 with upstream Sahne+ 1.3.4–1.3.5 ancestry

### Upstream ancestry

This release incorporates upstream v1.3.4 and v1.3.5 source changes into ProMax's modular server and controller. ProMax keeps its own installer, update channel, local data model, goal and stats features, and overlay architecture.

### Newly ported features

- **💸 StreamElements tips** — connect a StreamElements channel with its JWT from Account → Channels → Show secrets. Realtime tips use the existing ProMax alert queue and file tiers. The token is stored locally and encrypted with Electron `safeStorage` when available; disconnect the provider to remove it.
- **💱 Other tip currencies** — supported StreamElements currencies, including EUR, GBP, AED and TRY, are converted using the configured rate and matched against the same toman-based tiers. The alert retains the original tip amount and currency alongside the toman value. Currencies without a supported conversion remain labeled and are not silently treated as USD.

### Privacy and security documentation

- Updated the in-app privacy, terms, security and third-party notices for the ProMax fork, StreamElements credentials, rate sources, GitHub update checks and persistent alert history.
- The history ledger remains local, keeps up to 20,000 alert entries plus aggregate totals, and is included in backups.

### How to update

Any 2.3.x install can check this repository's Releases page. Click **آپدیت** to download and install 2.4.0; the updater verifies the installer against the release's `SHA256SUMS.txt` before running it.

### Files in this release

- `Sahne-ProMax-Setup-2.4.0.exe` — Windows installer (per-user, no admin rights needed)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — راهنمای فارسی

### Notice

The installer is not Authenticode-signed; Windows SmartScreen may warn. A checksum verifies the downloaded file against the published manifest; it is not a security audit or proof of publisher identity. Check the release page for any build-provenance attestation. Download Sahne ProMax only from this repository's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus), not an official Sahne+ release. It is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24 or Bonbast.

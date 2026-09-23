## Sahne ProMax 2.4.1

**Version:** 2.4.1 · **Release date:** 2026-09-23 · **Base:** ProMax 2.4.0 with upstream Sahne+ 1.3.5

This update fixes issues found after the StreamElements and multi-currency port. The fork includes all commits through upstream Sahne+ v1.3.5.

### Changes

- USD alerts use the Nobitex or Baha24 quote as soon as it is available, even when optional currency sources respond slowly.
- StreamElements, Kick chat and KickBot connection resets no longer let an older socket or queue sync disturb the new connection.
- Backups stream within documented limits, validate before replacing live files, omit provider and proxy credentials, preserve media absent from the archive, and show which providers need reconnection after restore.
- Settings and alert history saves cannot overwrite newer restored data. A failed file deletion keeps the pending media edit.
- Currency labels and `{usd}`/`{original}` placeholders, upload feedback, confirmation keyboard behavior, and the browser controller's version display are corrected.
- The gold appearance preset uses the upstream 1.3.5 “tipped” wording.
- The updater handles disk errors during downloads. The release job verifies uploaded installer checksums before publishing.

### Updating

In the desktop app, click **آپدیت** after the new-version notice, or download the installer from this repository's Releases page. The app checks the installer against `SHA256SUMS.txt` before running it. Existing settings and media remain in the local data folder.

If you restore a backup on another installation, reconnect KickBot and StreamElements in Settings. Backup ZIPs deliberately omit their credentials.

### Files in this release

- `Sahne-ProMax-Setup-2.4.1.exe` — Windows installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — راهنمای فارسی

### Notice

The installer is not Authenticode-signed; Windows SmartScreen may warn. A checksum checks the installer against the published manifest; it does not prove publisher identity. Check the release page for any build-provenance attestation, and download Sahne ProMax only from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases).

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus), not an official Sahne+ release. It is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24 or Bonbast.

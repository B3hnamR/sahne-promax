## Sahne ProMax 2.5.0

**Version:** 2.5.0 · **Release date:** 2026-09-23 · **Base:** ProMax 2.4.1 with upstream Sahne+ 1.3.5

This update adds alert media routing rules and fixes replay fidelity.

### Changes

- **Alert media routing rules:** define ordered rules with conditions — provider (KickBot, StreamElements, Kick), alert type (tip, sub, gift), currency, minimum/maximum toman value, message contains, subscription months and gift count. The first matching rule selects the alert file; if nothing matches, the existing tier and keyword picker decides exactly as before.
- **Rules page:** a new controller page with an ordered editor, per-file warnings for missing or disabled media, and a "Try this event" panel that explains which rule won and why, with a side-effect-free preview.
- **Explainable history:** every displayed alert records the rule that selected its media.
- **Replay fidelity:** replay keeps the original currency, provider and file (previously a foreign-currency replay was re-resolved as USD), falling back to the rules and picker only when that file is gone.
- **Unchanged safeguards:** version 2.4.1's rate timing, connection-generation, portable backup/restore and updater fixes remain in place.

### Updating

In the desktop app, click **آپدیت** after the new-version notice, or download the installer from this repository's Releases page. The app checks the installer against `SHA256SUMS.txt` before running it. Existing settings and media remain in the local data folder, and routing rules travel with them.

### Files in this release

- `Sahne-ProMax-Setup-2.5.0.exe` — Windows installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — راهنمای فارسی

### Notice

The installer is not Authenticode-signed; Windows SmartScreen may warn. A checksum checks the installer against the published manifest; it does not prove publisher identity. Check the release page for any build-provenance attestation, and download Sahne ProMax only from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases).

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus), not an official Sahne+ release. It is not affiliated with, endorsed by, or sponsored by Kick, KickBot, StreamElements, Nobitex, Baha24 or Bonbast.

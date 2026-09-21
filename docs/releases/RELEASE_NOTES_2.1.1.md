## Sahne ProMax 2.1.1 (ports Sahne+ 1.3.2)

**Version:** 2.1.1 · **Release date:** 2026-09-21 · **Upstream base:** [Sahne+ 1.3.2](https://github.com/AmirEyZed/sahne-plus/releases/tag/v1.3.2)

### What's new (ported from Sahne+ 1.3.2)
- **Two security fixes** reported by [KernelDotDLL](https://github.com/KernelDotDLL) (thank you). A web page open in the streamer's browser could connect to the alert event stream: it could not read anything, but the connection counted as a Browser Source, so an alert could be consumed while OBS was closed. The stream now refuses connections from other sites and limits how many connections each role may open. The media route also served every file in the media folder; only registered alert files (and their paired audio) are served now.
- **Hardening:** the packaged app ignores Chromium's remote-debugging switches, so it can't be started with the DevTools protocol open. Development runs are unchanged.
- **Fixed:** in the file editor the header icon was oversized and the preview could collapse when the window was short; the panel now scrolls instead of squashing its parts.

### How to update
Sahne ProMax 2.1.0 shows a notice inside the app: click **آپدیت** and the rest happens by itself.

### Files in this release
- `Sahne-ProMax-Setup-2.1.1.exe` — Windows installer (per-user, no admin rights needed)
- `SHA256SUMS.txt` — SHA-256 checksum of the installer (generated in the release workflow)
- `README-FA.md` — راهنمای فارسی

### Notice
SHA-256 checksums verify the integrity of downloaded files. The installer is not code-signed; Windows SmartScreen may warn — verify, then choose **More info → Run anyway**. Download Sahne ProMax only from this repository's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, Nobitex, baha24 or Bonbast.

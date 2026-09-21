## Sahne ProMax 2.1.0 (ports Sahne+ 1.3.1)

**Version:** 2.1.0 · **Release date:** 2026-09-19 · **Upstream base:** [Sahne+ 1.3.1](https://github.com/AmirEyZed/sahne-plus/releases/tag/v1.3.1)

### What's new (ported from Sahne+ 1.3.1)
- **Updates inside the app:** from now on Sahne ProMax shows a notice when a new version is out, and one click downloads, verifies and installs it — never without your click, and the check can be turned off in Settings. This version itself has to be installed manually once.
- **Kick subs with a VPN, no extra setup:** if kick.com is filtered on your network, Sahne ProMax now uses your VPN app's Windows system proxy automatically (for example v2rayN in "system proxy" mode). The detected proxy is shown in Settings; a manually entered proxy still comes first. SOCKS-only setups: turn on the VPN's TUN mode or enter its HTTP proxy.
- **Readable Kick errors:** the Kick card now explains the problem in Persian — kick.com filtered, channel not found, request refused by Kick — and what to do, instead of codes like `read ECONNRESET`.
- **Card delay:** the name and amount card (and the KickBot TTS) can appear a few seconds after the animation starts — globally on the Look page, or per file in the file editor.

### Kept from ProMax 2.0 (not in upstream)
- Modular server architecture, standalone OBS goal widget (`/goal`), paired media (audio for image alerts), appearance profiles (`?profile=gameplay|chatting`), Stream Deck / hardware REST endpoints, 1-click `.zip` backup & restore, Nobitex USDT/IRT rate source, dark glassmorphic UI with custom dropdowns and modals.

### Files in this release
- `Sahne-ProMax-Setup-2.1.0.exe` — Windows installer (per-user, no admin rights needed)
- `SHA256SUMS.txt` — SHA-256 checksum of the installer (generated in the release workflow)
- `README-FA.md` — راهنمای فارسی

### Notice
SHA-256 checksums verify the integrity of downloaded files. The installer is not code-signed; Windows SmartScreen may warn — verify, then choose **More info → Run anyway**. Download Sahne ProMax only from this repository's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, Nobitex, baha24 or Bonbast.

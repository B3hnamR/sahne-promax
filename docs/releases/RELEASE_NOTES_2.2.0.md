## Sahne ProMax 2.2.0

**Version:** 2.2.0 · **Release date:** 2026-09-21 · **Base:** Sahne ProMax 2.1.1 (upstream Sahne+ 1.3.2 parity)

### What's new — four streamer tools

- **⌨️ Kick chat commands** — viewers type a command in Kick chat (`!dance`, `!hype`, …) and the mapped alert file plays on stream. Free of charge, works with any uploaded file, and protected by per-viewer/global/per-minute limits so it can't be spammed. Command alerts get their own card text (configurable on the Look page). Set it up under Settings → دستورات چت کیک.
- **🥇 Subs jump the queue** — subscription and gift-sub alerts now play before regular tips (order is kept inside each group), so you can thank new subs while the moment is live. Replays and payment retries keep their original order.
- **🎊 Milestone confetti** — confetti bursts on your overlay when the goal is completed (once per goal), when a single donation passes a toman threshold you set, or on the first sub of the day. Turn each one on/off on the Goal page.
- **⏳ Timed goal** — give the goal a deadline and the widget shows a live countdown (`۲ روز ۰۳:۱۲:۴۵`), then "زمان تمام شد". The countdown is corrected against the server clock, so a wrong PC clock won't fool it.

### Fixed
- The goal page's switch was mislabeled ("صفر شدن خودکار…" — it actually enables auto-adding donations).

### How to update
Any 2.1.x install shows the update notice inside the app: click **آپدیت** — the installer is downloaded, verified against `SHA256SUMS.txt`, and the app restarts on 2.2.0 by itself.

### Files in this release
- `Sahne-ProMax-Setup-2.2.0.exe` — Windows installer (per-user, no admin rights needed)
- `SHA256SUMS.txt` — SHA-256 checksum of the installer (generated in the release workflow)
- `README-FA.md` — راهنمای فارسی

### Notice
SHA-256 checksums verify the integrity of downloaded files. The installer is not code-signed; Windows SmartScreen may warn — verify, then choose **More info → Run anyway**. Download Sahne ProMax only from this repository's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, Nobitex, baha24 or Bonbast.

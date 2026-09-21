## Sahne ProMax 2.3.0

**Version:** 2.3.0 · **Release date:** 2026-09-21 · **Base:** Sahne ProMax 2.2.0

### What's new — the stats pack

- **🔢 Live counters on the goal widget** — the goal now counts people too: total subs, gifted subs and today's subs (`⭐ ۱۲ ساب · 🎁 ۳۴ سابگیفت · امروز ۵ ساب`). Updates instantly on every sub and gift-sub, survives restarts, and the goal reset zeroes them. Toggle it on the Goal page.
- **📜 Alert history** — a new «تاریخچه و آمار» page with every alert shown on stream: today / last 7 days / all-time totals, the full alert list, daily breakdown and top donors. The ledger keeps the newest 20,000 entries while daily and donor totals are kept forever — and it's included in your `.zip` backups automatically.
- **🥇 Top-donors widget for OBS** — a second Browser Source showing a live leaderboard: add `http://localhost:7788/top` (420×240) and pick a period with `?range=daily` یا `?range=weekly` یا `?range=all` (default), `&limit=1..20` for rows, `&title=…` for a custom title. Medals for the top three, Persian Toman figures, updates the moment an alert plays.

### Notes

- Counters and totals exclude test alerts and replays; donors are grouped case-insensitively by display name.
- The history ledger lives next to your settings (`history.json` inside the data folder) and never leaves the machine.

### How to update

Any 2.2.x install shows the update notice inside the app: click **آپدیت** — the installer is downloaded, verified against `SHA256SUMS.txt`, and the app restarts on 2.3.0 by itself.

### Files in this release

- `Sahne-ProMax-Setup-2.3.0.exe` — Windows installer (per-user, no admin rights needed)
- `SHA256SUMS.txt` — SHA-256 checksum of the installer (generated in the release workflow)
- `README-FA.md` — راهنمای فارسی

### Notice

SHA-256 checksums verify the integrity of downloaded files. The installer is not code-signed; Windows SmartScreen may warn — verify, then choose **More info → Run anyway**. Download Sahne ProMax only from this repository's Releases page.

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with, endorsed by, or sponsored by Kick, KickBot, Nobitex, baha24 or Bonbast.

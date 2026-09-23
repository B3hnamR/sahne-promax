# Sahne ProMax — Privacy Policy

_Last updated: 2026-09-23 · Applies to Sahne ProMax 2.4.1_

**خلاصه‌ی فارسی:** Sahne ProMax سرور ابری ندارد. تنظیمات، فایل‌های رسانه، گزارش‌ها و سابقه‌ی الرت‌ها روی رایانه‌ی شما می‌مانند. برای دریافت الرت، برنامه به KickBot و در صورت اتصال StreamElements وصل می‌شود؛ رویداد ساب‌های کیک را از فید عمومی کیک دریافت می‌کند، نرخ دلار را از نوبیتکس (با پشتیبانی بهاء۲۴) و نرخ ارزهای دیگر را از بهاء۲۴ و در صورت نیاز بن‌بست می‌گیرد. برای بررسی نسخه‌ی جدید نیز به گیت‌هاب این مخزن وصل می‌شود. این ارتباط‌ها برای قابلیت‌های برنامه لازم‌اند؛ هیچ تحلیل‌گر، تبلیغ یا گزارش خطای خودکاری وجود ندارد و نصب به‌روزرسانی فقط پس از کلیک شما انجام می‌شود.

## 1. Who we are

Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus), maintained and released from [B3hnamR/sahne-promax](https://github.com/B3hnamR/sahne-promax). Questions and security reports for this fork belong on its repository, not the upstream project. See [SECURITY.md](../../SECURITY.md).

## 2. The short version

- Sahne ProMax has no cloud backend. Its controller and local alert server run on your computer.
- The application makes network requests to the third-party services required by its enabled features (section 4). Those providers receive the request data described below.
- The application contains no analytics, telemetry, advertising, or automatic crash reporting. It checks this fork's GitHub releases for updates; you can turn automatic checks off, and downloads/installations require your click.

## 3. What Sahne ProMax stores on your computer

Application files and settings live in `Documents\\Sahne Plus` for compatibility with existing Sahne ProMax installs. Electron keeps its browser profile in `%APPDATA%\\SahnePlus`.

| Data | File | Notes |
|---|---|---|
| Settings, alert tiers, channel names, currency options and app preferences | `config.json` | Plain JSON, except credentials stored through Electron `safeStorage` when available. |
| KickBot widget secret and StreamElements JWT (when connected) | `config.json` | Encrypted through Windows Data Protection using Electron `safeStorage` when available. If encryption is unavailable, the app indicates this in Settings and stores the secret without encryption. Disconnecting a provider removes its saved credential. |
| Imported alert media | `media\\` | Files are copied into the app's data folder; originals are not modified. |
| Recently played alert IDs | `played.json` | Keeps the most recent 1,000 IDs to avoid replaying events after restart. |
| Alert history | `history.json` | Stores up to 20,000 displayed alert records, including donor display name, event type, amount/currency and time, plus daily and per-donor aggregates that persist when old records are pruned. Included in backup exports. |
| Diagnostic log | `sahne-plus.log` | Local connection status and errors, and alert details such as donor name, amount, message and selected media. The log rotates at 5 MB. Provider credentials are redacted. |

The app's **Clear application data** action removes settings, played IDs, alert history, media and logs after confirmation. Uninstalling preserves the data folder so media and settings survive reinstall; delete `Documents\\Sahne Plus` manually if you want to remove it.

Backup exports contain settings, alert history and media, but omit KickBot and StreamElements credentials. After restoring a backup, reconnect those providers in Settings. Recently played alert IDs are local to each installation and are not transferred.

## 4. Network connections and why they exist

| Service | Purpose | What is sent or received |
|---|---|---|
| **KickBot** (`kickbot.live`, `widgets.kickbot.com`) | Receive donation events, capture an event when its alert begins, and play optional KickBot TTS. | The widget secret and streamer ID are used to connect/capture; event data can include donor name, amount, message and optional media/TTS URLs. |
| **StreamElements** (`api.streamelements.com`, `astro.streamelements.com`) | Verify a JWT when you connect the provider and receive its tip events. | The saved JWT is sent to StreamElements for account verification and realtime authentication; events can include donor name, amount, currency and message. |
| **Kick** (`kick.com`, then Kick's public chat feed hosted on `pusher.com`) | Receive public subscription and gift-subscription events for the configured channel. | The channel name is used to identify the public chat feed; no Kick login or password is sent. |
| **Nobitex** (`apiv2.nobitex.ir`) | Primary source for the USDT/IRT order book used to calculate the USD-to-toman rate. | A public HTTPS request; no account or key. |
| **Baha24** (`baha24.com`) | Supply non-USD currency rates and the fallback USD rate when Nobitex fails. | A public HTTPS request; no account or key. |
| **Bonbast** (`bonbast.com`) | Fallback for non-USD currency rates when Baha24 has no usable rates. | A public HTTPS request; no account or key. |
| **Meld Studio** (`127.0.0.1:13376`, local machine only) | Optionally inspect/reload a Browser Source layer after a connection issue. | Local layer URLs and layer state. |
| **GitHub** (`github.com/B3hnamR/sahne-promax`) | Check whether a newer ProMax release is available; fetch the installer and checksum only after you click update. | The check sends the app version in a request to this repository's releases endpoint. A user-initiated update fetches the installer and `SHA256SUMS.txt` from the same repository. |

When configured, manual or Windows system HTTP proxies may be used for Kick and the exchange-rate requests. StreamElements and KickBot connections do not use the configured proxy. Update requests use Electron's Chromium network stack and follow the Windows system proxy.

The Browser Source may load KickBot-provided HTTPS GIFs and TTS audio for events that include them. Fonts are bundled locally; the app does not load fonts from Google or a CDN.

## 5. Data about viewers

Donation and subscription events include viewer names and, for tips, may include messages and amounts. The application displays them on your stream, records displayed alerts in the local history ledger, and may write event details to the local log. The retained history is limited to 20,000 individual records; daily and per-donor aggregates remain until you clear application data. You are responsible for how you display viewer information in your broadcast.

## 6. What we do not do

- We do not operate a cloud backend or receive your local media, settings, alert history or logs.
- No analytics, telemetry, advertising or automatic crash reports are sent.
- The app never installs an update automatically. It checks for a newer version when update checking is enabled; downloading and installing require a click.

## 7. Security of the local server

The local server binds to `127.0.0.1` on the configured port (7788 by default); it is not reachable from other computers. It validates request hosts and origins, and the Browser Source event stream rejects cross-site pages. Report vulnerabilities using the fork's [security policy](../../SECURITY.md).

## 8. Children and third-party services

Sahne ProMax is a tool for streamers and is not directed at children. Kick, KickBot, StreamElements, Nobitex, Baha24, Pusher and GitHub are independent services. Their own terms and privacy policies govern their handling of requests they receive. Sahne ProMax is not affiliated with or endorsed by those services.

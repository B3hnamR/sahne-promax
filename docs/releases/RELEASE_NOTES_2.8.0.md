# Sahne ProMax 2.8.0

**Release date:** 2026-11-02 · **Base:** ProMax 2.7.0 with Sahne+ changes through 1.6.1 adapted to ProMax

This release brings Sahne+ 1.6.1 into ProMax's modular architecture, adds the optional Donofa goal/timer bridge, refreshes the controller, and fixes settings, playback and account-recovery issues while retaining ProMax's own tools.

## Controller and update experience

- **Mint controller:** refreshed surfaces, green accents and Vazirmatn typography across all ten ProMax pages, with clearer keyboard focus, current-page navigation, Persian counters, reduced-motion handling and responsive layouts.
- The controller adopts the upstream visual language, not every decorative animation. ProMax retains simpler page transitions rather than the pointer-following card tilt and 3D page turns in Sahne+.
- **Discoverable updates:** persistent sidebar and About actions show the available version, checking status and download/install progress. Dismissing the update bar does not remove the other actions. Updates continue to come from this fork and require user action.
- The README has a new layout, a current controller screenshot, verified provider/feature tables, OBS guidance and a detailed ProMax-versus-Plus comparison. The attached Persian guide is updated for 2.8.0.

## Optional Donofa goal and timer bridge

- Forward confirmed KickBot and StreamElements tips, real Kick subscriptions/gifts, and KICKs into an external goal or timer configured on Donofa.
- **Both bridge switches default off**, including for previously connected accounts. Enable them explicitly in Settings after checking your Donofa goal and timer configuration. Disable Donofa's own Kick-sub counting to avoid counting subscriptions twice.
- This is separate from ProMax's existing inbound Donofa donation/TTS listener and its local `/goal` Browser Source. Donofa's own donations, free commands, tests and replays are not forwarded back to Donofa.
- KICKs use the upstream USD 0.0105 store value and do not create a separate overlay alert. Bridge subscriptions use USD 4.99 each, independently of the local alert's configurable toman display value.
- Account-bound waiting alerts and a local recovery journal protect delayed delivery across restarts and account changes. Failed recovery or persistence blocks unsafe credential changes, and portable restore rolls bridge state back if installation fails. Successful captures still count if visual playback was skipped.
- **Delivery is not exactly-once:** an ambiguous timer response is treated as sent to avoid doubling it, which can undercount; concurrent donations during goal updates retain a race. Verify real-account behavior before relying on the bridge during a stream.

## Settings and reliability

- **Truthful settings saves:** failed disk writes return errors instead of success. Relevant settings and provider credentials remain unchanged, with no premature reconnects or queue cleanup. Goal drafts survive live events and in-flight saves; inspector feedback only marks the acknowledged current draft as saved.
- **Kick connection recovery:** validated cached/new/legacy Pusher keys, routed discovery, rejection handling and throttled retries follow Kick's rotated public-chat credentials. Stale channel lookups cannot overwrite newer settings or save after shutdown. Resetting settings now also resets the active Kick connection and rate schedule.
- Reject invalid KickBot verification responses before replacing credentials; report failed manual rate refreshes correctly; display encrypted Donofa credential storage correctly after restart.
- Restore both Meld reload buttons and their API route. Appearance Preview now selects matching media automatically. Presets synchronize custom dropdowns, and media changes synchronize across controllers without replacing unrelated drafts.
- Confirmation dialogs provide native modal behavior and keyboard focus handling. Enhanced dropdowns no longer leave invisible native-select keyboard stops.
- Preserve ProMax's inbound Donofa/TTS, local goal/top widgets, analytics/history controls, paired audio, subscription tiers, scene profiles, chat commands, routing rules/simulator, sub-first queue, counters/confetti, Nobitex/Baha24 rates and portable backups.

## Validation and limitations

Local validation passed **235 Node tests**, overlay injection and long-media checks, formatting, and Windows unpacked packaging. All ten pages were also checked at desktop, short-window and mobile widths during integration. The tagged release workflow reruns tests and formatting before building and publishing the installer.

Offline tests do not prove live-provider correctness. Real Kick key rotation, Donofa donation/TTS delivery and goal/timer writes, live Meld reloads, and update installation still require runtime/account testing. See the [README](https://github.com/B3hnamR/sahne-promax#promax-vs-sahne-plus) and [data-flow inventory](https://github.com/B3hnamR/sahne-promax/blob/main/docs/DATA_FLOW.md) for the comparison and limitations.

## Updating

From 2.7.0, click **آپدیت** in the desktop app or download the installer from [this fork's Releases page](https://github.com/B3hnamR/sahne-promax/releases). The app checks the installer against `SHA256SUMS.txt` before running it. Settings, rules, media and saved history remain in the local data folder. Making a portable backup before upgrading is recommended; backups omit provider/proxy credentials, so reconnect providers after a restore.

The Donofa bridge remains off until you explicitly enable it. This release does not automatically opt existing connected accounts into external goal/timer writes.

## Release files

- `Sahne-ProMax-Setup-2.8.0.exe` — Windows x64 installer (per-user)
- `SHA256SUMS.txt` — SHA-256 checksum manifest
- `README-FA.md` — updated Persian guide

The installer is not Authenticode-signed, so Windows SmartScreen may warn. Check the release page for build-provenance attestation. Sahne ProMax is an independent fork of [Sahne Plus](https://github.com/AmirEyZed/sahne-plus) and is not affiliated with its external providers.

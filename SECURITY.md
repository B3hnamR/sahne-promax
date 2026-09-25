# Security Policy — Sahne ProMax

Sahne ProMax is an independent fork of Sahne Plus. Security reports for this fork should go to the ProMax maintainer through this repository, not to the upstream Sahne Plus maintainer.

## Supported versions

Only the latest ProMax release receives security fixes. The current release is **2.5.1**. Please upgrade before reporting an issue against an older build.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue with exploit details or publish them before a fix is available.

- **Preferred:** [GitHub private vulnerability reporting](https://github.com/B3hnamR/sahne-promax/security/advisories/new), if enabled for this repository.
- **If private reporting is unavailable:** open an issue titled `security contact request` without vulnerability details so the maintainer can arrange a private channel.

Please include:

- ProMax version shown on the About page and your Windows version;
- the affected feature and its impact, including attacker access required;
- reproduction steps or a proof of concept, and source locations if known;
- relevant lines from `Documents\Sahne Plus\sahne-plus.log` after removing donor names and other personal data;
- never include your KickBot widget secret, StreamElements JWT or Donofa API key.

## Responsible disclosure

We aim to acknowledge reports within 7 days and coordinate a fix and disclosure timeline with the reporter. Please allow time for a fix to reach users before public disclosure. The ProMax project has no bug bounty.

## Scope

In scope:

- the loopback server being reachable from another machine or another browser origin;
- injected content in the OBS Browser Source;
- imported media causing code execution or path traversal;
- the Electron shell, IPC bridge, navigation, permissions or updater;
- a release workflow issue that could publish an unofficial binary as a ProMax release.

Out of scope: vulnerabilities in Kick, KickBot, StreamElements, Donofa, Nobitex, Baha24, Meld Studio or GitHub itself; social engineering; issues requiring a compromised Windows account.

## Release integrity

Release installers are accompanied by a `SHA256SUMS.txt` manifest. Verify the installer against that file before running it. Check the individual release page for any build-provenance attestation; do not assume one is available. The installers are not Authenticode-signed, checksums are not separately signed, and builds have not been verified as reproducible. A checksum verifies file integrity against the published manifest; it is not a security audit or proof of publisher identity.

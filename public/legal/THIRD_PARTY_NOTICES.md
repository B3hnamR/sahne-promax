# Third-Party Notices — Sahne ProMax 2.5.1

Sahne ProMax is an independent fork of Sahne Plus. The source code is licensed under Apache License 2.0; retained upstream attribution is in `NOTICE` and the license is in `LICENSE`. The code license does not grant rights to third-party names or brand assets; see `BRANDING.md`.

## Runtime components

| Component | Version | License / notices | Role |
|---|---|---|---|
| Electron | 43.7.3 | MIT; `LICENSE.electron.txt` in the install folder | Desktop runtime |
| Chromium (included with Electron) | Electron 43.7.3 build | BSD-3-Clause and bundled component licenses; `LICENSES.chromium.html` in the install folder | UI and Browser Source rendering |
| Node.js (included with Electron) | Electron 43.7.3 build | MIT; notice in the Electron distribution | JavaScript runtime |
| NSIS and electron-builder helpers | Versions bundled by electron-builder 26.x | Their included licenses and notices | Windows installer |

The project has no npm runtime dependencies. Electron and electron-builder are development/build dependencies; Electron is redistributed as the application runtime.

## Bundled fonts

Font files in `public/fonts` are distributed under the SIL Open Font License 1.1. The license texts are shipped alongside the font files.

| Font | Copyright / project |
|---|---|
| Vazirmatn | Copyright 2015 The Vazirmatn Project Authors · https://github.com/rastikerdar/vazirmatn |
| Estedad | Copyright 2022 The Estedad Project Authors · https://github.com/aminabedi68/Estedad |
| Inter | Copyright 2016 The Inter Project Authors · https://github.com/rsms/inter |
| Poppins | Copyright 2020 The Poppins Project Authors · https://github.com/itfoundry/Poppins |
| Lalezar | Copyright 2015 The Lalezar Project Authors · https://github.com/BornaIz/Lalezar |

## Third-party services

Depending on configured features, Sahne ProMax connects to KickBot, Kick and its public Pusher-hosted chat feed, StreamElements, Donofa, Nobitex, Baha24, Meld Studio on the local computer, and GitHub. These are services, not bundled code. Their terms and privacy policies apply to their services. Sahne ProMax is not affiliated with or endorsed by them.

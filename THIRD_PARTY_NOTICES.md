# Third-Party Notices

This plugin includes and links native code from LyX.

## LyX

- Project: LyX, the document processor
- Website: https://www.lyx.org/
- Version used for the current native sidecar: LyX 2.5.1
- License: GPL-2.0-or-later
- Runtime resources packaged from LyX `lib/`: encodings, languages, layouts, symbols, Unicode tables, fonts, and related math/configuration files.

The corresponding source for the native helper consists of this repository plus the LyX 2.5.1 source tree and the patch in `patches/lyx-2.5.1-mathd-cmake.patch`.

## Qt

The macOS release sidecar is built with Qt 6 and may bundle Qt frameworks/plugins in `bin/darwin-*/LyxMathd.app` when `npm run native:package:macos-app` is used.

Qt is available under GPL/LGPL/commercial license terms depending on the chosen distribution. This project is distributed under GPL-2.0-or-later because it links LyX.

## Obsidian API

The JavaScript plugin uses Obsidian's plugin API at runtime. Obsidian itself is not bundled with this plugin.

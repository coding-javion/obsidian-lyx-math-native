# Building

This repository builds an Obsidian plugin plus a native `lyx-mathd` sidecar.

## Requirements

- Node.js 20+
- CMake 3.16+
- C++20 compiler
- LyX 2.5.1 source tree
- Qt 6 development files
- macOS release packaging: `macdeployqt`, `codesign`, and `zip`

## LyX Source

Set `LYX_SOURCE_DIR` to a LyX 2.5.1 checkout. The build scripts also try `third_party/lyx`, the parent directory, and a sibling `lyx-2.5.1`.

Apply the sidecar CMake patch before configuring LyX:

```bash
cd "$LYX_SOURCE_DIR"
patch -p1 < /path/to/ObsidianLyX/patches/lyx-2.5.1-mathd-cmake.patch
```

## Build Native Sidecar

```bash
cd /path/to/ObsidianLyX
export LYX_SOURCE_DIR=/path/to/lyx-2.5.1
export LYX_BUILD_DIR=/tmp/lyx-2.5.1-qt-build

npm run lyx:configure
npm run lyx:build-core
npm run native:configure:lyx
npm run native:build
npm run native:package
npm run support:package
npm test
```

## macOS Self-Contained Sidecar

For public macOS releases, package the helper as an app bundle so Qt frameworks are copied into the release artifact:

```bash
npm run native:package:macos-app
npm test
```

Without `CODESIGN_IDENTITY`, the script uses ad-hoc signing for local testing. Public distribution should use a Developer ID certificate and notarization:

```bash
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
npm run native:package:macos-app
```

## Release Zip

```bash
npm run release:zip
```

The zip contains the installable Obsidian plugin runtime. The repository itself provides the corresponding source required by the GPL.

## Source Tarball

```bash
npm run release:source
```

This creates `dist/lyx-math-<version>-source.tar.gz`. The tarball excludes generated binaries and runtime artifacts. In CI, `INCLUDE_LYX_SOURCE=1` is used so the tarball also contains the LyX source tree under `third_party/lyx`.

To generate both release artifacts locally:

```bash
npm run release:all
```

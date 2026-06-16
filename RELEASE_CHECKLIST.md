# Release Checklist

1. Build from a clean LyX 2.5.1 source tree with `patches/lyx-2.5.1-mathd-cmake.patch` applied.
2. Run:

   ```bash
   npm run lyx:configure
   npm run lyx:build-core
   npm run native:configure:lyx
   npm run native:build
   npm run native:package
   npm run support:package
   npm test
   ```

3. For macOS public releases, run `npm run native:package:macos-app` with `CODESIGN_IDENTITY` set, then notarize the resulting app bundle or final zip.
4. Run `npm run release:all`.
5. Upload `main.js`, `manifest.json`, `styles.css`, the installable zip, and the source tarball as GitHub Release assets.
6. Confirm the release page includes both:

   ```text
   main.js
   manifest.json
   styles.css
   lyx-math-<version>-darwin-arm64.zip
   lyx-math-<version>-source.tar.gz
   ```

7. Confirm the source tarball includes or identifies the LyX 2.5.1 source and `patches/lyx-2.5.1-mathd-cmake.patch`.

Current limitation: only the current platform/architecture is packaged by these scripts. Build and upload separate release zips for each supported target.

The repository also includes `.github/workflows/release.yml`. Pushing a semantic-version tag such as `0.0.1` builds the macOS arm64 package, creates a source tarball, uploads workflow artifacts, and publishes a GitHub Release.

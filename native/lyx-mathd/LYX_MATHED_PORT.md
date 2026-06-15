# LyX `mathed` Integration Boundary

The sidecar intentionally reuses LyX's own formula model instead of reimplementing math editing in JavaScript.

## Linked LyX Components

The current helper links LyX 2.5.1 libraries and object files for:

- `src/mathed`: math insets, parser, streams, arrays, matrices, cases, macros
- `src/Cursor.*`: structural cursor movement and insertion behavior
- `src/Buffer*`, `src/Layout*`, `src/Text*`: the minimal document context LyX math requires
- `src/frontends` and `src/frontends/qt`: headless Qt painter and metrics path
- `src/support`: docstring, package/resource lookup, file and encoding support

The Obsidian plugin does not port LyX menus, toolbars, keymap UI, dialogs, or document work area widgets.

## Runtime Resources

The sidecar reads LyX runtime resources from `LYX_MATHD_SYSTEM_SUPPORT_DIR`. The JavaScript client sets this to `support/lyx` when that directory exists.

Packaged resources are produced by:

```bash
npm run support:package
```

## Native Protocol

The sidecar exposes a small newline-delimited JSON protocol:

- `session.create`
- `session.set`
- `session.dispatch`
- `session.serialize`
- `session.render`
- `session.renderPainter`
- `session.close`

Structural edits are mapped to LyX logic:

- text insertion goes through `InsetMathNest::interpretChar` / macro mode
- macro completion follows LyX space-to-commit behavior
- row insertion uses `LFUN_NEWLINE_INSERT`
- matrix insertion uses `LFUN_MATH_AMS_MATRIX` / `LFUN_MATH_MATRIX`
- column insertion uses `LFUN_TABULAR_FEATURE append-column`
- cell and arrow movement use LyX cursor LFUNs

## LyX Source Patch

Clean LyX 2.5.1 needs `patches/lyx-2.5.1-mathd-cmake.patch` to add the `lyxcore_for_mathd` object target used by the sidecar build.

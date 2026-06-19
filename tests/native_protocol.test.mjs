import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  createNativeMathClient,
  detectSidecar,
  resolveSidecarPath
} = require("../src/native_client.js");
const pluginEntry = require("../main.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(manifest.id, packageJson.name);
assert.equal(manifest.version, packageJson.version);

const stylesheet = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const pluginMain = fs.readFileSync(path.join(root, "main.js"), "utf8");
const nativeClientSource = fs.readFileSync(path.join(root, "src", "native_client.js"), "utf8");
const sidecarMain = fs.readFileSync(path.join(root, "native", "lyx-mathd", "src", "main.cpp"), "utf8");
assert.doesNotMatch(stylesheet, /font-size:\s*1\.(?:35|8)em/);
assert.match(stylesheet, /\.lyx-native-modal\s*\{[^}]*font-size:\s*13px !important;/);
assert.match(stylesheet, /\.lyx-native-preview\s*\{[^}]*font-size:\s*13px !important;/);
assert.match(stylesheet, /\.lyx-native-editor\s*\{[^}]*font-size:\s*13px !important;[^}]*overflow-x:\s*auto;/);
assert.match(stylesheet, /\.lyx-native-editor \.lyx-native-preview-content\s*\{[^}]*max-width:\s*none !important;[^}]*white-space:\s*nowrap !important;/);
assert.match(stylesheet, /\.lyx-native-editor \.lyx-native-painter-image\s*\{[^}]*max-width:\s*none !important;/);
assert.match(stylesheet, /\.lyx-native-editor math\s*\{[^}]*font-size:\s*13px !important;/);
assert.match(stylesheet, /\.lyx-native-preview math\s*\{[^}]*font-size:\s*13px !important;/);
assert.doesNotMatch(stylesheet, /\.lyx-native-source\s*\{/);
assert.doesNotMatch(stylesheet, /\.lyx-native-pending-macro\s*\{/);
assert.match(pluginMain, /function nativeCssPixels/);
assert.match(pluginMain, /const scheduleDraw = \(renderScale = liveRenderScale\) =>/);
assert.match(pluginMain, /const liveRenderScale = 2;/);
assert.match(pluginMain, /const fullRenderScale = 4;/);
assert.match(pluginMain, /renderPainter\(this\.session, \{ renderScale \}\)/);
assert.match(pluginMain, /scheduleHighQualityDraw/);
assert.doesNotMatch(pluginMain, /pendingMacroText|showPendingMacro|renderPendingMacroPreview|shouldDeferMacroRender|lyx-native-pending-macro/);
assert.match(pluginMain, /id:\s*"insert-native-lyx-matrix-row"/);
assert.match(pluginMain, /id:\s*"insert-native-lyx-matrix-column"/);
assert.match(pluginMain, /callback:\s*\(\) => dispatchActiveModalAction\(this, \{ type: "newline" \}\)/);
assert.match(pluginMain, /callback:\s*\(\) => dispatchActiveModalAction\(this, \{ type: "addColumn" \}\)/);
assert.match(pluginMain, /matrixHotkeyActionForEvent\(this\.matrixHotkeyBindings, event\)/);
assert.match(pluginMain, /function matrixHotkeyBindingsForPlugin/);
assert.match(pluginMain, /const wrapped = wrapFormulaForObsidian\(serialized\.latex, serialized\.display\)/);
assert.doesNotMatch(pluginMain, /setPendingMacroAnchor|pendingMacroAnchor|lyx-native-pending-macro-positioned/);
assert.doesNotMatch(pluginMain, /await draw\(\);\s*status\.textContent = updated\.lyxParseError \|\| sidecarStatusMessage/);
assert.doesNotMatch(pluginMain, /fallbackSource/);
assert.match(nativeClientSource, /renderPainter\(session, options = \{\}\)/);
assert.match(nativeClientSource, /\{ session, \.\.\.options \}/);
assert.match(pluginMain, /nativeCssPixels\(rendered, "width", "pixelWidth"\)/);
assert.match(pluginMain, /nativeCssPixels\(rendered, "height", "pixelHeight"\)/);
assert.doesNotMatch(pluginMain, /setProperty\("width", `\$\{rendered\.width\}px`, "important"\)/);
assert.doesNotMatch(pluginMain, /setProperty\("height", `\$\{rendered\.height\}px`, "important"\)/);
assert.match(sidecarMain, /font-size=\\"12\\"/);
assert.doesNotMatch(sidecarMain, /font-size=\\"16\\"/);
assert.match(sidecarMain, /font\.setStyle\(s\.display \? lyx::DISPLAY_STYLE : lyx::TEXT_STYLE\)/);
assert.match(sidecarMain, /std::clamp\(integer\(p, "renderScale", 4\), 1, 4\)/);

assert.equal(pluginEntry._private.wrapFormulaForObsidian("\\alpha", false), "$\\alpha$");
assert.equal(pluginEntry._private.wrapFormulaForObsidian("\\alpha", true), "$$\n\\alpha\n$$");
let dispatchedActiveModalAction = null;
assert.equal(pluginEntry._private.dispatchActiveModalAction({
  activeModal: {
    dispatchEditorAction(action) {
      dispatchedActiveModalAction = action;
      return true;
    }
  }
}, { type: "addColumn" }), true);
assert.deepEqual(dispatchedActiveModalAction, { type: "addColumn" });
assert.equal(pluginEntry._private.hotkeyMatchesEvent(
  { modifiers: ["Ctrl"], key: "J" },
  { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "j" }
), true);
assert.equal(pluginEntry._private.hotkeyMatchesEvent(
  { modifiers: ["Ctrl"], key: "J" },
  { ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: "j" }
), false);
assert.deepEqual(pluginEntry._private.matrixHotkeyActionForEvent([
  { binding: { modifiers: ["Ctrl"], key: "J" }, action: { type: "newline" } },
  { binding: { modifiers: ["Ctrl"], key: "L" }, action: { type: "addColumn" } }
], { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: "l" }), { type: "addColumn" });

const binaryPath = resolveSidecarPath(root);
const status = detectSidecar(root);

assert.equal(status.available, true, `sidecar unavailable at ${binaryPath}: ${status.reason || "missing"}`);
assert.equal(status.version, "lyx-mathd 0.1.1 lyx-mathed-linked");

const client = createNativeMathClient({ baseDir: root });
try {
  const ping = await client.ping();
  assert.equal(ping.name, "lyx-mathd");
  assert.equal(ping.engine, "lyx-mathed-linked");
  assert.equal(ping.lyxMathed, true);

  const created = await client.createSession("\\alpha", false);
  assert.equal(created.latex, "\\alpha");
  assert.equal(created.lyxParsed, true);
  assert.equal(created.hull, "simple");

  const inlineFrac = await client.setSession(created.session, "\\frac{x}{y}", false);
  assert.equal(inlineFrac.latex, "\\frac{x}{y}");
  assert.equal(inlineFrac.display, false);
  assert.equal(inlineFrac.lyxParsed, true);
  assert.equal(inlineFrac.hull, "simple");
  const inlinePainter = await client.renderPainter(created.session);
  assert.equal(inlinePainter.available, true, inlinePainter.error || "inline LyX painter render unavailable");
  assert.equal(inlinePainter.display, false);
  assert.equal(inlinePainter.nativeQtPainter, true);

  const updated = await client.setSession(created.session, "\\frac{x}{y}", true);
  assert.equal(updated.latex, "\\frac{x}{y}");
  assert.equal(updated.display, true);
  assert.equal(updated.lyxParsed, true);
  assert.equal(updated.hull, "equation");

  const rendered = await client.render(created.session);
  assert.match(rendered.html, /<math\b/);
  assert.match(rendered.html, /<mfrac>/);

  const painterRendered = await client.renderPainter(created.session);
  assert.equal(painterRendered.available, true, painterRendered.error || "LyX painter render unavailable");
  assert.equal(painterRendered.display, true);
  assert.equal(painterRendered.lyxPainter, true);
  assert.equal(painterRendered.nativeQtPainter, true);
  assert.ok(painterRendered.width > 0);
  assert.ok(painterRendered.height > 0);
  assert.equal(painterRendered.renderScale, 4);
  assert.equal(painterRendered.pixelWidth, painterRendered.width * painterRendered.renderScale);
  assert.equal(painterRendered.pixelHeight, painterRendered.height * painterRendered.renderScale);
  assert.ok(painterRendered.ascent >= 0);
  assert.ok(Array.isArray(painterRendered.ops));
  assert.match(painterRendered.png, /^data:image\/png;base64,/);

  const alpha = await client.setSession(created.session, "\\alpha", false);
  assert.equal(alpha.lyxParsed, true);
  assert.equal(alpha.latex, "\\alpha");
  assert.equal(alpha.hull, "simple");
  const alphaRendered = await client.render(created.session);
  assert.match(alphaRendered.html, /<math\b/);
  assert.match(alphaRendered.html, /&#x0?3B1;|α/);
  const alphaPainter = await client.renderPainter(created.session);
  assert.equal(alphaPainter.available, true, alphaPainter.error || "LyX painter render unavailable");
  assert.equal(alphaPainter.nativeQtPainter, true);
  assert.match(alphaPainter.png, /^data:image\/png;base64,/);
  assert.ok(alphaPainter.width > 0);
  assert.equal(alphaPainter.renderScale, 4);

  const typed = await client.setSession(created.session, "", false);
  assert.equal(typed.latex, "");
  let macroState = null;
  for (const ch of "\\alpha") {
    macroState = await client.dispatch(created.session, { type: "insertText", text: ch });
  }
  assert.equal(macroState.macroMode, true);
  assert.equal(macroState.macroName, "\\alpha");
  const closedAlpha = await client.dispatch(created.session, { type: "insertText", text: " " });
  assert.equal(closedAlpha.macroMode, false);
  for (const ch of "\\beta ") {
    await client.dispatch(created.session, { type: "insertText", text: ch });
  }
  const typedRendered = await client.render(created.session);
  assert.match(typedRendered.html, /<math\b/);
  assert.match(typedRendered.html, /&#x0?3B1;|α/);
  assert.match(typedRendered.html, /&#x0?3B2;|β/);

  const deletedAlpha = await client.dispatch(created.session, { type: "backspace" });
  assert.equal(deletedAlpha.latex, "\\alpha");
  const deletedStructured = await client.setSession(created.session, "\\frac{x}{y}", false);
  assert.equal(deletedStructured.latex, "\\frac{x}{y}");
  const deletedFrac = await client.dispatch(created.session, { type: "backspace" });
  assert.equal(deletedFrac.latex, "");
  await client.setSession(created.session, "\\frac{x}{y}", false);
  await client.dispatch(created.session, { type: "moveBackward" });
  await client.dispatch(created.session, { type: "moveBackward" });
  await client.dispatch(created.session, { type: "moveBackward" });
  const forwardDeletedFrac = await client.dispatch(created.session, { type: "delete" });
  assert.equal(forwardDeletedFrac.latex, "");

  await client.setSession(created.session, "", false);
  let cursorEdited = null;
  for (const ch of "\\frac") {
    cursorEdited = await client.dispatch(created.session, { type: "insertText", text: ch });
  }
  assert.notEqual(cursorEdited.latex, "\\frac{}{}");
  assert.equal(cursorEdited.macroMode, true);
  assert.equal(cursorEdited.macroName, "\\frac");
  cursorEdited = await client.dispatch(created.session, { type: "insertText", text: " " });
  assert.equal(cursorEdited.latex, "\\frac{}{}");
  assert.equal(cursorEdited.macroMode, false);
  cursorEdited = await client.dispatch(created.session, { type: "insertText", text: "x" });
  assert.equal(cursorEdited.latex, "\\frac{x}{}");
  cursorEdited = await client.dispatch(created.session, { type: "cellForward" });
  cursorEdited = await client.dispatch(created.session, { type: "insertText", text: "y" });
  assert.equal(cursorEdited.latex, "\\frac{x}{y}");
  await client.renderPainter(created.session);
  cursorEdited = await client.dispatch(created.session, { type: "moveUp" });
  cursorEdited = await client.dispatch(created.session, { type: "insertText", text: "z" });
  assert.equal(cursorEdited.latex, "\\frac{xz}{y}");
  const cursorPainter = await client.renderPainter(created.session);
  assert.equal(cursorPainter.available, true, cursorPainter.error || "LyX cursor-edited painter unavailable");
  assert.equal(cursorPainter.nativeQtPainter, true);
  assert.match(cursorPainter.png, /^data:image\/png;base64,/);
  assert.ok(cursorPainter.ops.some(op => op.type === "cursor"), "LyX cursor should be included in painter output");
  assert.equal(pluginEntry._private.hasNativeCursor(cursorPainter), true);

  await client.setSession(created.session, "", false);
  let matrixEdited = await client.dispatch(created.session, {
    type: "insertAmsMatrix",
    rows: 2,
    cols: 2,
    decoration: "pmatrix"
  });
  assert.match(matrixEdited.latex, /\\begin\{pmatrix\}/);
  assert.match(matrixEdited.latex, /\\end\{pmatrix\}/);
  matrixEdited = await client.dispatch(created.session, { type: "insertText", text: "a" });
  matrixEdited = await client.dispatch(created.session, { type: "cellForward" });
  matrixEdited = await client.dispatch(created.session, { type: "insertText", text: "b" });
  assert.match(matrixEdited.latex, /a\s*&\s*b/);
  matrixEdited = await client.dispatch(created.session, { type: "addColumn" });
  matrixEdited = await client.dispatch(created.session, { type: "cellForward" });
  matrixEdited = await client.dispatch(created.session, { type: "insertText", text: "c" });
  assert.match(matrixEdited.latex, /a\s*&\s*b\s*&\s*c/);
  const reopenedMatrix = await client.setSession(created.session, matrixEdited.latex, false);
  assert.equal(reopenedMatrix.lyxParsed, true);
  assert.match(reopenedMatrix.latex, /\\begin\{pmatrix\}/);
  const matrixPainter = await client.renderPainter(created.session);
  assert.equal(matrixPainter.available, true, matrixPainter.error || "LyX matrix painter unavailable");
  assert.equal(matrixPainter.nativeQtPainter, true);

  await client.setSession(created.session, "", false);
  let emptyColumnMatrix = await client.dispatch(created.session, {
    type: "insertAmsMatrix",
    rows: 1,
    cols: 1,
    decoration: "bmatrix"
  });
  emptyColumnMatrix = await client.dispatch(created.session, { type: "newline" });
  emptyColumnMatrix = await client.dispatch(created.session, { type: "addColumn" });
  emptyColumnMatrix = await client.dispatch(created.session, { type: "setDisplay", display: true });
  assert.equal(emptyColumnMatrix.display, true);
  emptyColumnMatrix = await client.dispatch(created.session, { type: "cellForward" });
  emptyColumnMatrix = await client.dispatch(created.session, { type: "insertText", text: "z" });
  assert.match(emptyColumnMatrix.latex, /\\begin\{bmatrix\}/);
  assert.match(emptyColumnMatrix.latex, /\\\\\s*&\s*z/);

  let casesEdited = await client.setSession(created.session, "", false);
  casesEdited = await client.dispatch(created.session, { type: "insertCases", rows: 2 });
  assert.match(casesEdited.latex, /\\begin\{cases\}/);
  assert.match(casesEdited.latex, /\\\\/);
  assert.match(casesEdited.latex, /\\end\{cases\}/);

  await client.setSession(created.session, "", true);
  await client.dispatch(created.session, { type: "insertText", text: "x" });
  await client.dispatch(created.session, { type: "newline" });
  const multilineEdited = await client.dispatch(created.session, { type: "insertText", text: "y" });
  assert.equal(multilineEdited.display, true);
  assert.match(multilineEdited.latex, /\\begin\{(?:align|eqnarray)\*?\}/);
  assert.match(multilineEdited.latex, /x/);
  assert.match(multilineEdited.latex, /y/);
  const multilineSerialized = await client.serialize(created.session);
  assert.equal(multilineSerialized.display, true);
  assert.match(multilineSerialized.latex, /\\begin\{(?:align|eqnarray)\*?\}/);
  const multilinePainter = await client.renderPainter(created.session);
  assert.equal(multilinePainter.available, true, multilinePainter.error || "LyX multiline painter unavailable");
  assert.equal(multilinePainter.nativeQtPainter, true);

  const displayWrapper = await client.setSession(created.session, "$$\\alpha$$", false);
  assert.equal(displayWrapper.lyxParsed, true);
  assert.equal(displayWrapper.latex, "\\alpha");
  assert.equal(displayWrapper.display, true);
  const displaySerialized = await client.serialize(created.session);
  assert.equal(displaySerialized.latex, "\\alpha");
  assert.equal(displaySerialized.display, true);

  const emptyDisplay = await client.setSession(created.session, "$$", false);
  assert.equal(emptyDisplay.lyxParsed, true);
  assert.equal(emptyDisplay.latex, "");
  assert.equal(emptyDisplay.display, true);

  for (const unsafeSource of ["\\", "\\\\", "}", "a}", "\\right)", "\\begin{matrix}"]) {
    const unsafe = await client.setSession(created.session, unsafeSource, false);
    assert.equal(unsafe.lyxParsed, false, `${unsafeSource} should be rejected before LyX parser`);
    assert.equal(unsafe.latex, unsafeSource);
    assert.equal(typeof unsafe.lyxParseError, "string");
  }

  const recovered = await client.setSession(created.session, "\\alpha", false);
  assert.equal(recovered.lyxParsed, true);
  assert.equal(recovered.latex, "\\alpha");

  const serialized = await client.serialize(created.session);
  assert.equal(serialized.latex, "\\alpha");
  assert.equal(serialized.display, false);

  const closed = await client.closeSession(created.session);
  assert.equal(closed.closed, true);
} finally {
  await client.shutdown();
}

const ranges = pluginEntry.scanMathRanges("a $x_i$ b $$\\frac{x}{y}$$ c \\$not math$");
assert.deepEqual(ranges.map(r => [r.display, r.source]), [
  [false, "x_i"],
  [true, "\\frac{x}{y}"]
]);
const displayWithNewlines = pluginEntry.scanMathRanges("before $$\n\\alpha\n$$ after");
assert.deepEqual(displayWithNewlines.map(r => [r.display, r.source]), [
  [true, "\n\\alpha\n"]
]);

console.log("Native sidecar tests passed.");

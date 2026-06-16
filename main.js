"use strict";

let obsidianApi = null;
try {
  obsidianApi = require("obsidian");
} catch {
  obsidianApi = {
    Plugin: class {},
    Modal: class {
      constructor() {
        this.contentEl = null;
      }
      open() {}
      close() {}
    },
    Notice: class {
      constructor(message) {
        this.message = message;
      }
    }
  };
}

const { Plugin, Modal, Notice } = obsidianApi;
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

function executableName() {
  return process.platform === "win32" ? "lyx-mathd.exe" : "lyx-mathd";
}

function platformTriplet() {
  return `${process.platform}-${process.arch}`;
}

function resolveSidecarPath(baseDir = __dirname) {
  baseDir = path.resolve(baseDir);
  const candidates = [
    path.join(baseDir, "bin", platformTriplet(), "LyxMathd.app", "Contents", "MacOS", executableName()),
    path.join(baseDir, "bin", platformTriplet(), executableName()),
    path.join(baseDir, "native", "lyx-mathd", "build", executableName()),
    path.join(baseDir, "native", "lyx-mathd", "build", "Debug", executableName()),
    path.join(baseDir, "native", "lyx-mathd", "build", "Release", executableName())
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function defaultLyxUserDir() {
  if (process.platform === "darwin") {
    const candidate = path.join(os.homedir(), "Library", "Application Support", "LyX-2.5");
    if (fs.existsSync(candidate)) return candidate;
  }

  const unixCandidate = path.join(os.homedir(), ".lyx");
  if (fs.existsSync(unixCandidate)) return unixCandidate;

  return null;
}

function sidecarEnv(extra = {}, baseDir = __dirname) {
  baseDir = path.resolve(baseDir);
  const env = { ...process.env, ...extra };
  if (!env.LYX_USERDIR_25x) {
    const userDir = defaultLyxUserDir();
    if (userDir) env.LYX_USERDIR_25x = userDir;
  }
  if (!env.LYX_MATHD_SYSTEM_SUPPORT_DIR) {
    const supportDir = path.join(baseDir, "support", "lyx");
    if (fs.existsSync(supportDir)) env.LYX_MATHD_SYSTEM_SUPPORT_DIR = supportDir;
  }
  if (process.platform === "darwin") {
    if (!env.QT_QPA_PLATFORM) env.QT_QPA_PLATFORM = "cocoa";
    const qtPlugins = path.join(baseDir, "bin", platformTriplet(), "qt", "plugins");
    const platformPlugins = path.join(qtPlugins, "platforms");
    if (!env.QT_PLUGIN_PATH && fs.existsSync(qtPlugins)) env.QT_PLUGIN_PATH = qtPlugins;
    if (!env.QT_QPA_PLATFORM_PLUGIN_PATH && fs.existsSync(platformPlugins)) {
      env.QT_QPA_PLATFORM_PLUGIN_PATH = platformPlugins;
    }
  }
  return env;
}

function detectSidecar(baseDir = __dirname) {
  const binaryPath = resolveSidecarPath(baseDir);
  if (!fs.existsSync(binaryPath)) return { available: false, binaryPath, reason: "missing" };
  const result = childProcess.spawnSync(binaryPath, [], {
    cwd: path.dirname(binaryPath),
    encoding: "utf8",
    env: sidecarEnv({}, baseDir),
    input: "{\"id\":1,\"method\":\"ping\",\"params\":{}}\n{\"id\":2,\"method\":\"shutdown\",\"params\":{}}\n",
    timeout: 10000
  });
  if (result.error) return { available: false, binaryPath, reason: result.error.message };
  if (result.status !== 0) return { available: false, binaryPath, reason: `exit ${result.status}` };
  const line = result.stdout.split(/\r?\n/).find(item => item.trim());
  if (!line) return { available: false, binaryPath, reason: "empty ping response" };
  try {
    const response = JSON.parse(line);
    const payload = response.result || {};
    return { available: true, binaryPath, version: `${payload.name || "lyx-mathd"} ${payload.version || "unknown"} ${payload.engine || ""}`.trim() };
  } catch (error) {
    return { available: false, binaryPath, reason: `invalid ping response: ${error.message}` };
  }
}

class NativeMathClient {
  constructor(options = {}) {
    this.baseDir = path.resolve(options.baseDir || __dirname);
    this.binaryPath = options.binaryPath || resolveSidecarPath(this.baseDir);
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.failureError = null;
    this.process = childProcess.spawn(this.binaryPath, [], {
      cwd: options.cwd || path.dirname(this.binaryPath),
      env: sidecarEnv(options.env, this.baseDir),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.stderr = "";
    this.process.stderr.on("data", chunk => {
      this.stderr += chunk.toString("utf8");
    });
    this.startup = new Promise((resolve, reject) => {
      this.process.once("spawn", resolve);
      this.process.once("error", error => {
        const failure = this.processError(error);
        this.closed = true;
        this.failureError = failure;
        this.rejectPending(failure);
        reject(failure);
      });
    });
    this.startup.catch(() => {});
    this.process.on("exit", (code, signal) => {
      this.closed = true;
      const error = this.exitError(code, signal);
      this.failureError = error;
      this.rejectPending(error);
    });
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on("line", line => this.handleLine(line));
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(this.failureError || new Error("lyx-mathd is closed"));
    const id = this.nextId++;
    const payload = `${JSON.stringify({ id, method, params })}\n`;
    return this.startup.then(() => {
      if (this.closed) throw this.failureError || new Error("lyx-mathd is closed");
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.process.stdin.write(payload, error => {
          if (!error) return;
          this.pending.delete(id);
          reject(this.writeError(error));
        });
      });
    });
  }

  ping() {
    return this.request("ping");
  }

  createSession(source = "", display = false) {
    return this.request("session.create", { source, display });
  }

  setSession(session, source, display) {
    return this.request("session.set", { session, source, display });
  }

  dispatch(session, action) {
    return this.request("session.dispatch", { session, action });
  }

  serialize(session) {
    return this.request("session.serialize", { session });
  }

  render(session) {
    return this.request("session.render", { session });
  }

  renderPainter(session, options = {}) {
    return this.request("session.renderPainter", { session, ...options });
  }

  closeSession(session) {
    return this.request("session.close", { session });
  }

  async shutdown() {
    if (this.closed) return;
    try {
      await this.request("shutdown");
    } finally {
      this.process.stdin.end();
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const item = this.pending.get(message.id);
    if (!item) return;
    this.pending.delete(message.id);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(message.error && message.error.message || "native request failed"));
  }

  rejectPending(error) {
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
  }

  processError(error) {
    return new Error(`Cannot spawn lyx-mathd at ${this.binaryPath}: ${error.message}`);
  }

  exitError(code, signal) {
    const parts = [`lyx-mathd exited at ${this.binaryPath}`];
    if (code !== null && code !== undefined) parts.push(`code ${code}`);
    if (signal) parts.push(`signal ${signal}`);
    const stderr = this.stderr.trim();
    if (stderr) parts.push(`stderr: ${stderr}`);
    return new Error(parts.join("; "));
  }

  writeError(error) {
    if (this.failureError) return this.failureError;
    return new Error(`Cannot write to lyx-mathd at ${this.binaryPath}: ${error.message}`);
  }
}

function createNativeMathClient(options) {
  return new NativeMathClient(options);
}

class LyxMathNativePlugin extends Plugin {
  async onload() {
    this.baseDir = getPluginBaseDir(this);
    this.addCommand({
      id: "edit-native-lyx-math-at-cursor",
      name: "Edit native LyX formula at cursor",
      editorCallback: editor => openFormulaAtCursor(this.app, editor, this.baseDir)
    });

    this.addCommand({
      id: "insert-native-lyx-math-formula",
      name: "Insert inline LyX formula",
      editorCallback: editor => insertFormulaAtCursor(this.app, editor, this.baseDir, false)
    });

    this.addCommand({
      id: "insert-native-lyx-display-math-formula",
      name: "Insert display LyX formula",
      editorCallback: editor => insertFormulaAtCursor(this.app, editor, this.baseDir, true)
    });

    this.addCommand({
      id: "native-lyx-math-status",
      name: "LyX native sidecar status",
      callback: () => new Notice(sidecarStatusMessage(this.baseDir))
    });
  }
}

class NativeMathModal extends Modal {
  constructor(app, options) {
    super(app);
    this.source = options.source;
    this.display = options.display;
    this.onSubmit = options.onSubmit;
    this.baseDir = options.baseDir;
    this.client = null;
    this.session = null;
    this.cancelPendingDraw = null;
  }

  async onOpen() {
    const contentEl = this.contentEl;
    clearElement(contentEl);
    contentEl.addClass && contentEl.addClass("lyx-native-modal");
    applyModalLayout(contentEl);

    const title = document.createElement("h2");
    title.textContent = "LyX Math Native";
    title.style.setProperty("font-size", "18px", "important");
    title.style.setProperty("line-height", "1.2", "important");
    contentEl.appendChild(title);

    const status = document.createElement("div");
    status.className = "lyx-native-status";
    applyWrappingBox(status);
    status.textContent = sidecarStatusMessage(this.baseDir);
    const healthyStatusText = status.textContent;
    contentEl.appendChild(status);

    const editorSurface = document.createElement("div");
    editorSurface.className = "lyx-native-editor";
    editorSurface.style.setProperty("font-size", "13px", "important");
    editorSurface.style.setProperty("line-height", "1.2", "important");
    editorSurface.tabIndex = 0;
    editorSurface.setAttribute("role", "textbox");
    editorSurface.setAttribute("aria-label", "LyX formula editor");
    editorSurface.setAttribute("aria-multiline", "true");
    applyWrappingBox(editorSurface);
    contentEl.appendChild(editorSurface);

    const controls = document.createElement("div");
    controls.className = "lyx-native-controls";
    contentEl.appendChild(controls);

    const structureControls = document.createElement("div");
    structureControls.className = "lyx-native-structure-controls";
    const structureSelect = document.createElement("select");
    structureSelect.className = "lyx-native-structure-select";
    structureSelect.setAttribute("aria-label", "Math structure");
    for (const [value, label] of [
      ["pmatrix", "( ) matrix"],
      ["bmatrix", "[ ] matrix"],
      ["Bmatrix", "{ } matrix"],
      ["vmatrix", "| | matrix"],
      ["Vmatrix", "|| || matrix"],
      ["matrix", "Plain matrix"],
      ["cases", "Cases"]
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      structureSelect.appendChild(option);
    }
    const rowsInput = document.createElement("input");
    rowsInput.className = "lyx-native-structure-size";
    rowsInput.type = "number";
    rowsInput.min = "1";
    rowsInput.max = "12";
    rowsInput.value = "2";
    rowsInput.setAttribute("aria-label", "Rows");
    const colsInput = document.createElement("input");
    colsInput.className = "lyx-native-structure-size";
    colsInput.type = "number";
    colsInput.min = "1";
    colsInput.max = "12";
    colsInput.value = "2";
    colsInput.setAttribute("aria-label", "Columns");
    const insertStructureButton = document.createElement("button");
    insertStructureButton.type = "button";
    insertStructureButton.textContent = "Insert";
    const lineBreakButton = document.createElement("button");
    lineBreakButton.type = "button";
    lineBreakButton.textContent = "Line";
    const addColumnButton = document.createElement("button");
    addColumnButton.type = "button";
    addColumnButton.textContent = "Col";
    structureControls.append(
      structureSelect,
      rowsInput,
      colsInput,
      insertStructureButton,
      lineBreakButton,
      addColumnButton
    );

    const modeButton = document.createElement("button");
    const saveButton = document.createElement("button");
    const cancelButton = document.createElement("button");
    modeButton.type = "button";
    saveButton.type = "button";
    cancelButton.type = "button";
    saveButton.textContent = "Save";
    cancelButton.textContent = "Cancel";
    modeButton.disabled = true;
    saveButton.disabled = true;
    controls.append(structureControls, modeButton, saveButton, cancelButton);

    let currentSource = this.source;
    const liveRenderScale = 2;
    const fullRenderScale = 4;
    const idleRenderDelayMs = 180;
    let drawCancelled = false;
    let highQualityTimer = null;
    let pendingMacroText = "";
    const clearHighQualityDraw = () => {
      if (!highQualityTimer) return;
      clearTimeout(highQualityTimer);
      highQualityTimer = null;
    };
    this.cancelPendingDraw = () => {
      drawCancelled = true;
      clearHighQualityDraw();
    };
    const draw = async (renderScale = fullRenderScale) => {
      if (drawCancelled) return;
      if (!this.client || !this.session) return;
      const rendered = await this.client.renderPainter(this.session, { renderScale });
      if (drawCancelled) return;
      if (typeof rendered.display === "boolean") this.display = rendered.display;
      renderNativePreview(editorSurface, rendered, currentSource);
      if (pendingMacroText) {
        renderPendingMacroPreview(editorSurface, pendingMacroText);
      } else if (!hasNativeCursor(rendered)) {
        appendEditorCaret(editorSurface);
      }
      modeButton.textContent = this.display ? "Display $$" : "Inline $";
    };

    let drawScheduled = false;
    let drawRunning = false;
    let drawAgain = false;
    let pendingDrawScale = null;
    const scheduleFrame = callback => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(callback);
      } else {
        setTimeout(callback, 16);
      }
    };
    const scheduleHighQualityDraw = () => {
      clearHighQualityDraw();
      highQualityTimer = setTimeout(() => {
        highQualityTimer = null;
        updateQueue.catch(() => {}).then(() => {
          if (!drawCancelled) scheduleDraw(fullRenderScale);
        });
      }, idleRenderDelayMs);
    };
    const runScheduledDraw = async () => {
      drawScheduled = false;
      if (drawCancelled) return;
      if (drawRunning) {
        drawAgain = true;
        return;
      }
      drawRunning = true;
      const renderScale = pendingDrawScale || fullRenderScale;
      pendingDrawScale = null;
      try {
        await draw(renderScale);
      } catch (error) {
        status.textContent = `Cannot render formula: ${error.message}`;
      } finally {
        drawRunning = false;
        if (drawAgain || pendingDrawScale !== null) {
          const nextScale = pendingDrawScale || liveRenderScale;
          drawAgain = false;
          scheduleDraw(nextScale);
        } else if (!drawCancelled && renderScale < fullRenderScale) {
          scheduleHighQualityDraw();
        }
      }
    };
    const scheduleDraw = (renderScale = liveRenderScale) => {
      if (drawCancelled) return;
      if (renderScale < fullRenderScale) clearHighQualityDraw();
      pendingDrawScale = renderScale;
      if (drawRunning) {
        drawAgain = true;
        return;
      }
      if (drawScheduled) return;
      drawScheduled = true;
      scheduleFrame(() => {
        runScheduledDraw();
      });
    };
    const showPendingMacro = text => {
      pendingMacroText = text || "";
      renderPendingMacroPreview(editorSurface, pendingMacroText);
    };

    let updateQueue = Promise.resolve();
    const updateFromNative = action => {
      updateQueue = updateQueue
        .catch(() => {})
        .then(async () => {
          if (!this.client || !this.session) return;
          const updated = await this.client.dispatch(this.session, action);
          if (typeof updated.source === "string") currentSource = updated.source;
          if (typeof updated.display === "boolean") this.display = updated.display;
          if (shouldDeferMacroRender(action, updated)) {
            clearHighQualityDraw();
            showPendingMacro(updated.macroName);
          } else {
            showPendingMacro("");
            scheduleDraw(liveRenderScale);
          }
          status.textContent = updated.lyxParseError || healthyStatusText;
        })
        .catch(error => {
          status.textContent = `Cannot update formula: ${error.message}`;
        });
      return updateQueue;
    };
    const updateFromSource = () => {
      updateQueue = updateQueue
        .catch(() => {})
        .then(async () => {
          if (!this.client || !this.session) return;
          showPendingMacro("");
          const updated = await this.client.setSession(this.session, currentSource, this.display);
          if (typeof updated.source === "string") currentSource = updated.source;
          if (typeof updated.display === "boolean") this.display = updated.display;
          scheduleDraw(liveRenderScale);
          status.textContent = updated.lyxParseError || healthyStatusText;
        })
        .catch(error => {
          status.textContent = `Cannot update formula: ${error.message}`;
        });
      return updateQueue;
    };

    try {
      this.client = createNativeMathClient({ baseDir: this.baseDir });
      const created = await this.client.createSession(currentSource, this.display);
      this.session = created.session;
      if (typeof created.source === "string") currentSource = created.source;
      if (typeof created.display === "boolean") this.display = created.display;
      modeButton.disabled = false;
      saveButton.disabled = false;
      await draw();
    } catch (error) {
      status.textContent = `Cannot start lyx-mathd: ${error.message}`;
      modeButton.disabled = true;
      saveButton.disabled = true;
      return;
    }

    editorSurface.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        saveButton.click();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Tab") {
        event.preventDefault();
        updateFromNative({ type: event.shiftKey ? "cellBackward" : "cellForward" });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        updateFromNative({ type: "newline" });
        return;
      }

      const actions = {
        Backspace: { type: "backspace" },
        Delete: { type: "delete" },
        ArrowLeft: { type: "moveBackward" },
        ArrowRight: { type: "moveForward" },
        ArrowUp: { type: "moveUp" },
        ArrowDown: { type: "moveDown" }
      };
      if (actions[event.key]) {
        event.preventDefault();
        updateFromNative(actions[event.key]);
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        updateFromNative({ type: "insertText", text: event.key });
      }
    });

    editorSurface.addEventListener("paste", event => {
      const text = event.clipboardData && event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      updateFromNative({ type: "pasteLatex", text });
    });

    modeButton.addEventListener("click", async () => {
      await updateFromNative({ type: "setDisplay", display: !this.display });
      editorSurface.focus();
    });

    const boundedInputValue = input => {
      const value = Number.parseInt(input.value, 10);
      if (!Number.isFinite(value)) return 2;
      return Math.max(1, Math.min(12, value));
    };
    const syncStructureControls = () => {
      colsInput.disabled = structureSelect.value === "cases";
    };
    structureSelect.addEventListener("change", syncStructureControls);
    syncStructureControls();

    insertStructureButton.addEventListener("click", () => {
      const rows = boundedInputValue(rowsInput);
      const cols = boundedInputValue(colsInput);
      if (structureSelect.value === "cases") {
        updateFromNative({ type: "insertCases", rows });
      } else {
        updateFromNative({
          type: "insertAmsMatrix",
          rows,
          cols,
          decoration: structureSelect.value
        });
      }
      editorSurface.focus();
    });

    lineBreakButton.addEventListener("click", () => {
      updateFromNative({ type: "newline" });
      editorSurface.focus();
    });

    addColumnButton.addEventListener("click", () => {
      updateFromNative({ type: "addColumn" });
      editorSurface.focus();
    });

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      try {
        await updateQueue.catch(() => {});
        const serialized = await this.client.serialize(this.session);
        const wrapped = serialized.display ? `$$${serialized.latex}$$` : `$${serialized.latex}$`;
        this.onSubmit(wrapped);
        this.close();
      } catch (error) {
        status.textContent = `Cannot save formula: ${error.message}`;
        saveButton.disabled = false;
      }
    });

    cancelButton.addEventListener("click", () => this.close());

    editorSurface.focus();
  }

  async onClose() {
    if (this.cancelPendingDraw) this.cancelPendingDraw();
    if (this.client && this.session) {
      try {
        await this.client.closeSession(this.session);
      } catch {}
    }
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch {}
    }
    if (this.contentEl) clearElement(this.contentEl);
  }
}

function getPluginBaseDir(plugin) {
  const adapter = plugin && plugin.app && plugin.app.vault && plugin.app.vault.adapter;
  const manifest = plugin && plugin.manifest;
  const candidates = [];
  const pluginId = manifest && manifest.id;
  const manifestDir = manifest && manifest.dir;
  if (manifestDir && path.isAbsolute(manifestDir)) candidates.push(manifestDir);
  if (adapter && typeof adapter.getBasePath === "function") {
    const vaultBase = adapter.getBasePath();
    const configDir = plugin.app.vault.configDir || ".obsidian";
    if (manifestDir && !path.isAbsolute(manifestDir)) candidates.push(path.join(vaultBase, manifestDir));
    if (pluginId) candidates.push(path.join(vaultBase, pluginId));
    if (manifestDir) candidates.push(path.join(vaultBase, configDir, "plugins", path.basename(manifestDir)));
    if (pluginId) candidates.push(path.join(vaultBase, configDir, "plugins", pluginId));
  }
  candidates.push(__dirname);
  return bestPluginBaseDir(candidates);
}

function bestPluginBaseDir(candidates) {
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
  }
  const hasSidecar = candidate => fs.existsSync(path.join(candidate, "bin", platformTriplet(), executableName()));
  return unique.find(hasSidecar)
    || unique.find(candidate => fs.existsSync(path.join(candidate, "manifest.json")))
    || unique[0]
    || __dirname;
}

function sidecarStatusMessage(baseDir = __dirname) {
  const status = detectSidecar(baseDir);
  if (status.available) return `lyx-mathd available: ${status.version}`;
  return `lyx-mathd unavailable at ${status.binaryPath}: ${status.reason}`;
}

function openFormulaAtCursor(app, editor, baseDir) {
  const context = getFormulaContext(editor);
  if (!context) {
    new Notice("No $...$ or $$...$$ formula at the cursor.");
    return;
  }
  openFormulaModal(app, editor, context, baseDir);
}

function insertFormulaAtCursor(app, editor, baseDir, display = false) {
  const offset = editorPositionToOffset(editor, editor.getCursor());
  openFormulaModal(app, editor, {
    from: offset,
    to: offset,
    display,
    source: ""
  }, baseDir);
}

function openFormulaModal(app, editor, context, baseDir) {
  new NativeMathModal(app, {
    source: context.source,
    display: context.display,
    baseDir,
    onSubmit: replacement => {
      editor.replaceRange(
        replacement,
        editorOffsetToPosition(editor, context.from),
        editorOffsetToPosition(editor, context.to)
      );
      editor.setCursor(editorOffsetToPosition(editor, context.from + replacement.length));
    }
  }).open();
}

function getFormulaContext(editor) {
  const text = editor.getValue();
  const cursorOffset = editorPositionToOffset(editor, editor.getCursor());
  return scanMathRanges(text).find(range => range.from <= cursorOffset && cursorOffset <= range.to) || null;
}

function scanMathRanges(text) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "$" || isEscaped(text, i)) {
      i++;
      continue;
    }
    const display = text[i + 1] === "$";
    const openLength = display ? 2 : 1;
    const close = findClosingDollar(text, i + openLength, display);
    if (close === -1) {
      i += openLength;
      continue;
    }
    ranges.push({
      from: i,
      to: close + openLength,
      display,
      source: text.slice(i + openLength, close)
    });
    i = close + openLength;
  }
  return ranges;
}

function findClosingDollar(text, start, display) {
  for (let i = start; i < text.length; i++) {
    if (text[i] !== "$" || isEscaped(text, i)) continue;
    if (display) {
      if (text[i + 1] === "$") return i;
    } else if (text[i + 1] !== "$") {
      return i;
    }
  }
  return -1;
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashCount++;
  return slashCount % 2 === 1;
}

function editorPositionToOffset(editor, position) {
  if (typeof editor.posToOffset === "function") return editor.posToOffset(position);
  const lines = editor.getValue().split("\n");
  let offset = 0;
  for (let line = 0; line < position.line; line++) offset += lines[line].length + 1;
  return offset + position.ch;
}

function editorOffsetToPosition(editor, offset) {
  if (typeof editor.offsetToPos === "function") return editor.offsetToPos(offset);
  const lines = editor.getValue().split("\n");
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line].length) return { line, ch: remaining };
    remaining -= lines[line].length + 1;
  }
  return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}

function clearElement(element) {
  while (element && element.firstChild) element.removeChild(element.firstChild);
}

function applyModalLayout(contentEl) {
  if (!contentEl || !contentEl.style) return;
  contentEl.style.boxSizing = "border-box";
  contentEl.style.width = "min(760px, 92vw)";
  contentEl.style.maxWidth = "92vw";
  contentEl.style.minWidth = "0";
  contentEl.style.setProperty("font-size", "13px", "important");
  contentEl.style.setProperty("line-height", "1.4", "important");
  contentEl.style.overflowX = "hidden";
  const modalEl = typeof contentEl.closest === "function" ? contentEl.closest(".modal") : null;
  if (modalEl && modalEl.style) {
    modalEl.classList.add("lyx-native-modal-shell");
    modalEl.style.boxSizing = "border-box";
    modalEl.style.width = "min(820px, 94vw)";
    modalEl.style.maxWidth = "94vw";
    modalEl.style.minWidth = "0";
    modalEl.style.overflowX = "hidden";
  }
}

function applyWrappingBox(element) {
  if (!element || !element.style) return;
  element.style.boxSizing = "border-box";
  element.style.display = "block";
  element.style.width = "100%";
  element.style.maxWidth = "100%";
  element.style.minWidth = "0";
  element.style.overflowX = "hidden";
  element.style.whiteSpace = "pre-wrap";
  element.style.overflowWrap = "anywhere";
  element.style.wordBreak = "break-all";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nativeCssPixels(rendered, logicalKey, pixelKey) {
  const pixel = positiveNumber(rendered && rendered[pixelKey]);
  const scale = positiveNumber(rendered && rendered.renderScale) || 1;
  if (pixel && scale > 1) return pixel / scale;
  return positiveNumber(rendered && rendered[logicalKey]);
}

function applyFixedTextSize(element, sizePx = 13, lineHeight = "1.2") {
  if (!element || !element.style) return;
  element.style.setProperty("font-size", `${sizePx}px`, "important");
  element.style.setProperty("line-height", lineHeight, "important");
}

function renderNativePreview(preview, rendered, fallbackSource) {
  clearElement(preview);
  applyFixedTextSize(preview, 13, "1.2");
  const content = document.createElement("div");
  content.className = "lyx-native-preview-content";
  applyWrappingBox(content);
  applyFixedTextSize(content, 13, "1.2");
  if (rendered && typeof rendered.png === "string" && rendered.png) {
    const painter = document.createElement("div");
    painter.className = "lyx-native-painter";
    painter.style.display = "inline-block";
    painter.style.maxWidth = "100%";
    painter.style.overflow = "hidden";
    applyFixedTextSize(painter, 13, "1.2");
    const image = document.createElement("img");
    image.className = "lyx-native-painter-image";
    image.src = rendered.png;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.style.setProperty("display", "block", "important");
    image.style.setProperty("max-width", "100%", "important");
    image.style.setProperty("vertical-align", "middle", "important");
    const width = nativeCssPixels(rendered, "width", "pixelWidth");
    const height = nativeCssPixels(rendered, "height", "pixelHeight");
    if (width) {
      image.width = Math.round(width);
      image.style.setProperty("width", `${width}px`, "important");
    }
    if (height) {
      image.height = Math.round(height);
      image.style.setProperty("height", `${height}px`, "important");
    }
    painter.appendChild(image);
    content.appendChild(painter);
  } else if (rendered && typeof rendered.svg === "string" && rendered.svg) {
    const painter = document.createElement("div");
    painter.className = "lyx-native-painter";
    painter.innerHTML = rendered.svg;
    painter.style.display = "inline-block";
    painter.style.maxWidth = "100%";
    painter.style.overflow = "hidden";
    applyFixedTextSize(painter, 13, "1.2");
    const svg = painter.querySelector("svg");
    if (svg) {
      const width = positiveNumber(svg.getAttribute("width"));
      const height = positiveNumber(svg.getAttribute("height"));
      if (Number.isFinite(width) && width > 0) svg.style.setProperty("width", `${width}px`, "important");
      if (Number.isFinite(height) && height > 0) svg.style.setProperty("height", `${height}px`, "important");
      svg.style.setProperty("max-width", "100%", "important");
      svg.style.setProperty("vertical-align", "middle", "important");
      svg.style.setProperty("font-size", "13px", "important");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");
    }
    content.appendChild(painter);
  } else if (rendered && typeof rendered.html === "string" && rendered.html) {
    content.innerHTML = rendered.html;
    for (const node of content.querySelectorAll("code, span, math")) {
      applyWrappingBox(node);
      applyFixedTextSize(node, 13, node.tagName && node.tagName.toLowerCase() === "code" ? "1.45" : "1.2");
    }
  }
  if (!content.textContent && fallbackSource) {
    const code = document.createElement("code");
    applyWrappingBox(code);
    applyFixedTextSize(code, 13, "1.45");
    code.textContent = fallbackSource;
    content.appendChild(code);
  }
  preview.appendChild(content);
}

function appendEditorCaret(editorSurface) {
  const caret = document.createElement("span");
  caret.className = "lyx-native-caret";
  caret.setAttribute("aria-hidden", "true");
  editorSurface.appendChild(caret);
}

function isAlphabeticPendingMacro(updated) {
  return Boolean(updated
    && updated.macroMode === true
    && typeof updated.macroName === "string"
    && /^\\[A-Za-z]*$/.test(updated.macroName));
}

function shouldDeferMacroRender(action, updated) {
  return Boolean(action
    && (action.type === "insertText" || action.type === "backspace" || action.type === "delete")
    && isAlphabeticPendingMacro(updated));
}

function renderPendingMacroPreview(editorSurface, macroName) {
  if (!editorSurface || typeof editorSurface.querySelectorAll !== "function") return;
  for (const node of editorSurface.querySelectorAll(".lyx-native-pending-macro")) {
    node.remove();
  }
  if (!macroName) return;
  const pending = document.createElement("span");
  pending.className = "lyx-native-pending-macro";
  pending.textContent = macroName;
  pending.setAttribute("aria-label", `Pending LyX command ${macroName}`);
  editorSurface.appendChild(pending);
}

function hasNativeCursor(rendered) {
  return Boolean(rendered && Array.isArray(rendered.ops)
    && rendered.ops.some(op => op && op.type === "cursor"));
}

module.exports = LyxMathNativePlugin;
module.exports.default = LyxMathNativePlugin;
module.exports.scanMathRanges = scanMathRanges;
module.exports._private = {
  editorPositionToOffset,
  editorOffsetToPosition,
  applyModalLayout,
  applyWrappingBox,
  appendEditorCaret,
  hasNativeCursor,
  shouldDeferMacroRender,
  getPluginBaseDir,
  renderNativePreview,
  renderPendingMacroPreview,
  sidecarStatusMessage
};

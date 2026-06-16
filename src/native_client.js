"use strict";

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

function resolveSidecarPath(baseDir = path.resolve(__dirname, "..")) {
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

function sidecarEnv(extra = {}, baseDir = path.resolve(__dirname, "..")) {
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

function detectSidecar(baseDir = path.resolve(__dirname, "..")) {
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
    this.baseDir = path.resolve(options.baseDir || path.resolve(__dirname, ".."));
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

module.exports = {
  NativeMathClient,
  createNativeMathClient: options => new NativeMathClient(options),
  detectSidecar,
  sidecarEnv,
  resolveSidecarPath
};

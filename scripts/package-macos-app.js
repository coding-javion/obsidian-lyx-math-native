"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "darwin") {
  console.error("package-macos-app is only supported on macOS.");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const executable = "lyx-mathd";
const triplet = `${process.platform}-${process.arch}`;
const source = process.env.LYX_MATHD_SOURCE
  ? path.resolve(process.env.LYX_MATHD_SOURCE)
  : path.join(root, "native", "lyx-mathd", "build", executable);
const appDir = path.join(root, "bin", triplet, "LyxMathd.app");
const macosDir = path.join(appDir, "Contents", "MacOS");
const target = path.join(macosDir, executable);
const infoPlist = path.join(appDir, "Contents", "Info.plist");
const macdeployqt = process.env.MACDEPLOYQT || "macdeployqt";

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function commandOutput(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function qtPluginDir() {
  if (process.env.QT_PLUGIN_DIR) return process.env.QT_PLUGIN_DIR;
  return commandOutput("qmake", ["-query", "QT_INSTALL_PLUGINS"])
    || commandOutput("qtpaths", ["--query", "QT_INSTALL_PLUGINS"]);
}

function addPluginFrameworkRpath(pluginPath) {
  const rpath = "@loader_path/../../Frameworks";
  const current = commandOutput("otool", ["-l", pluginPath]) || "";
  if (current.includes(`path ${rpath} `)) return;

  const result = childProcess.spawnSync("install_name_tool", ["-add_rpath", rpath, pluginPath], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0 && !/would duplicate path/.test(result.stderr || "")) {
    throw new Error(`install_name_tool -add_rpath ${rpath} ${pluginPath} failed with status ${result.status}`);
  }
}

function copyQtPlugin(pluginsDir, relativePath) {
  const sourcePlugin = path.join(pluginsDir, relativePath);
  if (!fs.existsSync(sourcePlugin)) {
    throw new Error(`Missing Qt plugin: ${sourcePlugin}`);
  }
  const targetPlugin = path.join(appDir, "Contents", "PlugIns", relativePath);
  fs.mkdirSync(path.dirname(targetPlugin), { recursive: true });
  fs.copyFileSync(sourcePlugin, targetPlugin);
  fs.chmodSync(targetPlugin, 0o755);
  addPluginFrameworkRpath(targetPlugin);
}

if (!fs.existsSync(source)) {
  console.error(`Missing native helper: ${source}`);
  console.error("Run npm run native:build first.");
  process.exit(1);
}

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(macosDir, { recursive: true });
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
fs.writeFileSync(infoPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${executable}</string>
  <key>CFBundleIdentifier</key>
  <string>org.obsidianmd.plugins.lyx-math-native.sidecar</string>
  <key>CFBundleName</key>
  <string>LyxMathd</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.1</string>
  <key>CFBundleVersion</key>
  <string>0.1.1</string>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
`);

run(macdeployqt, [appDir, "-always-overwrite", "-no-plugins", "-no-codesign"]);

const pluginsDir = qtPluginDir();
if (!pluginsDir) {
  throw new Error("Cannot find Qt plugin directory. Set QT_PLUGIN_DIR or put qmake/qtpaths on PATH.");
}
copyQtPlugin(pluginsDir, path.join("platforms", "libqcocoa.dylib"));
copyQtPlugin(pluginsDir, path.join("styles", "libqmacstyle.dylib"));

const resourcesDir = path.join(appDir, "Contents", "Resources");
fs.mkdirSync(resourcesDir, { recursive: true });
fs.writeFileSync(path.join(resourcesDir, "qt.conf"), "[Paths]\nPlugins = PlugIns\n");

if (process.env.CODESIGN_IDENTITY) {
  run("codesign", ["--force", "--deep", "--options", "runtime", "--sign", process.env.CODESIGN_IDENTITY, appDir]);
} else {
  run("codesign", ["--force", "--deep", "--sign", "-", appDir]);
}

console.log(`Packaged macOS app sidecar: ${path.relative(root, appDir)}`);

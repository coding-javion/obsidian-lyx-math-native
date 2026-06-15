"use strict";

const childProcess = require("child_process");
const path = require("path");
const { findLyxSourceDir, lyxBuildDir } = require("./lyx-paths");

const root = path.resolve(__dirname, "..");
const lyxSourceDir = findLyxSourceDir(root);
const buildDir = lyxBuildDir();
const nativeBuildDir = path.join(root, "native", "lyx-mathd", "build");

const args = [
  "-S", path.join(root, "native", "lyx-mathd"),
  "-B", nativeBuildDir,
  "-DLYX_MATHD_USE_LYX_MATHED=ON",
  `-DLYX_SOURCE_DIR=${lyxSourceDir}`,
  `-DLYX_BUILD_DIR=${buildDir}`
];

const result = childProcess.spawnSync("cmake", args, {
  cwd: root,
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status || 0);

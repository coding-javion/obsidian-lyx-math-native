"use strict";

const childProcess = require("child_process");
const path = require("path");
const { findLyxSourceDir, lyxBuildDir } = require("./lyx-paths");

const root = path.resolve(__dirname, "..");
const lyxSourceDir = findLyxSourceDir(root);
const buildDir = lyxBuildDir();

const result = childProcess.spawnSync("cmake", ["-S", lyxSourceDir, "-B", buildDir], {
  cwd: root,
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status || 0);

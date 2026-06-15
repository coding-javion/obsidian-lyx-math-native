"use strict";

const fs = require("fs");
const path = require("path");

function looksLikeLyxSource(candidate) {
  return fs.existsSync(path.join(candidate, "src", "mathed"))
    && fs.existsSync(path.join(candidate, "lib", "symbols"))
    && fs.existsSync(path.join(candidate, "CMakeLists.txt"));
}

function findLyxSourceDir(root) {
  const candidates = [
    process.env.LYX_SOURCE_DIR,
    path.resolve(root, "third_party", "lyx"),
    path.resolve(root, ".."),
    path.resolve(root, "..", "lyx-2.5.1")
  ].filter(Boolean).map(candidate => path.resolve(candidate));

  const found = candidates.find(looksLikeLyxSource);
  if (!found) {
    throw new Error("Could not find LyX source tree. Set LYX_SOURCE_DIR to a LyX 2.5.1 source checkout.");
  }
  return found;
}

function lyxBuildDir() {
  return process.env.LYX_BUILD_DIR
    ? path.resolve(process.env.LYX_BUILD_DIR)
    : "/tmp/lyx-2.5.1-qt-build";
}

module.exports = {
  findLyxSourceDir,
  lyxBuildDir
};

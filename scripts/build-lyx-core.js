"use strict";

const childProcess = require("child_process");
const { lyxBuildDir } = require("./lyx-paths");

const result = childProcess.spawnSync("cmake", [
  "--build",
  lyxBuildDir(),
  "--target",
  "mathed",
  "support",
  "insets",
  "frontends",
  "graphics",
  "frontend_qt",
  "lyxcore_for_mathd",
  "-j",
  process.env.LYX_BUILD_JOBS || "8"
], {
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exit(result.status || 0);

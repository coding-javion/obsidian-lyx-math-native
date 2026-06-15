"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const executable = process.platform === "win32" ? "lyx-mathd.exe" : "lyx-mathd";
const source = process.env.LYX_MATHD_SOURCE
  ? path.resolve(process.env.LYX_MATHD_SOURCE)
  : path.join(root, "native", "lyx-mathd", "build", executable);
const targetDir = path.join(root, "bin", `${process.platform}-${process.arch}`);
const target = path.join(targetDir, executable);

if (!fs.existsSync(source)) {
  console.error(`Missing native helper: ${source}`);
  console.error("Run npm run native:configure and npm run native:build first.");
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
if (process.platform !== "win32") fs.chmodSync(target, 0o755);

console.log(`Packaged native helper: ${path.relative(root, target)}`);

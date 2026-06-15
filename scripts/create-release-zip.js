"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const triplet = `${process.platform}-${process.arch}`;
const distDir = path.join(root, "dist");
const zipName = `${manifest.id}-${manifest.version}-${triplet}.zip`;
const zipPath = path.join(distDir, zipName);

const required = [
  "manifest.json",
  "main.js",
  "styles.css",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "support/lyx",
  `bin/${triplet}`
];

for (const entry of required) {
  if (!fs.existsSync(path.join(root, entry))) {
    console.error(`Missing release entry: ${entry}`);
    process.exit(1);
  }
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

const result = childProcess.spawnSync("zip", ["-r", zipPath, ...required], {
  cwd: root,
  stdio: "inherit"
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status);

console.log(`Created release zip: ${path.relative(root, zipPath)}`);

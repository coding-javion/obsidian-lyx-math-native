"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { findLyxSourceDir } = require("./lyx-paths");

const root = path.resolve(__dirname, "..");
const lyxSourceDir = process.env.LYX_SOURCE_DIR
  ? path.resolve(process.env.LYX_SOURCE_DIR)
  : findLyxSourceDir(root);
const sourceLib = process.env.LYX_LIB_DIR
  ? path.resolve(process.env.LYX_LIB_DIR)
  : path.join(lyxSourceDir, "lib");
const targetLib = path.join(root, "support", "lyx");
const configureScript = path.join(sourceLib, "configure.py");

const entries = [
  "autocorrect",
  "chkconfig.ltx",
  "citeengines",
  "encodings",
  "fonts",
  "languages",
  "latexcolors",
  "latexfonts",
  "layouts",
  "layouttranslations",
  "math_conflicts",
  "symbols",
  "syntax.default",
  "unicode_alphanum_variants",
  "unicodesymbols"
];

if (!fs.existsSync(sourceLib)) {
  console.error(`Missing LyX lib directory: ${sourceLib}`);
  console.error("Set LYX_SOURCE_DIR or LYX_LIB_DIR before running this script.");
  process.exit(1);
}
if (!fs.existsSync(configureScript)) {
  console.error(`Missing LyX configure script: ${configureScript}`);
  process.exit(1);
}

fs.rmSync(targetLib, { recursive: true, force: true });
fs.mkdirSync(targetLib, { recursive: true });

for (const entry of entries) {
  const source = path.join(sourceLib, entry);
  if (!fs.existsSync(source)) {
    console.error(`Missing required LyX runtime resource: ${source}`);
    process.exit(1);
  }
  const target = path.join(targetLib, entry);
  fs.cpSync(source, target, {
    recursive: true,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true
  });
}

const configure = childProcess.spawnSync("python3", [
  configureScript,
  "--without-kpsewhich",
  "--without-latex-config"
], {
  cwd: targetLib,
  stdio: "inherit"
});
if (configure.error) throw configure.error;
if (configure.status !== 0) process.exit(configure.status);

const generatedEntries = [
  "lyxrc.defaults",
  "packages.lst",
  "textclass.lst",
  "lyxmodules.lst",
  "lyxciteengines.lst",
  "xtemplates.lst"
];
for (const entry of generatedEntries) {
  const generated = path.join(targetLib, entry);
  if (!fs.existsSync(generated)) {
    console.error(`Missing generated LyX runtime resource: ${generated}`);
    process.exit(1);
  }
}

const textclassList = fs.readFileSync(path.join(targetLib, "textclass.lst"), "utf8");
if (!/"article"\s+"article"/.test(textclassList)) {
  console.error("Generated textclass.lst does not contain the article textclass.");
  process.exit(1);
}

fs.rmSync(path.join(targetLib, "configure.log"), { force: true });

console.log(`Packaged LyX runtime resources: ${path.relative(root, targetLib)}`);

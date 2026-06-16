"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageName = `${manifest.id}-${manifest.version}-source`;
const distDir = path.join(root, "dist");
const tarPath = path.join(distDir, `${packageName}.tar.gz`);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${manifest.id}-source-`));
const stageRoot = path.join(tmpRoot, packageName);
const includeLyxSource = process.env.INCLUDE_LYX_SOURCE === "1";
const lyxSourceDir = process.env.LYX_SOURCE_DIR ? path.resolve(process.env.LYX_SOURCE_DIR) : null;
const lyxSourceUrl = process.env.LYX_SOURCE_URL || "https://ftp.lyx.org/pub/lyx/stable/2.5.x/lyx-2.5.1.tar.xz";
const lyxSourceSha256 = process.env.LYX_SOURCE_SHA256 || "";

const projectExcludes = [
  ".git",
  ".DS_Store",
  "node_modules",
  "dist",
  "bin",
  "support",
  "native/lyx-mathd/build"
];

const lyxExcludes = [
  ".git",
  ".DS_Store",
  "autom4te.cache",
  "obsidian-lyx-math-native",
  "lyx-math"
];

function normalize(rel) {
  return rel.split(path.sep).join("/");
}

function excluded(rel, patterns) {
  const item = normalize(rel);
  if (!item) return false;
  const base = item.split("/").pop();
  if (base === ".DS_Store" || base.endsWith(".log")) return true;
  return patterns.some(pattern => item === pattern || item.startsWith(`${pattern}/`));
}

function copyTree(src, dest, base, excludes) {
  const stat = fs.lstatSync(src);
  const rel = path.relative(base, src);
  if (excluded(rel, excludes)) return;

  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dest, entry), base, excludes);
    }
    return;
  }

  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, stat.mode);
  }
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: tmpRoot,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

fs.mkdirSync(stageRoot, { recursive: true });
copyTree(root, stageRoot, root, projectExcludes);

if (includeLyxSource) {
  if (!lyxSourceDir || !fs.existsSync(path.join(lyxSourceDir, "src", "mathed"))) {
    throw new Error("INCLUDE_LYX_SOURCE=1 requires LYX_SOURCE_DIR to point to a LyX source tree.");
  }
  copyTree(lyxSourceDir, path.join(stageRoot, "third_party", "lyx"), lyxSourceDir, lyxExcludes);
}

const correspondingSource = `# Corresponding Source

This archive contains the source for ${manifest.name} ${manifest.version}.

## Included

- Obsidian plugin source.
- Native sidecar source under \`native/lyx-mathd\`.
- Build and packaging scripts under \`scripts\`.
- LyX 2.5.1 sidecar patch under \`patches/lyx-2.5.1-mathd-cmake.patch\`.
- Documentation, license, and third-party notices.
${includeLyxSource ? "- A LyX source tree under `third_party/lyx`.\n" : ""}
## LyX Source

The native helper links LyX math editor code. The expected LyX source release is:

- Version: 2.5.1
- URL: ${lyxSourceUrl}
${lyxSourceSha256 ? `- SHA256: ${lyxSourceSha256}\n` : ""}
Apply this project patch before building:

\`\`\`bash
patch -p1 < patches/lyx-2.5.1-mathd-cmake.patch
\`\`\`

If this archive contains \`third_party/lyx\`, use that copy as \`LYX_SOURCE_DIR\`.
Otherwise download LyX 2.5.1 from the URL above and set \`LYX_SOURCE_DIR\` to the extracted source tree.

## Build

See \`BUILDING.md\`.
`;

fs.writeFileSync(path.join(stageRoot, "CORRESPONDING_SOURCE.md"), correspondingSource);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(tarPath, { force: true });
run("tar", ["-czf", tarPath, packageName]);
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`Created source tarball: ${path.relative(root, tarPath)}`);

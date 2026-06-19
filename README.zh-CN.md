# LyX Math Native for Obsidian

[English README](README.md)

LyX Math Native 是一个 Obsidian 桌面端插件，用一个原生 C++ sidecar 进程来编辑公式。这个 sidecar 链接了 LyX 自身的数学编辑器代码，因此公式树、结构化输入、光标移动、排版尺寸和 Qt painter 渲染都尽量交给 LyX 的原生组件处理，而不是在 JavaScript 里重新实现一套 LyX 风格编辑器。

这个项目和已有的纯 JavaScript LyX 风格数学插件无关。

## 当前状态

这是一个早期原生原型。当前已打包的发布目标是：

- macOS arm64
- Obsidian 桌面版
- LyX 2.5.1 数学编辑代码
- 通过 `macdeployqt` 打包的 Qt app bundle sidecar

Obsidian 移动端不支持，因为插件需要启动本地原生进程。

## 功能

- 在 Obsidian 中打开一个小型 LyX 风格公式编辑窗口。
- 用不同命令分别插入行内公式和行间公式。
- 用 LyX `mathed` 结构保存已解析公式状态，而不是把编辑器做成普通 LaTeX 预览框。
- 使用 LyX/Qt painter 输出高清渲染结果。
- 支持常见结构化输入，包括分式、希腊字母宏、矩阵、cases、多行行间公式、单元格跳转、添加行和添加列。
- 行内/行间切换时保留矩阵结构，不会因为重新解析 LaTeX 丢掉空列。
- 打包了 LyX 运行所需的支持文件，用户安装插件包时不需要额外安装 LyX。

## 安装

普通用户应该安装 release zip，不应该自己编译 LyX，也不应该把整个源码仓库 clone 到 Obsidian vault 里。

从 GitHub Releases 下载与你的平台匹配的 release zip。当前 macOS arm64 构建的文件名类似：

```text
lyx-math-0.0.1-darwin-arm64.zip
```

手动安装步骤：

1. 打开你的 vault 插件目录：

   ```text
   <vault>/.obsidian/plugins/
   ```

2. 新建插件目录：

   ```text
   lyx-math
   ```

3. 把 zip 内容解压到这个目录中。目录内应该能看到 `manifest.json`、`main.js`、`styles.css`、`bin/` 和 `support/`。

4. 重启 Obsidian，或者重新加载插件。
5. 在 Community plugins 中启用 `LyX Math Native`。

## Obsidian 命令

插件会注册这些命令：

- `Insert inline LyX formula`
- `Insert display LyX formula`
- `Edit native LyX formula at cursor`
- `Insert matrix row in LyX formula editor`
- `Insert matrix column in LyX formula editor`
- `LyX native sidecar status`

行内公式和行间公式故意分成两个插入命令，因为 sidecar 会保存对应的 LyX hull 样式。
矩阵行/列命令用于在 LyX 公式编辑窗口打开时，通过 Obsidian Hotkeys 设置绑定快捷键。

## 目录结构

- `manifest.json`、`main.js`、`styles.css`：Obsidian 插件运行时代码。
- `src/native_client.js`：调用原生 sidecar 的 Node 客户端。
- `native/lyx-mathd`：C++ sidecar 源码。
- `scripts`：构建、打包和发布辅助脚本。
- `patches`：让 LyX 2.5.1 暴露 sidecar 所需数学核心 target 的补丁。
- `support/lyx`：由 `npm run support:package` 生成的 LyX 运行支持文件。
- `bin/<platform>-<arch>`：由原生打包脚本生成的 sidecar 二进制。
- `dist`：生成的 Obsidian 可安装 release zip。

## 从源码构建

这一节面向开发者和发布维护者。普通用户应该直接使用 release zip。完整构建说明见 [BUILDING.md](BUILDING.md)。

macOS 本地开发的简要流程：

```bash
cd /path/to/ObsidianLyX
export LYX_SOURCE_DIR=/path/to/lyx-2.5.1
export LYX_BUILD_DIR=/tmp/lyx-2.5.1-qt-build

cd "$LYX_SOURCE_DIR"
patch -p1 < /path/to/ObsidianLyX/patches/lyx-2.5.1-mathd-cmake.patch

cd /path/to/ObsidianLyX
npm run lyx:configure
npm run lyx:build-core
npm run native:configure:lyx
npm run native:build
npm run native:package
npm run support:package
npm test
```

生成更完整的 macOS 自包含 sidecar：

```bash
npm run native:package:macos-app
npm test
npm run release:all
```

release 文件会生成在 `dist/` 目录下。

## 测试

运行：

```bash
npm test
```

测试会启动打包后的 sidecar，检查原生协议，验证 LyX 解析和渲染，覆盖宏补全、删除、光标移动、矩阵编辑、行内/行间切换、多行公式，以及 Obsidian 公式范围扫描。

## 常见问题

如果 Obsidian 报告无法启动 `lyx-mathd`，先检查：

- 已安装插件目录内是否存在 `bin/<platform>-<arch>/`；
- release zip 是否匹配当前 CPU 架构；
- `lyx-mathd` 是否有可执行权限；
- macOS 是否给解压后的文件加了 quarantine 标记。

如果插件能加载，但 sidecar 状态命令显示不可用，可以在插件目录中运行：

```bash
npm test
```

本地未正式签名的 macOS 构建可能被 Gatekeeper 阻止。公开发布时应该使用 Apple Developer ID 签名并 notarize。

## 发布流程

仓库内已经包含 GitHub Actions workflow：`.github/workflows/release.yml`。

- 手动运行 `workflow_dispatch` 会构建并上传 workflow artifacts。
- 推送 `0.0.1` 这类 tag 时，会构建 macOS arm64 release 并发布到 GitHub Release。
- 每个 release 应同时包含 `main.js`、`manifest.json`、`styles.css`、可安装插件 zip 和对应源码 tarball。

本地生成 macOS arm64 release：

```bash
npm run native:build
npm run native:package
npm run support:package
npm run native:package:macos-app
npm test
npm run release:all
```

发布时上传 `dist/` 下生成的文件作为 GitHub Release assets：

```text
main.js
manifest.json
styles.css
lyx-math-0.0.1-darwin-arm64.zip
lyx-math-0.0.1-source.tar.gz
```

用户安装 zip。source tarball 用于 GPL 对应源码和开发者复现构建。

发布前请看 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。

## 许可证

因为原生 helper 链接了 LyX 代码，本项目采用 GPL-2.0-or-later。见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

分发二进制时需要同时提供对应源码。对本项目来说，对应源码是 `npm run release:source` 生成的 source tarball，其中包含本项目源码、LyX 2.5.1 源码引用或随包源码，以及 `patches/lyx-2.5.1-mathd-cmake.patch`。

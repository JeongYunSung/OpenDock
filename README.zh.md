<div align="center">

# OpenDock

**面向 AI 工作区的已审核 dock。**

用一条命令安装你信任的项目设置。保持命令面小、设置可重复，并让每个生成文件都可审计。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock 是一个 Bun-first TypeScript CLI，用于把已审核的 dock 安装到当前项目目录。

第一个 dock 是 `opendock/codex`：它会检查 Node，安装 Codex CLI，应用可审阅的项目文件，并通过 OpenDock state 追踪设置状态。

OpenDock 有意不做终端替代品。它是一个小型 binary，在项目需要可靠的 AI 设置时运行。

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

## 为什么需要 OpenDock

AI 工作区设置通常会变成一堆一次性 shell 命令、复制来的 prompt 文件、版本漂移，以及记不清的项目约定。OpenDock 把这些变成一个经过审核的 dock：

- **项目级作用域**：安装到当前目录，并写入本地 `.opendock/` state。
- **默认走审核**：远程 dock 必须来自 OpenDock Hub 已批准的 metadata。
- **保护已有文件**：每个文件声明自己的 update policy，例如 managed block、manual review 或 unique-line append。
- **小命令面**：只保留 install、update、diagnose、查看 log、auth 和 deploy。
- **适合自动化**：lifecycle step 可以运行 `git`、`brew`、`winget`、`npm`、`bun`、`pip`、`uv`、`codex`、`claude`、`oma`、`omx` 等允许的命令，但不允许 shell pipeline。

## 快速开始

OpenDock 还没有通过 package manager 发布。请从源码构建：

```bash
bun install
bun run build
bin/opendock.js version
```

在临时项目中试用已审核的 `opendock/codex` dock：

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

安装后，项目会包含：

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## 命令

| 命令 | 用途 |
|---|---|
| `opendock install opendock/codex` | 将已审核 dock 安装到当前目录。 |
| `opendock install opendock/codex@1.5` | 使用 version selector 安装。 |
| `opendock install opendock/codex --platform windows` | 使用显式 target platform，而不是自动检测 host。 |
| `opendock update` | 重新解析已安装 dock，并使用 lock 中的平台安全应用新版本。 |
| `opendock doctor` | 使用 lock 中的平台显示当前目录的 OpenDock state。 |
| `opendock log` | 输出当前项目最近的 OpenDock 运行记录。 |
| `opendock version` | 输出 CLI version、schema version 和 default hub。 |
| `opendock bootstrap mac` | 检查或安装 macOS dock 所需的 Homebrew。 |
| `opendock auth login` | 保存 OpenDock Hub token。 |
| `opendock deploy codex` | 将本地 `dock.yml` dock 提交到 OpenDock Hub 审核。 |

`install` 是公开命令。`deploy` 需要先运行 `opendock auth login`。
如果缺少 Homebrew，请先运行 `opendock bootstrap mac`。

dock reference 支持 npm 风格的 version selector：

```text
owner/name          -> latest
owner/name@latest   -> latest
owner/name@1        -> latest approved 1.x
owner/name@1.5      -> latest approved 1.5.x
owner/name@1.5.2    -> exact approved version
owner/name@v1       -> latest approved 1.x
```

OpenDock 会把用户请求的 selector 和解析出的 exact version 都写入
`.opendock/dock.lock.yml`。`opendock update` 会复用请求的 selector，因此用
`@1.5.2` 安装的 dock 会保持固定，而 `@1.5` 可以在 `1.5.x` 范围内更新。

## Dock 格式

dock 是一个目录，包含 `dock.yml` 文件，以及 `files[].from` 引用的 source 文件。
详见 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) 中的韩语编写指南。

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: files/README.md
    to: README.md
    update: manual_review

  - from: files/.gitignore
    to: .gitignore
    update: append_unique

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0 <25.0.0"
      platforms:
        macos:
          run: brew install node
        windows:
          run: winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements

    - id: install-codex-cli
      check: codex --version
      version: ">=0.0.0"
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  update:
    - id: update-codex-cli
      run: npm install --global @openai/codex@latest

    - id: verify-codex-cli
      run: codex --version
      timeout_ms: 60000

  doctor:
    - id: node
      version: ">=22.0.0 <25.0.0"
      check: node --version

    - id: npm
      version: ">=10.0.0"
      check: npm --version

    - id: codex
      version: ">=0.0.0"
      check: codex --version
      timeout_ms: 60000
```

`from` 路径相对于 dock root。`files/` 只是推荐的示例文件夹名；OpenDock 不要求特殊的 payload 目录。

平台专用 lifecycle 命令仍保持在普通的 top-to-bottom `install`、`update`、`doctor`
顺序内。带有 `platforms` 的 step 保留一个逻辑 `id`，OpenDock 会合并匹配平台的 override：

```yaml
lifecycle:
  install:
    - id: install-bun
      check: bun --version
      version: ">=1.3.0"
      platforms:
        macos:
          run: brew install bun
        windows:
          run: npm install --global bun
```

没有 `platforms` 的 step 会在所有平台运行。选中的平台会保存到
`.opendock/dock.lock.yml`，并由 `opendock update` 和 `opendock doctor` 复用。

交互式 lifecycle step 可以把控制权交给用户，也可以通过 macOS `expect` PTY 发送少量已批准的按键序列：

```yaml
lifecycle:
  install:
    - id: user-driven-tui
      run: codex
      interactive: user

    - id: scripted-tui
      run: codex
      interactive:
        mode: scripted
        inputs:
          - key: tab
          - key: enter
```

## 仓库结构

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Hub dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Hub API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
docs/plans/work/      # implementation plan and verification notes
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## 开发

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

integration test 使用临时目录和生成的本地 dock fixture。`examples/` 下的 dock 是真实的编写示例。

## 当前范围

OpenDock 目前是 MVP CLI。以下内容尚未提供：

- 托管的 OpenDock Hub 审核服务
- package manager 分发
- `https://hub.opendock.app` 的完整 dock catalog UX
- binary release automation

CLI 已经包含 local fixture flow、remote Hub API client boundary、project state、
logging、auth token storage、deploy submission plumbing 和 regression tests。

hosted service 发布后，`https://opendock.app` 是 product site，
`https://hub.opendock.app` 是面向人的 dock catalog，
`https://hub.opendock.app/v1/docks` 是 CLI Hub API root。

## 生态

OpenDock 设计为能自然配合 [Open Design](https://github.com/nexu-io/open-design)、
[OpenCode](https://github.com/anomalyco/opencode) 和
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) 等 agent-native 工具，
让本地项目 workflow 更 portable、inspectable、repeatable。

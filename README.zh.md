<div align="center">

# OpenDock

**让每个工作区都能轻松完成 AI 设置。**

用一条命令安装已审核的 AI 设置包。让开发者和非开发者都能获得简单、可重复、可靠的设置。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock 是一个 Bun-first TypeScript CLI，用于把已审核的 AI 设置包安装到当前项目目录。

第一个 dock 是 `opendock/codex`：它会检查 Node，安装 Codex CLI，并通过 OpenDock state 追踪设置状态。

OpenDock 有意不做终端替代品。它是一个小型 binary，在项目需要简单且可靠的 AI 设置时运行。

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock auth status
opendock auth logout
opendock deploy opendock/codex@1.0.0
```

## 为什么需要 OpenDock

项目中的 AI 设置通常会变成一堆一次性 shell 命令、复制来的 prompt 文件、版本漂移，以及记不清的项目约定。OpenDock 把这些变成一个经过审核的 AI 设置包：

- **项目级作用域**：安装到当前目录，并写入本地 `.opendock/` state。
- **默认走审核**：远程 dock 必须来自 OpenDock Registry 已批准的 metadata。
- **保护已有文件**：每个文件声明自己的 update policy，例如 managed block、manual review 或 unique-line append。
- **小命令面**：只保留 install、update、doctor、查看 log、auth 和 deploy。
- **适合自动化**：lifecycle step 可以运行 `git`、`brew`、`winget`、`npm`、`bun`、`pip`、`uv`、`codex`、`claude`、`oma`、`omx` 等允许的命令，但不允许 shell pipeline。

## 快速开始

本地开发时，请从源码构建 OpenDock：

```bash
bun install
bun run build
bin/opendock version
```

在临时项目中试用已审核的 `opendock/codex` dock：

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock" install opendock/codex@1.0.0
"$repo/bin/opendock" doctor
"$repo/bin/opendock" log
```

安装后，项目会包含：

```text
.opendock/
  dock.lock.yml
  project.yml
```

## 命令

| 命令 | 用途 |
|---|---|
| `opendock install opendock/codex@1.0.0` | 将已审核 dock 安装到当前目录。 |
| `opendock install opendock/codex@designer-build` | 使用精确 version identifier 安装。 |
| `opendock install opendock/codex@1.0.0 --platform windows` | 使用显式 target platform，而不是自动检测 host。 |
| `opendock install opendock/codex@1.0.0 --force` | 在 install 时强制应用 OpenDock 管理的变更。 |
| `opendock update` | 使用 lock 中的平台，将已安装 dock 解析并应用到 Registry 最新已批准 release。 |
| `opendock update --force` | 即使检测到已编辑的 managed file，也强制应用 OpenDock 管理的变更。 |
| `opendock doctor` | 使用 lock 中的平台显示当前目录的 OpenDock state。 |
| `opendock log` | 输出当前项目最近的 OpenDock 运行记录。 |
| `opendock version` | 输出 CLI version、schema version 和 default registry。 |
| `opendock bootstrap mac` | 检查或安装 macOS dock 所需的 Homebrew。 |
| `opendock auth login` | 登录 OpenDock Registry。 |
| `opendock auth status` | 显示当前 OpenDock Registry 登录状态。 |
| `opendock auth logout` | 在本机退出 OpenDock Registry。 |
| `opendock deploy opendock/codex@1.0.0` | 将本地 `dock.yml` dock 提交到 OpenDock Registry 审核。 |

`install` 是公开命令。`deploy` 使用 OpenDock Registry 登录。
可用 `opendock auth status` 或 `opendock auth logout` 查看或清除登录状态。
如果缺少 Homebrew，请先运行 `opendock bootstrap mac`。

dock reference 必须使用精确 version identifier：

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

Install 和 deploy 都需要精确 release identifier，例如
`opendock install owner/name@1.0.0` 和 `opendock deploy owner/name@1.0.0`。

`opendock install owner/name`、`opendock install owner/name@latest`、
`opendock deploy owner/name` 和 `opendock deploy owner/name@latest` 会被拒绝。

OpenDock 会把用户请求的 version identifier 和解析出的 exact version 都写入
`.opendock/dock.lock.yml`。`opendock update` 会向 OpenDock Registry 查询每个已安装
dock 的最新已批准 release，应用该 exact release，并更新 lock file。若要切换到指定
release 而不是最新已批准 release，请运行 `opendock install owner/name@new-version`。

## Dock 格式

dock 是一个目录，包含 `dock.yml` 文件，以及 `files[].from` 引用的 source 文件或目录。
可选的 `readme` 和 `logo` 路径会作为 OpenDock Registry catalog metadata 提交；
除非也列在 `files` 中，否则不会安装到项目里。release version 不写在 `dock.yml`
里；版本来自 `opendock deploy owner/name@version` 这个 deploy reference。Deploy 会把
`dock.yml` 以及 `files[].from`、lifecycle `copy.from` 的 install payloads 打包成用于
review 的 `.tgz` submission archive。`readme` 和 `logo` 只作为 catalog metadata 提交，
除非它们也被列为 install payloads。详见 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md)
中的韩语编写指南。

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup without project file payloads.
readme: DOCK.md
logo: logo.png

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0"
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
      version: ">=22.0.0"
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

目录 source 会递归展开。`managed_file` 只有在当前文件 hash 与 OpenDock 上次应用的 hash
一致时才会替换或删除文件。检测到已编辑的 managed file 时，install/update 会在文件变更和
lifecycle 命令之前停止。`--force` 会覆盖或删除这些 managed file。

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

## 仓库结构

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Registry dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Registry API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI-only example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
  designer-ai/        # AI workspace for product designers
  product-manager/    # AI workspace for PM artifacts
  frontend-ai/        # AI workspace for frontend engineering
  startup-founder/    # AI workspace for founder strategy
  ai-automation/      # AI workspace for automation planning
  ui-case-study/      # AI workspace for UI portfolio case studies
  agent-ready/        # shared AI agent instruction files
  ai-context/         # repository context packaging setup
  mcp-local/          # project-local MCP config examples
  agent-safety/       # PR/security safety rails
  agent-docs/         # AI-readable docs harness
  agent-rules/        # path-scoped AI agent rules
  repo-context/       # repository context prompts and packaging
  mcp-safe/           # security-first MCP references
  dev-env/            # tool versions and validation tasks
  codex-skills/       # repository-local Codex skills
  devcontainer-ai/    # AI-friendly Dev Container setup
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

## 生态

OpenDock 设计为能自然配合 [Open Design](https://github.com/nexu-io/open-design)、
[OpenCode](https://github.com/anomalyco/opencode) 和
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) 等 agent-native 工具，
让本地项目 workflow 更 portable、inspectable、repeatable。

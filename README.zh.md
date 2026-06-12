<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

选择你需要的 dock，按自己的方式组合它们，让每个项目保持 AI-ready。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock 帮你快速准备 AI-ready workspace。

不必在每个项目里手动复制 prompts、创建配置文件、安装工具并重复同样的步骤。
你只需要安装一个 **dock**。

dock 是一个可直接使用的 AI workspace package。你可以安装一个 dock，也可以在
同一个项目里组合多个 dock。

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## OpenDock 解决什么问题

AI setup 一开始很简单：复制几个 prompts，添加几个文件，安装一个工具。

但时间久了，每个项目的设置都会变得不一样。你会很难记住添加过哪些文件、安装过
哪些工具，以及哪些内容需要更新。

OpenDock 把这些 setup 变成可以管理的 dock。

- 选择你需要的 AI workspace setup。
- 在一个项目中组合多个 dock。
- 之后更新已安装的 dock。
- 移除不再需要的 dock。
- 追踪 OpenDock 添加过的内容。
- 避免默默覆盖你自己的修改。

OpenDock 不是 terminal replacement，也不是通用 script runner。它是用来安装和
管理可重复 AI workspace setup 的小工具。

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | 已批准的 dock metadata 和 release archives. |
| **Project scope** | 当前 workspace | installed dock list, lock, logs, project metadata. |
| **Dock scope** | 单个 installed dock | version, checksum, managed file records, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 后应用到 project root 的文件. |
| **System/tool scope** | host tools | 由 `requires` 准备的 runtime，以及允许的 install/update/doctor tasks 安装的 Homebrew、npm、Bun、pip、winget 等 host tools. |

## Install

```bash
bun install -g opendock
opendock version
```

如果 macOS dock 需要 Homebrew，而系统还没有 Homebrew，请先 bootstrap：

```bash
opendock bootstrap mac
```

如果 Windows dock 需要 WinGet，而系统还没有 WinGet，请先 bootstrap：

```bash
opendock bootstrap windows
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | 将 approved dock release 安装到当前目录. |
| `opendock list` | 显示当前项目已安装的 docks. |
| `opendock update` | 将 installed docks 移动到最新 approved Registry release. |
| `opendock update --force` | 即使 managed content 被本地修改，也以 dock version 为准. |
| `opendock uninstall owner/name` | 移除一个 dock 及其 managed project files. |
| `opendock doctor` | 检查 project state 和 dock doctor steps. |
| `opendock log` | 显示当前项目最近的 OpenDock runs. |
| `opendock version` | 显示 CLI, schema 和 Registry information. |
| `opendock bootstrap mac` | 在 macOS 上检查或安装 Homebrew. |
| `opendock bootstrap windows` | 在 Windows 上检查 WinGet 或打开 Microsoft App Installer. |
| `opendock auth login` | 为 deploy 登录 Registry. |
| `opendock auth status` | 显示当前 Registry login. |
| `opendock auth logout` | 清除本地 Registry login. |
| `opendock deploy owner/name@1.0.0` | 提交 local dock release 供 Registry review. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | 提交特定平台的 release artifact。 |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | 提交特定平台的 release artifact。 |

dock reference 必须包含 exact version identifier。

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

## Dock Format

```yaml
opendock: 1
id: owner/name
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md

install:
  - id: git-init
    check: git status
    run: git init -b main

update: []

doctor:
  - id: git
    check: git --version
    version: ">=2.40.0"
```

`readme` 和 `logo` 是 Registry catalog metadata。如果要安装到项目中，需要同时
写入 `files`。

如果 dock-private workdir 中运行的 task 需要先读取输入文件，请使用
`workdir.files`。需要写入 project root 的文件使用 `files`。

## Example Docks

Workspace examples 不是空的示例，而是可以直接使用的 payload。它们会安装
`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、本地 `README.md`，以及
`.agents/skills/`、`.codex/skills/`、`.claude/skills/`、`.cursor/rules/`
下的 provider-specific skill/rule files。安装后，Codex、Claude Code、
Gemini 类 agent、Cursor 和 OMA-style skill discovery 可以读取同一份项目
context。

Tool docks 包括 `codex`、`claude-code`、`oma`。Outcome docks 包括
`designer-ai`、`product-manager`、`frontend-ai` 等角色 workspace。Utility
docks 包括 `agent-ready`、`agent-safety`、`repo-context` 等可组合 harness。

完整 manifest reference 见 [docs/guides/guide.zh.md](./docs/guides/guide.zh.md)。

## Development

```bash
bun install
bun run check
bun run build
```

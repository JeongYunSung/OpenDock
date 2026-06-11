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

OpenDock 是一个 Bun-first TypeScript CLI，用来在当前 workspace 中选择并组合
已审核的 AI 设置包，也就是 **dock**。

dock 可以添加 agent instructions、prompt libraries、project harnesses、安全的
lifecycle commands，以及外部工具生成的输出。OpenDock 会追踪它应用过的内容，
因此之后可以 update、doctor 或 uninstall。

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## OpenDock 解决什么问题

AI setup 很容易散落成 global tools、复制来的 prompts、隐藏 config、README
片段、shell commands 和不同 vendor 的 agent folders。

OpenDock 把这些变成可以选择、组合、更新和移除的 versioned unit。

- **Outcome-first docks**：安装可直接工作的 workspace，而不只是安装工具。
- **Composable setup**：一个项目可以安装多个 dock，并分别追踪。
- **Reviewed distribution**：remote install 通过 OpenDock Registry resolve。
- **Project-local tracking**：每个 workspace 拥有自己的 `.opendock/` state。
- **Independent updates**：每个 dock 拥有独立的 version、files、checksum 和 private workdir。
- **Safe root writes**：写入 project root 前先检查 conflict。
- **Controlled commands**：执行 allowlist 中的 lifecycle command，而不是 raw shell。

OpenDock 不是 terminal replacement，也不是通用 script runner。它是用于可组合、
可重复 AI workspace setup 的轻量 packaging layer。

## Scopes

| Scope | Owner | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | 已批准的 dock metadata 和 release archives. |
| **Project scope** | 当前 workspace | installed dock list, lock, logs, project metadata. |
| **Dock scope** | 单个 installed dock | version, checksum, managed file records, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 后应用到 project root 的文件. |
| **System/tool scope** | host package managers | Homebrew, npm, Bun, pip, winget 等 host tools. |

## Install

```bash
bun install -g opendock
opendock version
```

如果 macOS dock 需要 Homebrew，而系统还没有 Homebrew，请先 bootstrap：

```bash
opendock bootstrap mac
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | 将 approved dock release 安装到当前目录. |
| `opendock update` | 将 installed docks 移动到最新 approved Registry release. |
| `opendock update --force` | 即使 managed content 被本地修改，也以 dock version 为准. |
| `opendock uninstall owner/name` | 移除一个 dock 及其 managed project files. |
| `opendock doctor` | 检查 project state 和 dock doctor steps. |
| `opendock log` | 显示当前项目最近的 OpenDock runs. |
| `opendock version` | 显示 CLI, schema 和 Registry information. |
| `opendock auth login` | 为 deploy 登录 Registry. |
| `opendock auth status` | 显示当前 Registry login. |
| `opendock auth logout` | 清除本地 Registry login. |
| `opendock deploy owner/name@1.0.0` | 提交 local dock release 供 Registry review. |

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

lifecycle:
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

完整 manifest reference 见 [docs/guides/dock-yml.md](./docs/guides/dock-yml.md)。

## Development

```bash
bun install
bun run check
bun run build
```

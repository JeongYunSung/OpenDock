# OpenDock 指南

`dock.yml` 描述一个 dock 会给项目添加什么：文件、所需工具、install/update/doctor
tasks，以及外部工具生成后需要导出到 project root 的文件。

OpenDock 是一个面向可重复 AI setup 的小型 packaging layer。你可以选择多个
dock，把它们组合到同一个项目，并分别追踪 update 和 uninstall。

Translations:

- [English](./guide.md)
- [한국어](./guide.ko.md)
- [日本語](./guide.ja.md)
- [Español](./guide.es.md)
- [Français](./guide.fr.md)
- [Deutsch](./guide.de.md)

## Package Layout

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
```

`files/` 只是惯例。只要在 `files[].from` 中声明的是安全路径，就可以使用其他目录名。

## Minimal Example

```yaml
opendock: 1
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png
tags:
  - ai-agent
  - starter

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

## Main Fields

| Field | Meaning |
|---|---|
| `opendock` | Manifest version. Current value is `1`. |
| `name` | Catalog 中展示的人类可读名称. |
| `summary` | Registry catalog 的简短说明. |
| `readme` | Catalog detail 使用的 Markdown. |
| `logo` | Catalog logo image. |
| `tags` | 用于 Hub 搜索和筛选的 lowercase catalog labels. |
| `permission` | 精确允许 `run` / `check` 中默认策略之外的命令。 |
| `requires` | Runtime requirements. |
| `files` | 应用到 project root 的文件或目录. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

不要把 release version 写进 `dock.yml`。

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

使用 `opendock <command> --help` 查看某个命令的选项。

```bash
opendock install --help
opendock doctor --help
opendock auth login --help
```

`owner/name` 和 `owner/name@latest` 会被拒绝。请使用明确版本。

安装后，`opendock list` 会显示当前项目已经安装的 docks。
如果其他工具需要读取清单，请使用 `opendock list --json`。
`opendock log` 会显示当前项目的命令历史，状态为 `Success`、`Failure` 或
`Skipped`。

## Files And Ownership

`AGENTS.md` 这类文本文件会以 managed block 的方式写入。配置文件和 binary 文件会通过
checksum 追踪。如果用户修改了 OpenDock 管理的内容，update 会在写入 root 文件前停止。
`--force` 表示明确选择 dock 版本覆盖。
`.codex/`, `.claude/`, `.agents/`, `.github/copilot-instructions.md`, `.github/instructions/` 下面的 agent runtime
文件会保持原样，这样 frontmatter、hook 和 executable bits 都不会失效。

## Host Bootstrap

```bash
opendock bootstrap mac
opendock bootstrap windows
```

macOS 可先检查 Homebrew，Windows 可先检查 WinGet，再执行 dock。

## Tasks

```yaml
install:
  - id: git-init
    check: git status
    run: git init -b main

doctor:
  - id: git
    check: git --version
    version: ">=2.40.0"
```

步骤按顺序执行。`doctor` 应该只检查状态，不修改项目。

## Task Command Permission

OpenDock 不会把 task 的 `run` 和 `check` 直接交给 shell。默认可用命令只包括 `bun`, `bunx`, `git`, `node`, `npm`, `npx`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv`。macOS 额外允许 `brew`，Windows 额外允许 `powershell` 和 `winget`。其他命令，例如 `oma`, `codex`, `claude`, `omx`, `mkdir`，必须在 top-level `permission` 中按完整形式声明。`|`, `&&`, `||`, `;`, backticks, `$(`, `>`, `<` 在 `permission`, `run`, `check` 中都会被拒绝。

```yaml
permission:
  - oma -y install
  - oma link claude codex
  - codex --version
```

## Workdir Files And Export

如果生成器运行前需要输入文件，使用 `workdir.files`。然后使用
`workdir: dock`，只 export 需要 OpenDock 在项目中管理的文件。

```yaml
permission:
  - oma -y install
  - oma link claude codex

workdir:
  files:
    - from: workdir/oma-config.yaml
      to: .agents/oma-config.yaml

install:
  - id: apply-oma
    run: oma -y install
    workdir: dock
  - id: link-oma-vendors
    run: oma link claude codex
    workdir: dock
    export:
      include:
        - AGENTS.md
        - CLAUDE.md
        - .agents/**
        - .codex/**
        - .claude/**
      exclude:
       - "**/*.log"
```

## Example Docks

`examples/` 中的 workspace examples 是可安装的 payload。除 tool dock 外，它们
会一起安装 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`README.md`，以及
`.agents/skills/`、`.codex/skills/`、`.claude/skills/`、`.cursor/rules/`
下的 provider-specific files，让 AI agent 能立刻读取项目 context。

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy 会提交 `dock.yml`、基于 `files[].from` 和 `workdir.files[].from` 生成的
archive、release platform metadata、可选 `readme_markdown`、可选 `logo`，以及
manifest 中可选的 `tags`。

# OpenDock 指南

`dock.yml` 描述一个 dock 会给项目添加什么：文件、所需工具、install/update/doctor
阶段要执行的 command，以及外部工具生成后需要导出到 project root 的文件。

OpenDock 是一个面向 AI workspace setup 的小型 packaging layer。你可以选择多个
dock，把它们组合到同一个 workspace，并分别追踪 update 和 uninstall。

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
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

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
| `id` | `owner/name` 形式的 dock id. |
| `name` | Catalog 中展示的人类可读名称. |
| `summary` | Registry catalog 的简短说明. |
| `readme` | Catalog detail 使用的 Markdown. |
| `logo` | Catalog logo image. |
| `requires` | Runtime 和 package requirement. |
| `files` | 应用到 project root 的文件或目录. |
| `lifecycle` | `install`, `update`, `doctor` commands. |

## Version

不要把 release version 写进 `dock.yml`。

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`owner/name` 和 `owner/name@latest` 会被拒绝。请使用明确版本。

## Files And Ownership

`AGENTS.md` 这类文本文件会以 managed block 的方式写入。配置文件和 binary 文件会通过
checksum 追踪。如果用户修改了 OpenDock 管理的内容，update 会在写入 root 文件前停止。
`--force` 表示明确选择 dock 版本覆盖。

## Lifecycle

```yaml
lifecycle:
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

## Workdir And Export

外部工具会生成文件时，使用 `workdir: dock`，然后只 export 需要 OpenDock 管理的文件。

```yaml
export:
  include:
    - AGENTS.md
    - .codex/**
  exclude:
    - "**/*.log"
```

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
```

Deploy 会提交 `dock.yml`、基于 `files[].from` 生成的 archive、可选
`readme_markdown` 和可选 `logo`。

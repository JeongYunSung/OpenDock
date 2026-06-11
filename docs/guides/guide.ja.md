# OpenDock ガイド

`dock.yml` は、dock がプロジェクトに追加する内容を説明する manifest です。
追加するファイル、必要なツール、install/update/doctor task、
外部ツールが生成した output のうち project root に取り込むものを宣言します。

OpenDock は AI setup を選び、1 つの workspace に組み合わせ、dock ごとに update
と uninstall を追跡するための小さな packaging layer です。

Translations:

- [English](./guide.md)
- [한국어](./guide.ko.md)
- [中文](./guide.zh.md)
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

`files/` は慣例です。`files[].from` に宣言した安全な path であれば別名でも使えます。

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
| `id` | Dock id in `owner/name` form. |
| `name` | Human-readable catalog name. |
| `summary` | Short Registry catalog summary. |
| `readme` | Markdown content for the catalog detail page. |
| `logo` | Catalog logo image. |
| `requires` | Runtime requirements. |
| `files` | Files or directories applied to the project root. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

Release versions are not written in `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`owner/name` and `owner/name@latest` are rejected. Use an exact version.

## Files And Ownership

Text files such as `AGENTS.md` are applied as managed blocks. Config and binary
files are tracked by checksum. If a user edits OpenDock-managed content, update
stops before writing root files. `--force` explicitly chooses the dock version.

## Host Bootstrap

```bash
opendock bootstrap mac
opendock bootstrap windows
```

macOS では Homebrew、Windows では WinGet を dock 実行前に確認できます。

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

Steps run top to bottom. `doctor` should check state and avoid changing the project.

## Workdir And Export

Use `workdir: dock` when an external tool generates files. Export only the files
that should be managed in the project root.

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
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy は `dock.yml`、`files[].from` から作る archive、release platform
metadata、任意の `readme_markdown`、任意の `logo` を送信します。

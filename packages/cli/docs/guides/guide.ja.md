# OpenDock ガイド

`dock.yml` は、dock がプロジェクトに追加する内容を説明する manifest です。
追加するファイル、必要なツール、install/update/doctor task、
外部ツールが生成した output のうち project root に取り込むものを宣言します。

OpenDock は AI setup を選び、1 つのプロジェクトに組み合わせ、dock ごとに update
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
| `name` | Human-readable catalog name. |
| `summary` | Short Registry catalog summary. |
| `readme` | Markdown content for the catalog detail page. |
| `logo` | Catalog logo image. |
| `tags` | Lowercase catalog labels for Hub search and filtering. |
| `permission` | 標準ポリシー外の `run` / `check` command を正確な形で許可します。 |
| `requires` | Runtime requirements. |
| `files` | Files or directories applied to the project root. |
| `commands` | Named helpers or checks for `opendock run`. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Version

Release versions are not written in `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

commandごとのoptionsは `opendock <command> --help` で確認します。

```bash
opendock run --help
opendock auth login --help
opendock help run
```

`owner/name` and `owner/name@latest` are rejected. Use an exact version.

After installation, `opendock list` shows which docks are installed in the
current project.
Use `opendock list --json` when another tool needs to read that inventory.
`opendock log` は project ごとの command history を `Success`、`Failure`、
`Skipped` の status 付きで表示します。

## Files And Ownership

Text files such as `AGENTS.md` are applied as managed blocks. Config and binary
files are tracked by checksum. If a user edits OpenDock-managed content, update
stops before writing root files. `--force` explicitly chooses the dock version.
Agent runtime files under `.codex/`, `.claude/`, `.agents/`, and
`.github/copilot-instructions.md`, `.github/instructions/` stay exact so frontmatter, hooks, and executable bits
remain valid.

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

## Task Command Permission

OpenDock の task は `run` と `check` を shell にそのまま渡しません。標準で使える command は `bun`, `bunx`, `git`, `node`, `npm`, `npx`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv` に限られます。macOS では `brew`、Windows では `powershell` と `winget` も使えます。`oma`, `codex`, `claude`, `omx`, `mkdir` のようなそれ以外の command は top-level `permission` に完全一致する形で宣言します。`|`, `&&`, `||`, `;`, backticks, `$(`, `>`, `<` は `permission`, `run`, `check` で拒否されます。

```yaml
permission:
  - oma -y install
  - oma link claude codex
  - codex --version
```

## Commands

Tasks are run by OpenDock during `install`, `update`, and `doctor`.
`commands` are named helpers or checks that installed docs, skills, workflows, or harnesses can call later with `opendock run`.

```yaml
files:
  - from: files/.opendock/harness/owner__name/check.mjs
    to: .opendock/harness/owner__name/check.mjs

commands:
  check:
    description: Run the dock quality gate.
    file: .opendock/harness/owner__name/check.mjs
    runner: node
```

Installed instructions should call:

```bash
opendock run check --dock owner/name
```

Prefer `opendock run` in installed agent docs so the helper stays tied to the dock that installed it.

Supported runners: `bun`, `node`, `powershell`, `python`, `python3`, `sh`.

## Workdir Files And Export

Use `workdir.files` when a generator needs input files before it runs. Then use
`workdir: dock` and export only the files that should be managed in the project
root.

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

`examples/` の workspace examples は install 可能な payload として扱います。
tool dock 以外は `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`README.md` と、
`.agents/skills/`、`.codex/skills/`、`.claude/skills/`、`.cursor/rules/`
配下の provider-specific files を一緒に入れます。AI agent が project context
をすぐ読める状態を作るためです。

## Deploy

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy は `dock.yml`、`files[].from` と `workdir.files[].from` から作る
archive、release platform metadata、任意の `readme_markdown`、任意の `logo`、
manifest の任意の `tags` を送信します。

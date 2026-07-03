# OpenDock ガイド

`dock.yml` は、dock がプロジェクトに追加する内容を説明する manifest です。
追加するファイル、runtime requirements、project-local tools、コピーした folder 内の
dependencies、install/update/doctor task、外部ツールが生成した output のうち
project root に取り込むものを宣言します。

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
| `permissions` | 標準 command または tools で宣言した command の task 形を完全一致で許可します。 |
| `requires` | Runtime requirements. |
| `tools` | CLI packages installed and tracked under `.opendock/tools/`. |
| `dependencies` | Package dependencies installed inside folders copied by the dock. |
| `files` | Files or directories applied to the project root. |
| `install` | Tasks for first install and initial generation. |
| `update` | Tasks for refresh and maintenance. |
| `doctor` | Health checks that do not modify the project. |

## Dependencies

`dependencies` は、dock が folder を project にコピーし、その folder 自体が
package dependencies を必要とする場合に使います。`tools` は `.opendock/tools/`
配下に command を install しますが、`dependencies` は Codex skill、harness、
helper app などコピー済み payload folder のためのものです。

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"

files:
  - from: image2html
    to: .codex/skills/image2html

dependencies:
  image2html:
    manager: npm
    path: .codex/skills/image2html
    mode: locked
```

OpenDock は先に `files` を適用し、その後 declared `path` で `dependencies` を
install します。update と uninstall では、`node_modules`、`.venv`、
`.opendock/python` など生成された dependency outputs を削除します。

| Manager | Modes |
|---|---|
| `npm` | `install`, `locked` |
| `pnpm` | `install`, `locked` |
| `bun` | `install`, `locked` |
| `uv` | `install`, `locked` |
| `pip`, `pip3` | `requirements.txt` から `install` |

`locked` は manager ごとの lockfile/frozen install を意味します。内部的には
`npm ci`, `pnpm install --frozen-lockfile`,
`bun install --frozen-lockfile`, `uv sync --frozen` を使います。

## Version

Release versions are not written in `dock.yml`.

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

commandごとのoptionsは `opendock <command> --help` で確認します。

```bash
opendock install --help
opendock doctor --help
opendock auth login --help
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

OpenDock の task は `run` と `check` を shell にそのまま渡しません。標準で使える command は `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv` に限られます。Windows では制限付きの `powershell` も使えます。ただし標準 command でも任意の subcommand が許可されるわけではありません。`git status`、`git init -b main`、`test -f <path>`、version check、Windows `Test-Path` のような安全な形だけ通ります。標準ポリシー外の command はまず `tools.commands` に宣言し、その後 `permissions` で task の完全一致形を許可します。`tools.commands` は `git`, `node`, `npm`, `python` など OpenDock 標準 command 名を再利用できません。`|`, `&&`, `||`, `;`, backticks, `$(`, `>`, `<` は `permissions`, `run`, `check` で拒否されます。`npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install`, `winget install` のような package install/update は task では拒否されます。project tool は `tools`、コピーされた project folder 内の package dependencies は `dependencies`、runtime は `requires.runtimes` で扱います。

```yaml
tools:
  oma:
    manager: bun
    package: oh-my-agent
    version: "8.52.9"
    commands:
      - oma

permissions:
  - oma -y install
  - oma link claude codex
```

## Workdir Files And Export

Use `workdir.files` when a generator needs input files before it runs. Then use
`workdir: dock` and export only the files that should be managed in the project
root.

```yaml
tools:
  oma:
    manager: bun
    package: oh-my-agent
    version: "8.52.9"
    commands:
      - oma

permissions:
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

Bundled example は macOS と Windows の manifest を分けています。テストでは manifest parse、file reference、Windows doctor check、現在の command policy を通るかを確認します。

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

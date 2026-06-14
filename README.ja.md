<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

必要な dock を選び、自分のやり方で組み合わせ、すべてのプロジェクトを
AI-ready な workspace に保ちます。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock は、AI-ready workspace をすばやく準備するためのツールです。

プロジェクトごとに prompts をコピーし、設定ファイルを作り、必要なツールを
インストールする作業を繰り返す代わりに、**dock** をインストールします。

dock はすぐ使える AI workspace package です。1つだけ入れることも、同じ
プロジェクトに複数の dock を組み合わせることもできます。

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## OpenDock が解決すること

AI setup は最初は簡単です。prompt をいくつかコピーし、ファイルを追加し、
ツールをインストールすれば始められます。

しかし時間が経つと、プロジェクトごとに設定が違ってきます。どのファイルを追加
したのか、どのツールを入れたのか、何を更新すべきかが分かりにくくなります。

OpenDock はその setup を管理できる dock にまとめます。

- 必要な AI workspace setup を選べます。
- 1つのプロジェクトに複数の dock を組み合わせられます。
- インストール済み dock を後から更新できます。
- 不要になった dock を削除できます。
- OpenDock が追加した内容を追跡します。
- 自分の変更を黙って上書きしません。

OpenDock は terminal replacement でも汎用 script runner でもありません。
再現可能な AI workspace setup をインストールして管理するための小さなツールです。

## Scopes

| Scope | 所有者 | 目的 |
|---|---|---|
| **Registry scope** | OpenDock Registry | 承認済み dock metadata と release archive. |
| **Project scope** | 現在の workspace | installed dock list, lock, log, project metadata. |
| **Dock scope** | 1つの installed dock | version, checksum, managed file record, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 後に project root へ適用される file. |
| **System/tool scope** | host tool | `requires` が準備する runtime と、許可された install/update/doctor task がインストールする Homebrew, npm, Bun, pip, winget などの host tool. |

## Install

```bash
bun install -g opendock
opendock version
```

macOS dock が Homebrew を使う場合、Homebrew がなければ先に bootstrap します。

```bash
opendock bootstrap mac
```

Windows dock が WinGet を使う場合、WinGet がなければ先に bootstrap します。

```bash
opendock bootstrap windows
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | 承認済み dock release を現在の directory に install. |
| `opendock list` | 現在の project に installed docks を表示. |
| `opendock outdated` | installed docks に新しい approved release があるか確認. |
| `opendock update` | installed docks を最新の approved Registry release へ移動. |
| `opendock update --force` | OpenDock-managed content が編集されていても dock version を優先. |
| `opendock uninstall owner/name` | 1つの dock とその managed project files を削除. |
| `opendock doctor` | project state と dock doctor steps を確認. |
| `opendock log` | current project の最近の OpenDock run を表示. |
| `opendock version` | CLI, schema, Registry information を表示. |
| `opendock bootstrap mac` | macOS で Homebrew を確認またはインストール. |
| `opendock bootstrap windows` | Windows で WinGet を確認または Microsoft App Installer を開く. |
| `opendock auth login` | deploy のため Registry に login. |
| `opendock auth status` | 現在の Registry login を表示. |
| `opendock auth logout` | local Registry login を削除. |
| `opendock deploy owner/name@1.0.0` | local dock release を Registry review に提出. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | platform 別の release artifact を提出. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | platform 別の release artifact を提出. |

dock reference には exact version identifier が必要です。

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
tags:
  - starter
  - ai-agent

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

`readme`、`logo`、`tags` は Registry catalog metadata です。Hub で dock を
理解・filter するために使われます。実際に project に install する file は
`files` にも別途宣言します。

dock-private workdir で実行する task が事前に input file を必要とする場合は
`workdir.files` を使います。project root に書き込む file には `files` を使います。

## Example Docks

Workspace examples は空のサンプルではなく、そのまま使える payload です。
`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、local `README.md` に加えて、
`.agents/skills/`、`.codex/skills/`、`.claude/skills/`、`.cursor/rules/`
配下の provider-specific skill/rule files をインストールします。Codex、
Claude Code、Gemini 系 agent、Cursor、OMA-style skill discovery が同じ
project context をすぐ読める状態になります。

Tool docks は `codex`、`claude-code`、`oma` です。Outcome docks は
`designer-ai`、`product-manager`、`frontend-ai` などの役割別 workspace を
追加します。Utility docks は `agent-ready`、`agent-safety`、`repo-context`
などを組み合わせ用の harness として追加します。

Pro addon docks は `<dock>-pro` という名前です。Simple dock は軽く保ち、pro
addon で specialist skills、workflow playbooks、Claude Code subagents、Claude Code
command adapters、Codex custom agents、Cursor rules を追加します。例:
[opendock/designer-ai-pro](https://hub.opendock.app/docks/opendock/designer-ai-pro)。

詳しい manifest reference は [docs/guides/guide.ja.md](./docs/guides/guide.ja.md) を参照してください。

## Development

```bash
bun install
bun run check
bun run build
```

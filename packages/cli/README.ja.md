<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

必要な AI setup を選び、プロジェクトごとに dock を組み合わせ、あとから簡単に
更新または削除できる状態にします。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock は、同じファイルやツール手順を毎回手で作らずに、プロジェクトへ
AI setup を追加するためのツールです。

プロジェクトごとに prompts をコピーし、設定ファイルを作り、必要なツールを
インストールする作業を繰り返す代わりに、**dock** をインストールします。

dock は再利用できる AI setup package です。1つだけ入れることも、同じ
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

- 必要な AI setup を選べます。
- 1つのプロジェクトに複数の dock を組み合わせられます。
- インストール済み dock を後から更新できます。
- 不要になった dock を削除できます。
- OpenDock が追加した内容を追跡します。
- 自分の変更を黙って上書きしません。

OpenDock はターミナルの代替でも、汎用 script runner でもありません。
再現可能な AI setup をインストールして管理するための小さなツールです。

## Scopes

| Scope | 所有者 | 目的 |
|---|---|---|
| **Registry scope** | OpenDock Registry | レビュー済み dock の metadata と version archive. |
| **Project scope** | 現在の project | installed dock list, lock, log, project metadata. |
| **Dock scope** | 1つの installed dock | version, checksum, managed file record, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 後に project root へ適用される file. |
| **Host bootstrap scope** | Your machine | Homebrew や WinGet は `opendock bootstrap` で明示的に準備します. |
| **Tool scope** | Installed dock | `tools` に宣言した CLI package を `.opendock/tools/` に入れ、`.opendock/bin/` から使えるようにします. |
| **Dependency scope** | Installed dock payload | `dependencies` に宣言した package dependencies を、project にコピーされた folder 内へ install し、update/uninstall 時に cleanup します. |

## Install

```bash
bun install -g opendock
opendock version
opendock version --check
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
| `opendock install owner/name@1.0.0` | レビュー済み dock version を現在の directory に install. |
| `opendock list` | 現在の project に入っている dock を表示. |
| `opendock list --json` | installed docks の一覧を machine-readable JSON で出力. |
| `opendock outdated` | installed docks に新しいレビュー済み version があるか確認. |
| `opendock update` | 更新できる dock があるときだけ新しいレビュー済み version を適用. |
| `opendock update --force` | OpenDock-managed content が編集されていても dock version を優先. |
| `opendock uninstall owner/name` | 1つの dock と、その dock が管理する project files を削除. |
| `opendock doctor` | project state と dock の確認 step を実行. |
| `opendock log` | current project の最近の command log を表示. |
| `opendock version` | CLI, schema, Registry 情報を表示. |
| `opendock version --check` | OpenDock の public release channel で新しい CLI/app version を確認. |
| `opendock bootstrap mac` | macOS で Homebrew を確認またはインストール. |
| `opendock bootstrap windows` | Windows で WinGet を確認または Microsoft App Installer を開く. |
| `opendock auth login` | deploy のため Registry に login. |
| `opendock auth status` | 現在の Registry login を表示. |
| `opendock auth logout` | local Registry login を削除. |
| `opendock deploy owner/name@1.0.0` | local dock version を Registry review に提出. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | macOS 用の version file を提出. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Windows 用の version file を提出. |
| `opendock <command> --help` | 特定commandのoptionsと使い方を表示. |

dock reference には正確な version が必要です。

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

## Dock Format

```yaml
opendock: 1
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

## Dependencies

`dependencies` は、dock が project に folder をコピーし、その folder 自体が
package dependencies を必要とする場合に使います。skill folder、harness、小さな
helper app など、installed project tree 内に残る payload 向けです。

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
    mode: ci
```

現在の supported managers は `npm`, `pnpm`, `bun`, `uv`, `pip`, `pip3` です。
OpenDock は任意の install command を実行しません。`npm` は `ci` と `install`、
`pnpm` と `bun` は `install`、`uv` は `sync`、`pip` と `pip3` は
`requirements.txt` からの `install` を扱います。

dock-private workdir で実行する task が事前に input file を必要とする場合は
`workdir.files` を使います。project root に書き込む file には `files` を使います。

## Task Command Permission

OpenDock の task は `run` と `check` を小さな標準ポリシーで実行します。標準 command は `bun`, `git`, `node`, `npm`, `pip`, `pip3`, `pipx`, `pnpm`, `python`, `python3`, `test`, `uv` です。Windows では制限付きの `powershell` も許可します。ただし標準 command でも任意の subcommand が許可されるわけではありません。`git status`、`git init -b main`、`test -f <path>`、version check、Windows `Test-Path` のような安全な形だけ通ります。`oma`, `codex`, `claude`, `omx` などの command は `tools.commands` に宣言された場合だけ、`permissions` で実行形を開けます。`tools.commands` は `git`, `node`, `npm`, `python` など OpenDock 標準 command 名を再利用できません。`mkdir` のように OpenDock 標準でも `tools.commands` でもない command は拒否されます。`|`, `&&`, `||`, `;`, backticks, `$(`, `>`, `<` は `permissions`, `run`, `check` で拒否されます。`npm install`, `bun add`, `pnpm update`, `pip install`, `pipx install`, `uv tool install`, `brew install`, `winget install` のような package install/update は task では拒否されます。project tool は `tools`、コピーされた project folder 内の dependencies は `dependencies`、Bun/Node/npm/Python/pip runtime は `requires.runtimes`、host package manager は bootstrap で扱います。

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

## Example Docks

Example dock は組み合わせて使いやすいように用意されています。多くの dock は
`AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、local `README.md` に加えて、
`.agents/skills/`、`.codex/skills/`、`.claude/skills/`、`.cursor/rules/`
配下の tool-specific skill/rule files をインストールします。Codex、Claude
Code、Gemini 系 agent、Cursor、OMA-style skill discovery が同じ project
context をすぐ読める状態になります。

Tool docks は `codex`、`claude-code`、`oma` です。Outcome docks は
`designer-ai`、`product-manager`、`frontend-ai` などの役割別 workspace を
追加します。Utility docks は `agent-ready`、`agent-safety`、`repo-context`
などを組み合わせ用の harness として追加します。

Bundled example はすべて macOS と Windows の manifest を分けています。テストでは manifest parse、file reference、Windows doctor check、現在の command policy を通るかを確認します。

詳しい manifest reference は [docs/guides/guide.ja.md](./docs/guides/guide.ja.md) を参照してください。

## Development

```bash
bun install
bun run check
bun run build
```

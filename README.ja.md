<div align="center">

# OpenDock

**AI ワークスペースのための承認済み dock。**

信頼できるプロジェクト設定を 1 つのコマンドでインストールします。コマンド面は小さく、
設定は再現可能に、生成されたすべてのファイルは監査可能に保ちます。

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock は、承認済み dock を現在のプロジェクトディレクトリへ
インストールする Bun-first TypeScript CLI です。

最初の dock は `opendock/codex` です。Node を確認し、Codex CLI を
インストールし、レビュー可能なプロジェクトファイルを適用し、その設定を
OpenDock state で追跡します。

OpenDock はターミナルの代替ではありません。プロジェクトに信頼できる AI
設定が必要なときに実行する小さなバイナリです。

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

## OpenDock を使う理由

AI ワークスペースの設定は、一度きりの shell コマンド、コピーされた prompt
ファイル、version drift、半分だけ覚えているプロジェクト規約の寄せ集めになりがちです。
OpenDock はそれをレビュー済みの dock に変えます。

- **プロジェクト単位**: 現在のディレクトリにインストールし、ローカルの
  `.opendock/` state を書き込みます。
- **承認を前提にした設計**: リモート dock は OpenDock Registry で承認された
  metadata から取得される必要があります。
- **既存ファイルに安全**: 各ファイルは managed block、manual review、
  unique-line append などの update policy を宣言します。
- **小さなコマンド面**: install、update、diagnose、log 確認、auth、deploy に
  絞ります。
- **自動化対応**: lifecycle step は shell pipeline を許可せず、`git`,
  `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, `oma`, `omx`
  などの許可済みコマンドを実行できます。

## クイックスタート

OpenDock はまだ package manager では公開されていません。ソースからビルドしてください。

```bash
bun install
bun run build
bin/opendock.js version
```

承認済みの `opendock/codex` dock を一時プロジェクトで試します。

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

インストール後、プロジェクトには次の項目が含まれます。

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## コマンド

| コマンド | 目的 |
|---|---|
| `opendock install opendock/codex@1.0.0` | 承認済み dock を現在のディレクトリにインストールします。 |
| `opendock install opendock/codex@designer-build` | exact version identifier を使ってインストールします。 |
| `opendock install opendock/codex@1.0.0 --platform windows` | host の自動検出ではなく明示した target platform でインストールします。 |
| `opendock install opendock/codex@1.0.0 --force` | install 中に OpenDock managed changes を強制適用します。 |
| `opendock update` | インストール済み dock を再 resolve し、lock 済み platform で安全に新しい version を適用します。 |
| `opendock update --force` | 編集済み managed file があっても OpenDock managed changes を強制適用します。 |
| `opendock doctor` | 現在のディレクトリの OpenDock state を lock 済み platform で表示します。 |
| `opendock log` | 現在のプロジェクトの最近の OpenDock 実行を出力します。 |
| `opendock version` | CLI version、schema version、default registry を表示します。 |
| `opendock bootstrap mac` | macOS dock 用に Homebrew を確認またはインストールします。 |
| `opendock auth login` | OpenDock Registry にログインします。 |
| `opendock auth status` | 現在の OpenDock Registry login を表示します。 |
| `opendock auth logout` | このマシンで OpenDock Registry からログアウトします。 |
| `opendock deploy opendock/codex@1.0.0` | ローカルの `dock.yml` dock を OpenDock Registry review に提出します。 |

`install` は公開コマンドです。`deploy` は OpenDock Registry login を使用します。
状態確認や解除には `opendock auth status`、`opendock auth logout` を使ってください。
Homebrew がない場合は、先に `opendock bootstrap mac` を実行してください。

dock reference は exact version identifier を必須にします。

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

Install と deploy はどちらも exact release identifier が必要です。例:
`opendock install owner/name@1.0.0`、`opendock deploy owner/name@1.0.0`。

OpenDock は、要求された version identifier と resolve された exact version の両方を
`.opendock/dock.lock.yml` に保存します。`opendock update` は要求された
version identifier を再利用するため、`@1.5.2` でインストールした dock は固定され、
別の release に移動するには `opendock install owner/name@new-version` を実行します。

## Dock Format

dock は `dock.yml` ファイルと、`files[].from` で参照される source ファイルまたは
ディレクトリを含むディレクトリです。任意の `readme` と `logo` パスは
OpenDock Registry の catalog metadata として提出され、`files` にも宣言しない限り
インストールされません。詳細は [docs/guides/dock-yml.md](./docs/guides/dock-yml.md)
の韓国語 authoring guide を参照してください。

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup with managed workspace files.
readme: DOCK.md
logo: logo.png

files:
  - from: files/.agents
    to: .agents
    update: managed_file

  - from: files/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: files/README.md
    to: README.md
    update: manual_review

  - from: files/.gitignore
    to: .gitignore
    update: append_unique

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0 <25.0.0"
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
      version: ">=22.0.0 <25.0.0"
      check: node --version

    - id: npm
      version: ">=10.0.0"
      check: npm --version

    - id: codex
      version: ">=0.0.0"
      check: codex --version
      timeout_ms: 60000
```

`from` path は dock root からの相対 path です。`files/` は推奨例としての
フォルダ名であり、OpenDock は特別な payload directory を要求しません。

directory source は再帰的に展開されます。`managed_file` は現在の hash が最後に
OpenDock が適用した hash と一致する場合だけファイルを置換または削除します。編集済み
managed file がある場合、install/update は file changes や lifecycle commands の前に停止します。
`--force` はその managed file を上書きまたは削除します。

platform 固有の lifecycle コマンドは、通常の top-to-bottom の `install`,
`update`, `doctor` 順序の中に残ります。`platforms` を持つ step は 1 つの
論理的な `id` を保ち、OpenDock が該当 platform の override を merge します。

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

`platforms` がない step はすべての platform で実行されます。選択された platform は
`.opendock/dock.lock.yml` に保存され、`opendock update` と `opendock doctor`
で再利用されます。

対話型 lifecycle step は、ユーザーに直接操作させるか、macOS の `expect` PTY を
通じて承認済みの小さな key sequence を送信できます。

```yaml
lifecycle:
  install:
    - id: user-driven-tui
      run: codex
      interactive: user

    - id: scripted-tui
      run: codex
      interactive:
        mode: scripted
        inputs:
          - key: tab
          - key: enter
```

## リポジトリ構成

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
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## 開発

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

integration test は一時ディレクトリと生成された local dock fixture を使います。
`examples/` の dock は実際の authoring examples です。


## エコシステム

OpenDock は [Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode),
[oh-my-agent](https://github.com/first-fluke/oh-my-agent) のような
agent-native tool と自然に連携するよう設計されています。ローカルプロジェクトの
workflow をより portable、inspectable、repeatable にします。

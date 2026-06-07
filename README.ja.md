<div align="center">

# OpenDock

**AI ワークスペースのための承認済みスターターパック CLI。**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock は、承認済みスターターパックを現在のプロジェクトディレクトリへ
適用する Bun-first TypeScript CLI です。最初のパックは
`opendock/oma-codex` で、
Codex を使うデザイナー向けに Git と `README.md`、`DESIGN.md`、
`AGENTS.md`、`.gitignore` などのハーネスファイルを準備します。

## クイックスタート

```bash
bun install
bun run build
bin/opendock.js version
```

```bash
repo=$PWD
project=$(mktemp -d)

cd "$project"
export OPENDOCK_DATA_DIR="$project/.opendock-data"

"$repo/bin/opendock.js" install opendock/oma-codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## コマンド

| Command | Purpose |
|---|---|
| `opendock install opendock/oma-codex` | 現在のディレクトリにスターターパックをインストールします。 |
| `opendock install opendock/oma-codex --platform windows` | 自動検出の代わりに明示した platform でインストールします。 |
| `opendock update` | lock に記録された platform でインストール済みパックを安全に更新します。 |
| `opendock doctor` | lock に記録された platform で OpenDock の状態を診断します。 |
| `opendock log` | 現在のプロジェクトの実行ログを表示します。 |
| `opendock version` | CLI、schema、registry 情報を表示します。 |
| `opendock bootstrap mac` | macOS 用スターターパックのために Homebrew を確認またはインストールします。 |
| `opendock auth login` | OpenDock Registry トークンを保存します。 |
| `opendock deploy oma-codex` | ローカルの `dock.yml` を OpenDock Registry のレビュー用に提出します。 |

Platform 別の lifecycle コマンドは、step 内の `platforms` で定義します。選択された platform は `.opendock/dock.lock.yml` に保存され、`update` と `doctor` で再利用されます。

## 安全性

OpenDock は `owner/name` 形式の dock reference、固定レジストリ
`https://registry.opendock.app`、OpenDock Registry の承認・署名・checksum 検証、既存ファイルへの
managed block 追記、allowlist ベースの setup コマンド実行を採用しています。
dock source と registry host は実行時の環境変数では変更できません。shell pipeline
や redirect は許可されません。

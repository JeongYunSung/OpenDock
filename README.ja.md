<div align="center">

# OpenDock

**AI ワークスペースのための承認済みスターターパック CLI。**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock は、承認済みスターターパックを現在のプロジェクトディレクトリへ
適用する Bun-first TypeScript CLI です。最初のパックは
`opendock/codex-designer` で、
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
export OPENDOCK_PACKS_DIR="$repo/examples"
export OPENDOCK_DATA_DIR="$project/.opendock-data"

"$repo/bin/opendock.js" install opendock/codex-designer
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## コマンド

| Command | Purpose |
|---|---|
| `opendock install opendock/codex-designer` | 現在のディレクトリにスターターパックをインストールします。 |
| `opendock update` | インストール済みパックを安全に更新します。 |
| `opendock doctor` | OpenDock の状態を診断します。 |
| `opendock log` | 現在のプロジェクトの実行ログを表示します。 |
| `opendock version` | CLI、schema、registry 情報を表示します。 |
| `opendock auth login` | DockHub トークンを保存します。 |
| `opendock deploy codex-designer` | ローカルの `dock.yml` をレビュー用に提出します。 |

## 安全性

OpenDock は `owner/name` 形式の pack reference、DockHub の承認・署名・
checksum 検証、既存ファイルへの managed block 追記、allowlist ベースの setup
コマンド実行を採用しています。shell pipeline や redirect は許可されません。

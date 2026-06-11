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

OpenDock は、承認済みの AI setup pack である **dock** を現在の workspace で
選び、組み合わせるための Bun-first TypeScript CLI です。

dock は agent instruction、prompt library、project harness、安全な lifecycle
command、外部ツールが生成した出力をプロジェクトに適用できます。OpenDock は
適用した内容を追跡するため、後から update、doctor、uninstall ができます。

```bash
opendock install opendock/codex@1.0.0
opendock update
opendock doctor
opendock uninstall opendock/codex
```

## OpenDock が解決すること

AI setup は、global tool、コピーした prompt、隠れた config、README snippet、
shell command、vendor ごとの agent folder に散らばりがちです。

OpenDock はそれを、選び、組み合わせ、更新し、削除できる versioned unit に
変えます。

- **Outcome-first docks**: 単なる tool ではなく、すぐ使える workspace をセットアップします。
- **Composable setup**: 1つのプロジェクトに複数の dock を入れ、それぞれを独立して追跡します。
- **Reviewed distribution**: remote install は OpenDock Registry から解決されます。
- **Project-local tracking**: 各 workspace が自分の `.opendock/` state を持ちます。
- **Independent updates**: 各 dock は version、files、checksum、private workdir を個別に持ちます。
- **Safe root writes**: project root を書き込む前に conflict を検査します。
- **Controlled commands**: raw shell ではなく allowlist された lifecycle command を実行します。

OpenDock は terminal replacement ではありません。汎用 script runner でもありません。
組み合わせ可能で再現可能な AI workspace setup のための小さな packaging layer です。

## Scopes

| Scope | 所有者 | 目的 |
|---|---|---|
| **Registry scope** | OpenDock Registry | 承認済み dock metadata と release archive. |
| **Project scope** | 現在の workspace | installed dock list, lock, log, project metadata. |
| **Dock scope** | 1つの installed dock | version, checksum, managed file record, private workdir. |
| **Root output scope** | OpenDock file engine | preflight 後に project root へ適用される file. |
| **System/tool scope** | host package manager | `requires` または許可された lifecycle command が準備する Homebrew, npm, Bun, pip, winget などの host tool. |

## Install

```bash
bun install -g opendock
opendock version
```

macOS dock が Homebrew を使う場合、Homebrew がなければ先に bootstrap します。

```bash
opendock bootstrap mac
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | 承認済み dock release を現在の directory に install. |
| `opendock update` | installed docks を最新の approved Registry release へ移動. |
| `opendock update --force` | OpenDock-managed content が編集されていても dock version を優先. |
| `opendock uninstall owner/name` | 1つの dock とその managed project files を削除. |
| `opendock doctor` | project state と dock doctor steps を確認. |
| `opendock log` | current project の最近の OpenDock run を表示. |
| `opendock version` | CLI, schema, Registry information を表示. |
| `opendock auth login` | deploy のため Registry に login. |
| `opendock auth status` | 現在の Registry login を表示. |
| `opendock auth logout` | local Registry login を削除. |
| `opendock deploy owner/name@1.0.0` | local dock release を Registry review に提出. |

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

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md

lifecycle:
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

`readme` と `logo` は Registry catalog metadata です。project に install するには
`files` にも別途宣言します。

詳しい manifest reference は [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) を参照してください。

## Development

```bash
bun install
bun run check
bun run build
```

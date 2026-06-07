<div align="center">

# OpenDock

**面向 AI 工作区的已审核 starterpack CLI。**

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

</div>

---

OpenDock 是一个 Bun-first TypeScript CLI，用来把经过审核的 starterpack
安装到当前项目目录。
首个示例包是 `opendock/oma-codex`，用于为设计师准备 Codex 项目：Git、
`README.md`、`DESIGN.md`、`AGENTS.md`、`.gitignore` 等项目工作文件。

## 快速开始

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

"$repo/bin/opendock.js" install opendock/oma-codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

## 命令

| Command | Purpose |
|---|---|
| `opendock install opendock/oma-codex` | 安装 starterpack 到当前目录。 |
| `opendock update` | 安全更新已安装的 starterpack。 |
| `opendock doctor` | 检查项目的 OpenDock 状态。 |
| `opendock log` | 查看当前项目最近的 OpenDock 日志。 |
| `opendock version` | 输出 CLI、schema 和 registry 信息。 |
| `opendock auth login` | 保存 DockHub token。 |
| `opendock deploy oma-codex` | 提交本地 `dock.yml` 进入审核流程。 |

## 安全模型

OpenDock 只接受 `owner/name` 形式的 pack reference。远程 pack 需要通过 DockHub
批准、签名和 checksum 校验。已有文件不会被直接覆盖，而是写入 OpenDock
managed block。setup 命令使用 allowlist，并拒绝 pipe、redirect、`&&`、`||`
等 shell 操作符。

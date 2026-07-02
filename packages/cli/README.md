<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

Choose ready-made AI setups, combine docks for each project, and keep them easy
to update or remove.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock helps you add AI setup to a project without rebuilding the same files
and tool steps by hand.

Instead of manually copying prompts, creating config files, installing tools,
and repeating the same setup for every project, you install a **dock**.

A dock is a reusable AI setup package. You can install one dock or combine
several docks in the same project.

```bash
opendock install opendock/codex@1.0.0
opendock list
opendock update
opendock doctor
opendock doctor opendock/codex
opendock uninstall opendock/codex
```

## Contents

- [What OpenDock Solves](#what-opendock-solves)
- [How It Works](#how-it-works)
- [Scopes](#scopes)
- [Install](#install)
- [Command Reference](#command-reference)
- [Dock Format](#dock-format)
- [File Ownership](#file-ownership)
- [Workdir Files And Export](#workdir-files-and-export)
- [Example Docks](#example-docks)
- [Registry And Deploy](#registry-and-deploy)
- [Repository Layout](#repository-layout)
- [Development](#development)

## What OpenDock Solves

AI setup is easy at first. You copy a few prompts, add a few files, install a
tool, and move on.

Over time, every project starts to look different. It becomes hard to remember
which files were added, which tools were installed, and what needs to be updated.

OpenDock turns that setup into a dock you can manage:

- Choose the AI setup you need.
- Combine multiple docks in one project.
- Update installed docks later.
- Remove docks you no longer need.
- Keep track of what OpenDock added.
- Avoid silently overwriting your own work.

OpenDock is not a terminal replacement or a general script runner. It is a small
tool for installing and managing repeatable AI setup.

## How It Works

Install a dock into the project you are working on.

```bash
opendock install opendock/designer-ai@1.0.0
```

OpenDock then:

1. Downloads a reviewed dock from the Registry.
2. Checks the runtimes the dock needs.
3. Prepares declared CLI tools inside the project.
4. Adds the dock's files to your project.
5. Checks for conflicts before writing files.
6. Records what was installed in `.opendock/`.

That record lets OpenDock update or remove the dock later.

```bash
opendock list
opendock update
opendock uninstall opendock/designer-ai
```

If you changed a file that OpenDock manages, OpenDock stops before overwriting
it. Use `--force` only when you intentionally want the dock version to win.

## Scopes

OpenDock separates responsibilities into explicit scopes.

| Scope | Owned by | Purpose |
|---|---|---|
| **Registry scope** | OpenDock Registry | Approved dock metadata and release archives. |
| **Project scope** | Current workspace | Installed dock list, lock state, logs, and project-level OpenDock metadata. |
| **Dock scope** | One installed dock | Version, checksum, managed file records, and private workdir. |
| **Root output scope** | OpenDock file engine | Files applied into the project root after preflight checks. |
| **Host bootstrap scope** | Your machine | First-party package managers such as Homebrew or WinGet, prepared explicitly with `opendock bootstrap`. |
| **Runtime scope** | Your user account | Node, npm, Python, pip, Bun, and Git requirements, prepared or registered by version under `~/.opendock/runtimes/` and exposed to each project through `.opendock/bin/`. |
| **Tool scope** | Installed dock | CLI packages declared in `tools`, installed under `.opendock/tools/` and exposed through `.opendock/bin/`. |

The practical rule is simple: OpenDock can fully track project files it applies,
but it cannot claim ownership of the whole machine. Host package managers are
handled by bootstrap. Runtime installs and wrappers are shared from your home
`.opendock` directory, while dock tools, project files, and dock workdirs are
tracked in the project `.opendock/`.

## Install

OpenDock is distributed as an npm package and can be installed with Bun or npm.

```bash
bun install -g opendock
opendock version
opendock version --check
```

For macOS docks that use Homebrew, bootstrap the host once if Homebrew is not
already available.

```bash
opendock bootstrap mac
```

For Windows docks that use WinGet, bootstrap the host once if WinGet is not
available. OpenDock verifies `winget` and can open Microsoft App Installer when
it is missing.

```bash
opendock bootstrap windows
```

For local development:

```bash
bun install
bun run build
bin/opendock version
```

## Command Reference

| Command | Purpose |
|---|---|
| `opendock install owner/name@1.0.0` | Install a reviewed dock release into the current directory. |
| `opendock list` | Show docks installed in the current project. |
| `opendock list --json` | Print a machine-readable installed dock inventory. |
| `opendock outdated` | Check whether installed docks have newer reviewed versions. |
| `opendock update` | Apply newer reviewed versions when installed docks have updates. |
| `opendock update --force` | Update even when OpenDock-managed content was edited locally. |
| `opendock uninstall owner/name` | Remove one installed dock and the project files it manages. |
| `opendock install/update/uninstall --json` | Print a machine-readable change report. |
| `opendock doctor` | Check the project state and every installed dock's check steps. |
| `opendock doctor owner/name` | Check only one installed dock. |
| `opendock log` | Show recent command history for the current project. |
| `opendock version` | Print CLI, schema, and Registry details. |
| `opendock version --check` | Check OpenDock's public release channel for a newer CLI/app version. |
| `opendock bootstrap mac` | Verify or install Homebrew on macOS. |
| `opendock bootstrap windows` | Verify WinGet or open Microsoft App Installer on Windows. |
| `opendock auth login` | Log in to OpenDock Registry for deploy. |
| `opendock auth status` | Show the current Registry login. |
| `opendock auth logout` | Clear local Registry login. |
| `opendock deploy owner/name@1.0.0` | Submit a local dock version for Registry review. |
| `opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml` | Submit a macOS version file. |
| `opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml` | Submit a Windows version file. |
| `opendock <command> --help` | Show options and usage for a specific command. |

Dock references require an exact version.

```text
owner/name                  rejected
owner/name@latest           rejected
owner/name@1.2.0            accepted
owner/name@designer-build   accepted
```

`opendock update` checks the docks already installed in this project and only
applies docks that have newer reviewed versions. To move to a specific release,
run `opendock install owner/name@new-version`.

## Dock Format

A dock is a directory with a manifest, optional catalog metadata, and optional
payload files.

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
```

Minimal `dock.yml`:

```yaml
opendock: 1
summary: Short catalog summary.
readme: DOCK.md
logo: logo.png
tags:
  - starter
  - ai-agent

files:
  - from: files/AGENTS.md
    to: AGENTS.md

requires:
  runtimes:
    git: ">=2.40.0"

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

Use `tools` for CLI packages that OpenDock should install and track inside the
project:

```yaml
requires:
  runtimes:
    node: ">=22.0.0"
    npm: ">=10.0.0"

tools:
  codex:
    manager: npm
    package: "@openai/codex"
    version: latest
    commands:
      - codex
```

Runtime commands and tool commands are exposed through `.opendock/bin` while
OpenDock runs install, update, and doctor steps. Docks should not use global
or local package install/update commands such as `npm install ...`,
`bun add ...`, `pip install ...`, or `brew install ...`; declare project-local
`tools` instead.

`readme`, `logo`, and `tags` are Registry catalog metadata. They help people
understand and filter a dock in Hub, but they are not installed into a project
unless the referenced files are also listed in `files`.

Dock names and release versions are not declared in `dock.yml`; they come from
the install or deploy reference:

```bash
opendock deploy owner/name@1.0.0
```

For the full manifest reference, see [docs/guides/guide.md](./docs/guides/guide.md).

## Task Command Permission

OpenDock tasks do not run arbitrary shell. A small default command set is
available for common setup checks and project-local tool work:

```text
bun
git
node
npm
pip
pip3
pipx
pnpm
python
python3
test
uv
```

Platform-specific defaults:

| Platform | Commands |
|---|---|
| `macos` | `brew` |
| `windows` | `powershell`, `winget` |
| `linux` | none |

Anything outside that default set must first be declared under `tools.commands`.
`permissions` can then allow exact task command shapes for that declared tool.
`permissions` can also allow exact non-standard shapes for OpenDock default
commands. Commands declared by `tools` automatically allow simple version checks
such as `codex --version`. Tool command names cannot reuse OpenDock default
commands such as `git`, `node`, `npm`, or `python`.

Package install/update commands are rejected inside tasks. Use `tools` for
project-local tools, `requires.runtimes` for Bun/Node/npm/Python/pip runtime
requirements, and bootstrap for host package managers.

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

`permissions` is exact. `oma -y install` does not allow `oma install` or
`oma -y update`. A non-default command such as `oma` is rejected unless it is
declared in `tools.commands`. Shell operators such as `|`, `&&`, `||`, `;`,
backticks, `$(`, `>`, and `<` are rejected in `run`, `check`, and
`permissions`. Package install/update commands are rejected in tasks; use
`tools` instead.

## File Ownership

OpenDock does not ask dock authors to choose per-file update policies. The file
engine chooses the ownership mode from the target file type.

### Text Managed Blocks

Markdown, text, and common root instruction files are applied as marked blocks.

```md
<!-- OPENDOCK:START id=files:AGENTS.md dock=owner/name path=AGENTS.md -->
...
<!-- OPENDOCK:END id=files:AGENTS.md dock=owner/name path=AGENTS.md -->
```

This lets an existing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, or
`DESIGN.md` keep user-written content outside the OpenDock block.

Agent runtime files under paths such as `.codex/`, `.claude/`, `.agents/`,
`.github/copilot-instructions.md`, and `.github/instructions/` are not
block-wrapped. They are managed as whole files so skill frontmatter, hook
scripts, and executable permissions stay valid.

### Checksum Managed Files

Files that cannot safely contain marker comments are managed as whole files by
checksum. If a user edits a managed file, update and uninstall stop by default.
Use `--force` only when the dock version should win.

## Workdir Files And Export

Tasks can run in the project root or in a dock-private workdir.
Use `requires` for runtime prerequisites, `tools` for CLI package installs, and
top-level `install`, `update`, and `doctor` for project actions and generated
outputs.
Use `workdir.files` when a generator needs input files before a task runs.

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
        - "**/cache/**"
```

- `workdir: root` runs in the project root.
- `workdir: dock` runs in `.opendock/workdirs/<dock>/`.
- Non-default task commands such as `oma -y install` must use a command declared
  in `tools.commands` and must be listed exactly in top-level `permissions`.
- `workdir.files` copies dock archive files into the private dock workdir before
  tasks run.
- `export.include/exclude` selects generated files from the dock workdir.
- Exported files are applied through the same managed block/checksum engine.

This lets OpenDock cooperate with external tools such as `oma`, `omx`, or other
AI setup generators, while still requiring the manifest to name the exact
task steps and exported files that reach the project root.

## Example Docks

The examples are built to be combined.
Most docks add shared project context (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
and a local `README.md`) plus tool-specific skill/rule files under
`.agents/skills/`, `.codex/skills/`, `.claude/skills/`, and `.cursor/rules/`.
After install, Codex, Claude Code, Gemini-style agents, Cursor, and OMA-style
skill discovery can read the same project context.

| Group | Examples | Role |
|---|---|---|
| Tool docks | `codex`, `claude-code`, `oma` | Install or run an AI tool without forcing a role workflow. |
| Outcome docks | `designer-ai`, `product-manager`, `frontend-ai`, `backend-ai`, `mobile-ai`, `qa-engineer`, `docs-ai`, `data-analyst`, `startup-founder`, `marketer-ai`, `customer-support`, `recruiter-ai`, `ai-automation`, `ui-case-study` | Add role-specific setup files, prompts, and agent instructions. |
| Utility docks | `agent-ready`, `agent-safety`, `repo-context`, `mcp-safe`, `dev-env`, `devops-ai`, `monorepo-ai` | Add reusable context, safety, MCP, validation, operations, or repository harnesses. |

Example combination:

```bash
opendock install opendock/codex@1.0.0
opendock install opendock/agent-ready@1.0.0
opendock install opendock/frontend-ai@1.0.0
opendock install opendock/repo-context@1.0.0
opendock list
```

## Registry And Deploy

OpenDock uses two public surfaces:

| Surface | Purpose |
|---|---|
| `https://hub.opendock.app` | Human-facing dock catalog. |
| `https://registry.opendock.app` | CLI Registry API and release downloads. |

Install is public, but installable remote docks must be approved by OpenDock
Registry. Deploy requires login.

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Windows release manifests should use constrained PowerShell `Test-Path` doctor
checks instead of Unix `test -f` commands.

Deploy uploads:

- `dock.yml`
- the archive built from `dock.yml`, `files[].from`, and `workdir.files[].from`
- release platform metadata: `macos`, `windows`, or `linux`
- optional `readme` markdown for the catalog
- optional `logo` image for the catalog
- optional `tags` from the manifest for catalog search and filtering

The catalog metadata is submitted separately from the install archive.
When `--file` points to `dock.macos.yml`, OpenDock stores it inside the archive
as `dock.yml` so install still reads the normal manifest name.

## Repository Layout

```text
src/
  cli.ts                    # Commander CLI boundary
  auth.ts                   # Local Registry token storage
  registry.ts               # OpenDock Registry API client
  resolver.ts               # Registry archive download and validation
  bootstrap.ts              # First-party host bootstrap helpers
  core/
    app/                    # Install, update, uninstall orchestration
    domain/                 # Manifest and project state models
    files/                  # Managed blocks, checksums, path handling, file plans
    runtime/                # Task runner, command policy, and allowlist
tests/
  cli-flow.test.ts          # Integration-style temp-dir tests
examples/
  */dock.macos.yml          # macOS example release manifests
  */dock.windows.yml        # Windows example release manifests
docs/
  guides/guide*.md          # Manifest authoring guides
```

## Development

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Use `bun run check` before committing.

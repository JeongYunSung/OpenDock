# OpenDock Guide

`dock.yml` describes what a dock adds to a project: files, required tools,
install/update/doctor tasks, generated outputs, post-install commands, and
health checks.

OpenDock is a small packaging layer for repeatable AI setup. Pick the docks you
need, combine them in one project, and keep each dock independently tracked for
update and uninstall.

Translations:

- [한국어](./guide.ko.md)
- [日本語](./guide.ja.md)
- [中文](./guide.zh.md)
- [Español](./guide.es.md)
- [Français](./guide.fr.md)
- [Deutsch](./guide.de.md)

## Before You Write A Dock

Decide these first:

1. **Outcome**: a tool-only dock, or a ready-to-use AI setup for a role or workflow.
2. **Root files**: files the project should actually read, such as `AGENTS.md`, `.codex/`, `.agents/`, `DESIGN.md`, or `README.md`.
3. **Task location**: run tasks in the project root, or in a private dock workdir and export selected outputs.
4. **Required runtimes**: commands such as Git, Node, Bun, npm, pip, or Python that the dock needs before tasks run.
5. **CLI tools**: packages such as Codex, Claude Code, or OMA that OpenDock should install and track project-locally.
6. **Maintenance**: what should happen during update, doctor, and uninstall.

Good docks are outcome-first. A tool-only dock such as `opendock/codex` is valid,
but the most useful docks also provide structure, prompts, agent instructions,
and checks that let someone start working immediately.

## Package Layout

Recommended layout:

```text
my-dock/
  dock.yml
  DOCK.md
  logo.png
  files/
    AGENTS.md
    DESIGN.md
```

`files/` is only a convention. Any safe path can be used as long as it is
declared in `files[].from`.

```yaml
files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

`readme`, `logo`, and `tags` are Registry catalog metadata. `readme` and `logo`
files are not installed into a project unless they are also listed in `files`.

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

This applies `files/AGENTS.md` to `AGENTS.md` in the target project. Common root
instruction files are written as managed blocks, so existing user content can
stay outside the OpenDock block.

## Top-Level Fields

| Field | Required | Meaning |
|---|---:|---|
| `opendock` | yes | Manifest version. Current value: `1`. |
| `name` | no | Human-readable catalog name. |
| `summary` | no | Short Registry catalog summary. |
| `readme` | no | Markdown file submitted as catalog detail content. |
| `logo` | no | Catalog logo image path. |
| `tags` | no | Lowercase catalog labels for Hub search and filtering. |
| `permissions` | no | Exact non-default task commands allowed in `run` and `check`. |
| `requires` | no | Runtime requirements prepared before tasks run. |
| `tools` | no | CLI packages installed and tracked under `.opendock/tools/`. |
| `workdir` | no | Files that prepare the private dock workdir before tasks run. |
| `files` | no | File or directory mappings applied to the project root. |
| `install` | no | Tasks for first install and initial generation. |
| `update` | no | Tasks for refresh and maintenance. |
| `doctor` | no | Health checks that do not modify the project. |

## Dock Reference

Do not put a dock id or release version in `dock.yml`. The dock identity and
version come from the OpenDock command reference.

Use exact versions when running OpenDock:

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

`install`, `update`, and `uninstall` also accept `--json` when another tool
needs a machine-readable change report.

Use `opendock <command> --help` to see the options for one command. For example:

```bash
opendock install --help
opendock doctor --help
opendock auth login --help
```

Use `opendock outdated` to check installed docks before updating. `opendock
update` only runs when at least one installed dock has a newer approved Registry
release.

Use `opendock version --check` to check whether OpenDock's public release channel has a newer
OpenDock CLI/app version. This is separate from dock updates.

Accepted references:

```text
owner/name@1.2.0
owner/name@designer-build
```

Rejected references:

```text
owner/name
owner/name@latest
owner/name/extra@1.0.0
```

## Catalog Metadata

```yaml
name: Designer AI
summary: AI setup for UI, UX, and product design.
readme: DOCK.md
logo: logo.png
tags:
  - design
  - ux
  - figma
```

Rules:

- `readme` and `logo` must be safe relative paths inside the dock directory.
- Absolute paths and `../` traversal are rejected.
- `readme` and `logo` are submitted separately from the install archive.
- `readme` must be Markdown and is limited to 65536 bytes.
- `logo` must be PNG, JPEG, or WebP and is limited to 524288 bytes.
- `tags` are lowercase slugs such as `design` or `ai-agent`, up to 12 tags per
  dock.
- `tags` are catalog labels only. They do not change install, update, uninstall,
  or doctor behavior.

## Requires

`requires` declares the runtimes this dock needs. OpenDock checks them before
`install`, `update`, and `doctor`, then prepares project-local command shims
under `.opendock/toolchains/` and `.opendock/bin/`. Dock tasks no longer install
runtimes globally.

```yaml
requires:
  runtimes:
    bun: ">=1.3.0"
    node: ">=22.0.0"
```

Behavior:

1. Runtime checks run before `install`, `update`, and `doctor`.
2. Runtime commands are exposed through the project-local `.opendock/bin` path.
3. Missing or out-of-range runtimes stop the dock run with a clear error.
4. `doctor` checks state only. It does not install or modify runtimes.

## Tools

Use `tools` for CLI packages that should be installed, tracked, updated, and
removed with the dock. Tools are installed project-locally under
`.opendock/tools/`, and their declared commands are exposed through
`.opendock/bin/`.

```yaml
tools:
  oma:
    manager: bun
    package: oh-my-agent
    version: latest
    commands:
      - oma
      - oh-my-agent
```

Use `tools` instead of task commands such as `npm install --global ...`,
`bun install --global ...`, `pipx install ...`, or `uv tool install ...`.
OpenDock rejects those global install shapes even when they appear in
`permissions`.

## Task Command Permission

OpenDock does not pass task strings to a shell. It splits each `run` and `check`
command, rejects shell operators, then checks the command against a small
default policy. This default set is intentionally limited to common runtimes,
package managers, and simple checks:

```text
bun
bunx
git
node
npm
npx
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

Commands outside this default policy must be declared in top-level
`permissions` with the exact shape OpenDock should allow. Commands declared by
`tools` automatically allow simple version checks such as `codex --version`.

```yaml
permissions:
  - oma -y install
  - oma link claude codex
  - codex --version
```

`permissions` is exact. `oma -y install` does not allow `oma install`,
`oma -y update`, or another `oma` command. Shell operators are still rejected in
`permissions`, `run`, and `check`: `|`, `&&`, `||`, `;`, backticks, `$(`, `>`,
and `<`.

Use `permissions` for app-specific CLIs such as `oma`, `omx`, `hermes`, or any
project-specific helper. Use `tools` for installing CLI packages; do not hide
global installs inside task steps.

## Host Bootstrap

Some platform package managers have to exist before a dock can use them.
OpenDock keeps those first-party host bootstrap actions explicit.

```bash
opendock bootstrap mac
opendock bootstrap windows
```

- `opendock bootstrap mac` verifies Homebrew or runs the official Homebrew installer.
- `opendock bootstrap windows` verifies WinGet or opens Microsoft App Installer when WinGet is missing.

Do not hide Homebrew or WinGet installation inside a dock task unless the dock has
a very specific reason. The bootstrap step makes the host prerequisite clear
before normal dock install/update runs.

## Files

```yaml
files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

Text files are usually applied as managed blocks. Agent runtime files under
paths such as `.codex/`, `.claude/`, `.agents/`,
`.github/copilot-instructions.md`, and `.github/instructions/` are tracked as
whole files so skill frontmatter, workflow files, and executable permissions stay
valid. Binary files and structured config files are also tracked by checksum. If
a user edits OpenDock-managed content, OpenDock stops before writing root files.
`--force` means the dock version wins.

## Tasks

```yaml
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

Tasks run top to bottom. `check` makes a step idempotent. `doctor` should report
state and avoid changing the project.

## Workdir Files And Export

Use `workdir: dock` when an external tool generates files. OpenDock runs the
step in the private dock workdir and exports only declared outputs. Use
`workdir.files` when that tool needs input files before it runs.

```yaml
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

This lets OpenDock track generated files for update and uninstall instead of
leaving unmanaged files in the project root.

`files` and `workdir.files` have different targets:

| Field | Target | Timing |
|---|---|---|
| `files` | Project root | Applied after task exports pass preflight. |
| `workdir.files` | `.opendock/workdirs/<dock>/` | Copied before install/update tasks run. |
| `export` | Project root | Collected after a dock workdir task runs. |

## Production-Ready Example Payloads

Workspace examples in `examples/` are meant to be installable docks, not toy
fixtures. Each non-tool workspace dock installs:

- shared root context: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`
- OMA-style skill source: `.agents/skills/opendock-*/SKILL.md`
- Codex skill source: `.codex/skills/opendock-*/SKILL.md`
- Claude Code skill source: `.claude/skills/opendock-*/SKILL.md`
- Cursor rule source: `.cursor/rules/opendock-*.mdc`

Use the tool docks (`opendock/codex`, `opendock/claude-code`, `opendock/oma`)
when you only need an AI tool. Use outcome and utility docks when you want a
ready project context that an agent can read immediately.

## Platforms

Prefer separate platform artifacts instead of putting platform branches inside
one manifest. The command reference keeps the dock id and version the same,
while each release artifact targets one platform.

```bash
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
opendock deploy owner/name@1.0.0 --platform linux --file dock.linux.yml
```

If `--platform` is omitted, OpenDock uses the current host OS. A manifest name
such as `dock.macos.yml`, `dock.windows.yml`, or `dock.linux.yml` is also used as
a platform hint during deploy.

Example docks in this repository use explicit `dock.macos.yml` and
`dock.windows.yml` files so they can be deployed directly as platform-specific
artifacts.

Windows doctor checks should use the constrained PowerShell `Test-Path` shape
instead of Unix `test -f`.

Install stays simple:

```bash
opendock install owner/name@1.0.0
opendock install owner/name@1.0.0 --platform windows
opendock list
```

Without `--platform`, OpenDock detects the host OS and asks the Registry for the
matching artifact. With `--platform`, OpenDock asks for that specific platform.

`opendock list` reads the current project's `.opendock/dock.lock.yml` and shows
the installed docks, their versions, platforms, and managed file counts. It does
not contact the Registry or modify files.

Use `opendock list --json` when another tool needs the installed dock inventory.

OpenDock records command logs per project with `Success`, `Failure`, or
`Skipped` status. `opendock log` shows the most recent entries for the current
directory.

## Deploy

Deploy requires login and an exact version when running `opendock deploy`.

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
```

Deploy submits:

1. `dock.yml`.
2. A `.tgz` archive built from `dock.yml`, `files[].from`, and
   `workdir.files[].from`.
3. The target platform: `macos`, `windows`, or `linux`.
4. Optional `readme_markdown`.
5. Optional `logo`.
6. Optional manifest `tags` for catalog search and filtering.

`readme`, `logo`, and `tags` are catalog metadata. `readme` and `logo` files are
not included in the install archive unless they are also listed in `files`.

When `--file` points to a platform-specific manifest such as `dock.macos.yml`,
OpenDock still stores it inside the archive as `dock.yml`. Install always reads a
normal `dock.yml` from the downloaded artifact.

## Checklist

Manifest:

1. `opendock: 1` is present.
2. The dock id and release version are in the OpenDock command reference, not in
   `dock.yml`.
3. `readme` and `logo` point to real files inside the dock directory.
4. Non-default `run` and `check` commands are declared exactly in `permissions`.

Files:

1. Every `files[].from` and `workdir.files[].from` exists.
2. Every `files[].to` is a safe relative path.
3. Root text files behave as managed blocks, while agent runtime files stay exact.
4. Config or binary files are protected by checksum conflicts.

Tasks:

1. Repeatable steps have `check`.
2. Important tool checks include `version`.
3. Long-running tasks use `timeout_ms`.
4. Task commands avoid shell operators and stay as one command per step.
5. External generators use `workdir: dock` and `export`.

Release:

1. Test install in a clean project.
2. Test install in an existing project.
3. Test update after user edits managed content.
4. Test `--force`.
5. Test uninstall.
6. Run `opendock list`.
7. Run `opendock doctor`, or `opendock doctor owner/name` when you only want to
   check one installed dock.
8. If OS behavior differs, deploy and test each platform artifact separately.

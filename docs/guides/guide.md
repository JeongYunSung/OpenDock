# OpenDock Guide

`dock.yml` describes what a dock adds to a project: files, required tools,
install, update, and doctor commands, generated outputs, and health checks.

OpenDock is a small packaging layer for AI workspace setup. Pick the docks you
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

1. **Outcome**: a tool-only dock, or a ready-to-use AI workspace for a role or workflow.
2. **Root files**: files the project should actually read, such as `AGENTS.md`, `.codex/`, `.agents/`, `DESIGN.md`, or `README.md`.
3. **Command location**: run commands in the project root, or in a private dock workdir and export selected outputs.
4. **Required tools**: runtime and package requirements such as Git, Node, Bun, npm, or OMA.
5. **Maintenance**: what should happen during update, doctor, and uninstall.

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

`readme` and `logo` are Registry catalog metadata. They are not installed into a
project unless they are also listed in `files`.

## Minimal Example

```yaml
opendock: 1
id: opendock/agent-ready
summary: Shared instruction files for AI coding agents.
readme: DOCK.md
logo: logo.png

requires:
  runtimes:
    git: ">=2.40.0"

files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

This applies `files/AGENTS.md` to `AGENTS.md` in the target project. Markdown and
common instruction files are written as managed blocks, so existing user content
can stay outside the OpenDock block.

## Top-Level Fields

| Field | Required | Meaning |
|---|---:|---|
| `opendock` | yes | Manifest version. Current value: `1`. |
| `id` | yes | Dock id in `owner/name` form. |
| `name` | no | Human-readable catalog name. |
| `summary` | no | Short Registry catalog summary. |
| `readme` | no | Markdown file submitted as catalog detail content. |
| `logo` | no | Catalog logo image path. |
| `requires` | no | Runtime and package requirements prepared before commands run. |
| `files` | no | File or directory mappings applied to the project root. |
| `install` | no | Commands for first install and initial generation. |
| `update` | no | Commands for refresh and maintenance. |
| `doctor` | no | Health checks that do not modify the project. |

## Id And Version

Do not put a release version in `dock.yml`.

```yaml
id: opendock/codex
```

Use exact versions in commands:

```bash
opendock install opendock/codex@1.0.0
opendock deploy opendock/codex@1.0.0
```

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
summary: AI workspace for UI, UX, and product design.
readme: DOCK.md
logo: logo.png
```

Rules:

- `readme` and `logo` must be safe relative paths inside the dock directory.
- Absolute paths and `../` traversal are rejected.
- `readme` and `logo` are submitted separately from the install archive.
- `readme` must be Markdown and is limited to 65536 bytes.
- `logo` must be PNG, JPEG, or WebP and is limited to 524288 bytes.

## Requires

`requires` prepares host tools before `install`, `update`, and `doctor` run.

```yaml
requires:
  runtimes:
    bun: ">=1.3.0"

  packages:
    oma:
      manager: bun
      name: oh-my-agent
      version: ">=8.43.0"
```

Behavior:

1. Runtime and package checks run before `install`, `update`, and `doctor`.
2. `install` prepares missing or outdated requirements when OpenDock knows how.
3. `update` reruns package installers so the dock can refresh tool packages.
4. `doctor` checks state only. It does not install or modify tools.

## Files

```yaml
files:
  - from: files/AGENTS.md
    to: AGENTS.md
```

Text files are usually applied as managed blocks. Binary files and structured
config files are tracked by checksum. If a user edits OpenDock-managed content,
OpenDock stops before writing root files. `--force` means the dock version wins.

## Commands

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

Steps run top to bottom. `check` makes a step idempotent. `doctor` should report
state and avoid changing the project.

## Workdir And Export

Use `workdir: dock` when an external tool generates files. OpenDock runs the
command in the private dock workdir and exports only declared outputs.

```yaml
install:
  - id: apply-oma
    run: oma -y install
    workdir: dock
    export:
      include:
        - AGENTS.md
        - CLAUDE.md
        - .agents/**
        - .codex/**
      exclude:
        - "**/*.log"
        - "**/cache/**"
```

This lets OpenDock track generated files for update and uninstall instead of
leaving unmanaged files in the project root.

## Platforms

Prefer separate platform artifacts instead of putting platform branches inside
one manifest. The dock id and version stay the same, while each release artifact
targets one platform.

```bash
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
opendock deploy owner/name@1.0.0 --platform windows --file dock.windows.yml
opendock deploy owner/name@1.0.0 --platform linux --file dock.linux.yml
```

Platform-neutral docks can omit `--platform`, which submits the artifact as
`any`.

Install stays simple:

```bash
opendock install owner/name@1.0.0
opendock install owner/name@1.0.0 --platform windows
```

Without `--platform`, OpenDock detects the host OS and asks the Registry for the
matching artifact. With `--platform`, OpenDock asks for that specific platform.

## Deploy

Deploy requires login and an exact version in the command.

```bash
opendock auth login
opendock deploy owner/name@1.0.0
opendock deploy owner/name@1.0.0 --platform macos --file dock.macos.yml
```

Deploy submits:

1. `dock.yml`.
2. A `.tgz` archive built from `dock.yml` and `files[].from`.
3. The target platform: `any`, `macos`, `windows`, or `linux`.
4. Optional `readme_markdown`.
5. Optional `logo`.

`readme` and `logo` are catalog metadata, so they are not included in the install
archive unless they are also listed in `files`.

When `--file` points to a platform-specific manifest such as `dock.macos.yml`,
OpenDock still stores it inside the archive as `dock.yml`. Install always reads a
normal `dock.yml` from the downloaded artifact.

## Checklist

Manifest:

1. `opendock: 1` is present.
2. `id` is in `owner/name` form.
3. The release version is in the command, not in `dock.yml`.
4. `readme` and `logo` point to real files inside the dock directory.

Files:

1. Every `files[].from` exists.
2. Every `files[].to` is a safe relative path.
3. Text files behave as managed blocks.
4. Config or binary files are protected by checksum conflicts.

Commands:

1. Repeatable steps have `check`.
2. Important tool checks include `version`.
3. Long-running commands use `timeout_ms`.
4. External generators use `workdir: dock` and `export`.

Release:

1. Test install in a clean project.
2. Test install in an existing project.
3. Test update after user edits managed content.
4. Test `--force`.
5. Test uninstall.
6. Run `opendock doctor`.
7. If OS behavior differs, deploy and test each platform artifact separately.

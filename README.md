<div align="center">

# OpenDock

**Approved docks for AI workspaces.**

Install the project setup you trust with one command. Keep the command surface
small, the setup repeatable, and every generated file auditable.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock is a Bun-first TypeScript CLI for installing approved docks into
the current project directory.

The first dock is `opendock/codex`: a general Codex setup dock that verifies Node,
installs the Codex CLI, applies reviewable project files, and keeps the setup
tracked through OpenDock state.

OpenDock is intentionally not a terminal replacement. It is the small binary you
run when a project needs a known-good AI setup.

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

## Why OpenDock

AI workspace setup is usually a pile of one-off shell commands, copied prompt
files, version drift, and half-remembered project conventions. OpenDock turns
that into a reviewed dock:

- **Project-scoped**: installs into the current directory and writes local
  `.opendock/` state.
- **Approved by design**: remote docks must come from metadata approved by
  OpenDock Hub.
- **Safe with existing files**: each file declares its own update policy, such
  as managed blocks, manual review, or unique-line append.
- **Small command surface**: install, update, diagnose, inspect logs, auth, and
  deploy.
- **Automation-ready**: lifecycle steps can run allowed commands such as `git`,
  `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, and `oma`
  without allowing shell pipelines.

## Quick Start

OpenDock is not published through a package manager yet. Build it from source:

```bash
bun install
bun run build
bin/opendock.js version
```

Try the approved `opendock/codex` dock in a temporary project:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/codex
"$repo/bin/opendock.js" doctor
"$repo/bin/opendock.js" log
```

After install, the project contains:

```text
.opendock/
  dock.lock.yml
  project.yml
AGENTS.md
DESIGN.md
README.md
.gitignore
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install opendock/codex` | Install an approved dock into the current directory. |
| `opendock install opendock/codex@1.5` | Install using a version selector. |
| `opendock install opendock/codex --platform windows` | Install using an explicit target platform instead of auto-detecting the host. |
| `opendock update` | Re-resolve installed docks and apply newer versions safely using the locked platform. |
| `opendock doctor` | Show whether the current directory has valid OpenDock state using the locked platform. |
| `opendock log` | Print recent OpenDock runs for the current project. |
| `opendock version` | Print CLI version, schema version, and default hub. |
| `opendock bootstrap mac` | Verify or install Homebrew for macOS docks. |
| `opendock auth login` | Store an OpenDock Hub token for authenticated commands. |
| `opendock deploy codex` | Submit a local `dock.yml` dock for OpenDock Hub review. |

`install` is public. `deploy` requires `opendock auth login`.
Run `opendock bootstrap mac` first when Homebrew is missing.

Dock references support npm-style version selectors:

```text
owner/name          -> latest
owner/name@latest   -> latest
owner/name@1        -> latest approved 1.x
owner/name@1.5      -> latest approved 1.5.x
owner/name@1.5.2    -> exact approved version
owner/name@v1       -> latest approved 1.x
```

OpenDock stores both the requested selector and the resolved exact version in
`.opendock/dock.lock.yml`. `opendock update` reuses the requested selector, so
an install pinned to `@1.5.2` stays pinned while `@1.5` can move within `1.5.x`.

## Dock Format

A dock is a directory with a `dock.yml` file and any source files referenced by
`files[].from`.
See [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) for the detailed
Korean authoring guide.

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
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

`from` paths are relative to the dock root. `files/` is only the recommended
example folder name; OpenDock does not require a special payload directory.

Platform-specific lifecycle commands stay inside the normal top-to-bottom
`install`, `update`, and `doctor` order. A step with `platforms` keeps one
logical `id`, then OpenDock merges the matching platform override:

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

Steps without `platforms` run on every platform. The selected platform is stored
in `.opendock/dock.lock.yml`, then reused by `opendock update` and
`opendock doctor`.

Interactive lifecycle steps can either hand control to the user or send a small
approved key sequence through a macOS `expect` PTY:

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

## Repository Layout

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update dock file application
  resolver.ts         # local and OpenDock Hub dock resolution
  runner.ts           # lifecycle command runner
  registry.ts         # OpenDock Hub API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  git/                # Git install/init example
  codex/              # Codex CLI + project files example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
docs/plans/work/      # implementation plan and verification notes
docs/guides/
  dock-yml.md         # detailed Korean dock.yml authoring guide
```

## Development

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

The integration tests use temporary directories and generated local dock
fixtures. The `examples/` docks are real authoring examples.

## Current Scope

OpenDock is an MVP CLI. The following are intentionally not shipped yet:

- hosted OpenDock Hub review service
- package-manager distribution
- full dock catalog UX at `https://hub.opendock.app`
- binary release automation

The CLI already has the local fixture flow, remote Hub API client boundary,
project state, logging, auth token storage, deploy submission plumbing, and
regression tests.

When the hosted service ships, `https://opendock.app` is the product site,
`https://hub.opendock.app` is the human dock catalog, and
`https://hub.opendock.app/v1/docks` is the CLI Hub API root.

## Ecosystem

OpenDock is designed to fit naturally beside projects such as
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode), and
[oh-my-agent](https://github.com/first-fluke/oh-my-agent): agent-native tools
that make local project workflows more portable, inspectable, and repeatable.

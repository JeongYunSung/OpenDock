<div align="center">

<img src="./assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

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

The first dock is `opendock/codex`: a minimal Codex setup dock that verifies Node,
installs the Codex CLI, and keeps the setup tracked through OpenDock state.

OpenDock is intentionally not a terminal replacement. It is the small binary you
run when a project needs a known-good AI setup.

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

## Why OpenDock

AI workspace setup is usually a pile of one-off shell commands, copied prompt
files, version drift, and half-remembered project conventions. OpenDock turns
that into a reviewed dock:

- **Project-scoped**: installs into the current directory and writes local
  `.opendock/` state.
- **Approved by design**: remote docks must come from metadata approved by
  OpenDock Registry.
- **Safe with existing files**: each file declares its own update policy, such
  as managed blocks, manual review, or unique-line append.
- **Small command surface**: install, update, doctor, inspect logs, auth, and
  deploy.
- **Automation-ready**: lifecycle steps can run allowed commands such as `git`,
  `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, `oma`, and `omx`
  without allowing shell pipelines.

## Quick Start

For local development, build OpenDock from source:

```bash
bun install
bun run build
bin/opendock version
```

Try the approved `opendock/codex` dock in a temporary project:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock" install opendock/codex@1.0.0
"$repo/bin/opendock" doctor
"$repo/bin/opendock" log
```

After install, the project contains:

```text
.opendock/
  dock.lock.yml
  project.yml
```

## Commands

| Command | Purpose |
|---|---|
| `opendock install opendock/codex@1.0.0` | Install an approved dock into the current directory. |
| `opendock install opendock/codex@designer-build` | Install using an exact version identifier. |
| `opendock install opendock/codex@1.0.0 --platform windows` | Install using an explicit target platform instead of auto-detecting the host. |
| `opendock install opendock/codex@1.0.0 --force` | Force OpenDock-managed file changes during install. |
| `opendock update` | Resolve installed docks to the latest approved Registry release using the locked platform. |
| `opendock update --force` | Force OpenDock-managed file changes even when edited managed files are detected. |
| `opendock doctor` | Show whether the current directory has valid OpenDock state using the locked platform. |
| `opendock log` | Print recent OpenDock runs for the current project. |
| `opendock version` | Print CLI version, schema version, and default registry. |
| `opendock bootstrap mac` | Verify or install Homebrew for macOS docks. |
| `opendock auth login` | Log in to OpenDock Registry. |
| `opendock auth status` | Show the current OpenDock Registry login. |
| `opendock auth logout` | Log out of OpenDock Registry on this machine. |
| `opendock deploy opendock/codex@1.0.0` | Submit a local dock release for OpenDock Registry review. |

`install` is public. `deploy` uses OpenDock Registry login; use
`opendock auth status` or `opendock auth logout` to inspect or clear it.
Run `opendock bootstrap mac` first when Homebrew is missing.

Dock references require an exact version identifier. OpenDock does not sort
versions as semantic versions; the identifier after `@` is matched exactly.

```text
owner/name                  -> rejected
owner/name@latest           -> rejected
owner/name@1.2.0            -> exact approved version identifier
owner/name@designer-build   -> exact approved version identifier
```

Install and deploy both require exact release identifiers:

```bash
opendock install owner/name@1.0.0
opendock deploy owner/name@1.0.0
```

`opendock install owner/name`, `opendock install owner/name@latest`,
`opendock deploy owner/name`, and `opendock deploy owner/name@latest` are
rejected.

OpenDock stores both the requested version identifier and the resolved exact
version in `.opendock/dock.lock.yml`. `opendock update` asks OpenDock Registry
for the latest approved release of each installed dock, applies that exact
release, and records it in the lock file. To move to a specific release instead
of the latest approved release, run `opendock install owner/name@new-version`.

## Dock Format

A dock is a directory with a `dock.yml` file and any source files or directories
referenced by `files[].from`. Optional `readme` and `logo` paths are submitted
to OpenDock Registry as catalog metadata; they are not installed unless also
listed in `files`.
Release versions are not declared in `dock.yml`; the version comes from
`opendock deploy owner/name@version`. Deploy packages `dock.yml` and install
payloads from `files[].from` and lifecycle `copy.from` into a `.tgz` submission
archive for review. `readme` and `logo` are submitted as catalog metadata only
unless they are also listed as install payloads.
See [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) for the detailed
Korean authoring guide.

```yaml
opendock: 1
id: opendock/codex
summary: Codex CLI setup without project file payloads.
readme: DOCK.md
logo: logo.png

lifecycle:
  install:
    - id: git-init
      check: git status
      run: git init -b main

    - id: install-node
      check: node --version
      version: ">=22.0.0"
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
      version: ">=22.0.0"
      check: node --version

    - id: npm
      version: ">=10.0.0"
      check: npm --version

    - id: codex
      version: ">=0.0.0"
      check: codex --version
      timeout_ms: 60000
```

Directory sources are expanded recursively. `managed_file` replaces or deletes a
file only when its current hash matches the last OpenDock-applied hash; edited
managed files stop install/update before file changes or lifecycle commands run.
Use `--force` to overwrite or delete those managed files.

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

## Repository Layout

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
  codex/              # Codex CLI-only example
  oma/                # Oh My Agent dock.yml-only example
  claude-code/        # Claude Code example
  oh-my-codex/        # Oh My Codex example
  oh-my-openagent/    # Oh My OpenAgent Codex Light example
  agent-ready/        # shared AI agent instruction files
  ai-context/         # repository context packaging setup
  mcp-local/          # project-local MCP config examples
  agent-safety/       # PR/security safety rails
  agent-docs/         # AI-readable docs harness
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

## Ecosystem

OpenDock is designed to fit naturally beside projects such as
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode), and
[oh-my-agent](https://github.com/first-fluke/oh-my-agent): agent-native tools
that make local project workflows more portable, inspectable, and repeatable.

<div align="center">

# OpenDock

**Approved starterpacks for AI workspaces.**

Install the project setup you trust with one command. Keep the command surface
small, the setup repeatable, and every generated file auditable.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_%2B_Windows-0f766e)

</div>

---

OpenDock is a Bun-first TypeScript CLI for installing approved starterpacks into
the current project directory.

The first pack is `opendock/oma-codex`: a Codex project starter that prepares
Git, Oh My Agent, and AI workspace harness files such as `README.md`,
`DESIGN.md`, `AGENTS.md`, and `.gitignore`.

OpenDock is intentionally not a terminal replacement. It is the small binary you
run when a project needs a known-good AI setup.

```bash
opendock install opendock/oma-codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy oma-codex
```

## Why OpenDock

AI workspace setup is usually a pile of one-off shell commands, copied prompt
files, version drift, and half-remembered project conventions. OpenDock turns
that into a reviewed starterpack:

- **Project-scoped**: installs into the current directory and writes local
  `.opendock/` state.
- **Approved by design**: remote packs must come from DockHub-approved metadata.
- **Safe with existing files**: each file declares its own update policy, such
  as managed blocks, manual review, or unique-line append.
- **Small command surface**: install, update, diagnose, inspect logs, auth, and
  deploy.
- **Automation-ready**: lifecycle steps can run allowed commands such as `git`,
  `brew`, `winget`, `npm`, `bun`, `pip`, `uv`, `codex`, `claude`, and `omx`
  without allowing shell pipelines.

## Quick Start

OpenDock is not published through a package manager yet. Build it from source:

```bash
bun install
bun run build
bin/opendock.js version
```

Try the approved `opendock/oma-codex` pack in a temporary project:

```bash
repo=$PWD
project=$(mktemp -d)
cd "$project"

"$repo/bin/opendock.js" install opendock/oma-codex
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
| `opendock install opendock/oma-codex` | Install an approved starterpack into the current directory. |
| `opendock install opendock/oma-codex --platform windows` | Install using an explicit target platform instead of auto-detecting the host. |
| `opendock update` | Re-resolve installed packs and apply newer versions safely using the locked platform. |
| `opendock doctor` | Show whether the current directory has valid OpenDock state using the locked platform. |
| `opendock log` | Print recent OpenDock runs for the current project. |
| `opendock version` | Print CLI version, schema version, and default registry. |
| `opendock bootstrap mac` | Verify or install Homebrew for macOS starterpacks. |
| `opendock auth login` | Store a DockHub token for authenticated commands. |
| `opendock deploy oma-codex` | Submit a local `dock.yml` starterpack for DockHub review. |

`install` is public. `deploy` requires `opendock auth login`.
Run `opendock bootstrap mac` first when Homebrew is missing.

## Pack Format

A starterpack is a directory with a `dock.yml` file and optional `templates/`.
See [docs/guides/dock-yml.md](./docs/guides/dock-yml.md) for the detailed
Korean authoring guide.

```yaml
opendock: 1
id: opendock/codex
version: 0.1.0

files:
  - from: templates/DESIGN.md
    to: DESIGN.md
    update: managed_block

  - from: templates/README.md
    to: README.md
    update: manual_review

  - from: templates/.gitignore
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

Template files live under `templates/` and are applied relative to the project
root.

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

## Safety Model

OpenDock treats starterpacks as powerful project setup recipes, so the MVP keeps
the trust boundary explicit:

- Pack references must be in `owner/name` form and cannot contain path traversal.
- Packs are resolved only from the fixed OpenCode registry at `https://opencode.app`.
- Runtime environment variables cannot change the pack source or registry host.
- Remote metadata must be approved, signed, and checksum-matched before unpack.
- Lifecycle commands reject shell operators such as pipes, redirects, `&&`,
  `||`, and command substitution.
- Only allowlisted command families can run during lifecycle steps.
- Platform-specific package managers are target-scoped: `brew` is allowed for
  macOS steps, and `winget` is allowed for Windows steps.
- Homebrew bootstrap is first-party only: starterpacks may use `brew`, but
  installing Homebrew itself is handled by `opendock bootstrap mac` with user
  confirmation.
- `install` and `update` stream allowed command output live, then re-run checks
  to confirm the requested version or state was actually reached.
- `interactive: user` requires a real terminal TTY. `interactive: scripted`
  uses macOS `expect` and is intended only for approved DockHub packs.
- `doctor` lifecycle checks have a default timeout, and individual steps may set
  `timeout_ms`.
- Existing files follow the pack's declared update policy.
- `.gitignore` receives unique appended lines, not repeated blocks.
- Detailed logs are stored in the OpenDock data directory, not in project source.

## Environment Variables

| Variable | Use |
|---|---|
| `OPENDOCK_DATA_DIR` | Override the user data/cache/log directory. |
| `OPENDOCK_AUTH_TOKEN` | Provide a login token non-interactively. |

## Repository Layout

```text
src/
  cli.ts              # commander CLI entrypoint
  installer.ts        # install/update template application
  resolver.ts         # local and DockHub pack resolution
  runner.ts           # lifecycle command allowlist runner
  dockhub.ts          # DockHub API client boundary
tests/
  cli-flow.test.ts    # temp-dir CLI integration tests
examples/
  oma-codex/          # local starterpack fixture
  git/                # Git install/init example
  codex/              # Codex CLI example
  claude-code/        # Claude Code example
  oh-my-codex/        # Codex CLI + Oh My Codex example
  oh-my-openagent/    # Codex CLI + Oh My OpenAgent example
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

The integration tests use temporary directories and generated local pack
fixtures. The `examples/` packs are real starterpack examples.

## Current Scope

OpenDock is an MVP CLI. The following are intentionally not shipped yet:

- hosted DockHub review service
- package-manager distribution
- full pack marketplace UX
- binary release automation

The CLI already has the local fixture flow, remote registry client boundary,
approval/checksum/signature checks, project state, logging, auth token storage,
deploy submission plumbing, and regression tests.

## Ecosystem

OpenDock is designed to fit naturally beside projects such as
[Open Design](https://github.com/nexu-io/open-design),
[OpenCode](https://github.com/anomalyco/opencode), and
[oh-my-agent](https://github.com/first-fluke/oh-my-agent): agent-native tools
that make local project workflows more portable, inspectable, and repeatable.

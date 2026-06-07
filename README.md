<div align="center">

# OpenDock

**Approved starterpacks for AI workspaces.**

Install the project setup you trust with one command. Keep the command surface
small, the setup repeatable, and every generated file auditable.

[English](./README.md) · [한국어](./README.ko.md) · [日本語](./README.ja.md) · [简体中文](./README.zh.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md)

![status](https://img.shields.io/badge/status-MVP-2563eb)
![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![schema](https://img.shields.io/badge/schema-opendock%201-111827)
![platform](https://img.shields.io/badge/platform-macOS_first-0f766e)

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
  `brew`, `npm`, `bun`, `pip`, `uv`, and `oma` without allowing shell pipelines.

## Quick Start

OpenDock is not published through a package manager yet. Build it from source:

```bash
bun install
bun run build
bin/opendock.js version
```

Try the included `opendock/oma-codex` fixture in a temporary project:

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
| `opendock update` | Re-resolve installed packs and apply newer versions safely. |
| `opendock doctor` | Show whether the current directory has valid OpenDock state. |
| `opendock log` | Print recent OpenDock runs for the current project. |
| `opendock version` | Print CLI version, schema version, and default registry. |
| `opendock auth login` | Store a DockHub token for authenticated commands. |
| `opendock deploy oma-codex` | Submit a local `dock.yml` starterpack for DockHub review. |

`install` is public. `deploy` requires `opendock auth login`.

## Pack Format

A starterpack is a directory with a `dock.yml` file and optional `templates/`.

```yaml
opendock: 1
id: opendock/oma-codex
version: 1.2.0

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

    - id: install-bun
      check: bun --version
      version: ">=1.3.0"
      run: brew install bun

    - id: install-oma-cli
      check: oma --version
      version: ">=8.43.0"
      run: bun install --global oh-my-agent@latest

    - id: apply-oma-project
      check: test -f .agents/oma-config.yaml
      run: oma install

    - id: verify-oma
      run: test -f .agents/oma-config.yaml

  update:
    - id: update-oma-cli
      run: bun install --global oh-my-agent@latest

    - id: update-oma-project
      run: oma update -y --vendor codex

    - id: verify-oma
      run: test -f .agents/oma-config.yaml

  doctor:
    - id: oma
      version: ">=8.43.0"
      check: oma --version

    - id: oma-project
      check: test -f .agents/oma-config.yaml
      timeout_ms: 5000
```

Template files live under `templates/` and are applied relative to the project
root.

## Safety Model

OpenDock treats starterpacks as powerful project setup recipes, so the MVP keeps
the trust boundary explicit:

- Pack references must be in `owner/name` form and cannot contain path traversal.
- Local development packs are loaded only when `OPENDOCK_PACKS_DIR` is set.
- Remote packs are resolved from `OPENDOCK_REGISTRY_URL` or `https://opendock.io`.
- Remote metadata must be approved, signed, and checksum-matched before unpack.
- Lifecycle commands reject shell operators such as pipes, redirects, `&&`,
  `||`, and command substitution.
- Only allowlisted command families can run during lifecycle steps.
- `install` and `update` stream allowed command output live, then re-run checks
  to confirm the requested version or state was actually reached.
- `doctor` lifecycle checks have a default timeout, and individual steps may set
  `timeout_ms`.
- Existing files follow the pack's declared update policy.
- `.gitignore` receives unique appended lines, not repeated blocks.
- Detailed logs are stored in the OpenDock data directory, not in project source.

## Environment Variables

| Variable | Use |
|---|---|
| `OPENDOCK_PACKS_DIR` | Resolve starterpacks from a local fixture directory. |
| `OPENDOCK_DATA_DIR` | Override the user data/cache/log directory. |
| `OPENDOCK_REGISTRY_URL` | Point remote registry calls at another DockHub-compatible API. |
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
docs/plans/work/      # implementation plan and verification notes
```

## Development

```bash
bun run typecheck
bun run test
bun run lint
bun run check
```

The integration tests use temporary directories and generated local pack
fixtures. The `examples/oma-codex` pack is a real starterpack example.

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

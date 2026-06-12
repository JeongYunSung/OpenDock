# Monorepo AI

Workspace maps, package boundaries, change impact review, and build cache notes.

## Outcome

AI agents can locate ownership boundaries, avoid cross-package drift, and validate only the necessary affected surface.

## Best For

Teams maintaining multi-package repositories or platform monorepos.

## What Gets Installed

- Shared agent instructions: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- Reusable skills for OpenDock/OMA, Codex, and Claude Code
- A Cursor project rule scoped to this dock
- Role-specific reference files and prompt templates

## First Run

`opendock install opendock/monorepo-ai@1.0.0`

After installation, open `README.md` in the target project and follow the first three steps.

## Pair With

- opendock/repo-context
- opendock/dev-env
- opendock/agent-safety

## Edition

This is the simple edition of `opendock/monorepo-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/monorepo-ai-pro](https://hub.opendock.app/docks/opendock/monorepo-ai-pro).

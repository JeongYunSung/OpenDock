# Repo Context

Repository context packaging, architecture mapping, and change-risk prompts.

## Outcome

Agents get repeatable repository snapshots and prompt flows instead of rediscovering the whole codebase every time.

## Best For

Teams handing repositories to AI agents for planning, review, or refactoring.

## What Gets Installed

- Shared agent instructions: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- Reusable skills for OpenDock/OMA, Codex, and Claude Code
- A Cursor project rule scoped to this dock
- Role-specific reference files and prompt templates

## First Run

`opendock install opendock/repo-context@1.0.0`

After installation, open `README.md` in the target project and follow the first three steps.

## Pair With

- opendock/agent-ready
- opendock/monorepo-ai
- opendock/docs-ai

## Edition

This is the simple edition of `opendock/repo-context`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/repo-context-pro](https://hub.opendock.app/docks/opendock/repo-context-pro).

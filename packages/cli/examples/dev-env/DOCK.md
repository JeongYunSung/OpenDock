# Dev Env

Project-local runtime versions and validation task references for agents.

## Outcome

A visible environment contract that tells agents which runtimes and validation tasks to prefer.

## Best For

Developers and teams that want AI agents to use the same local commands as humans.

## What Gets Installed

- Shared agent instructions: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- Reusable skills for OpenDock/OMA, Codex, and Claude Code
- A Cursor project rule scoped to this dock
- Role-specific reference files and prompt templates

## First Run

`opendock install opendock/dev-env@1.0.0`

After installation, open `README.md` in the target project and follow the first three steps.

## Pair With

- opendock/agent-ready
- opendock/frontend-ai
- opendock/backend-ai

## Edition

This is the simple edition of `opendock/dev-env`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/dev-env-pro](https://hub.opendock.app/docks/opendock/dev-env-pro).

# Agent Safety

Review rails, PR structure, and secret-scan defaults for AI-generated changes.

## Outcome

A project with PR templates, issue templates, security checklists, and agent instructions for safer AI-assisted changes.

## Best For

Engineering teams that want AI changes to arrive with clearer review evidence.

## What Gets Installed

- Shared agent instructions: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- Reusable skills for OpenDock/OMA, Codex, and Claude Code
- A Cursor project rule scoped to this dock
- Role-specific reference files and prompt templates

## First Run

`opendock install opendock/agent-safety@1.0.0`

After installation, open `README.md` in the target project and follow the first three steps.

## Pair With

- opendock/agent-ready
- opendock/frontend-ai
- opendock/backend-ai
- opendock/devops-ai

## Edition

This is the simple edition of `opendock/agent-safety`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/agent-safety-pro](https://hub.opendock.app/docks/opendock/agent-safety-pro).

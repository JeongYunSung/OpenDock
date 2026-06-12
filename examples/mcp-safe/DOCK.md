# MCP Safe

Security-first MCP inventory, config examples, and review checklists.

## Outcome

MCP setup remains reviewable, least-privilege, and reversible before any server is enabled in a client.

## Best For

Teams connecting AI agents to local files, SaaS APIs, or internal tools through MCP.

## What Gets Installed

- Shared agent instructions: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
- Reusable skills for OpenDock/OMA, Codex, and Claude Code
- A Cursor project rule scoped to this dock
- Role-specific reference files and prompt templates

## First Run

`opendock install opendock/mcp-safe@1.0.0`

After installation, open `README.md` in the target project and follow the first three steps.

## Pair With

- opendock/agent-ready
- opendock/ai-automation
- opendock/agent-safety

## Edition

This is the simple edition of `opendock/mcp-safe`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/mcp-safe-pro](https://hub.opendock.app/docks/opendock/mcp-safe-pro).

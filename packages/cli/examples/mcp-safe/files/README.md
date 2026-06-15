# MCP Safe Workspace

Security-first MCP inventory, config examples, and review checklists.

## Who This Is For

Teams connecting AI agents to local files, SaaS APIs, or internal tools through MCP.

## What This Dock Sets Up

MCP setup remains reviewable, least-privilege, and reversible before any server is enabled in a client.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-mcp-safe/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-mcp-safe/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-mcp-safe/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-mcp-safe.mdc`: Cursor project rule for this dock.

## Start Here

1. Read MCP.md before enabling any server.
2. Add each desired server to approved-servers.yml with scope and owner.
3. Copy config examples into active clients only after review.

## Common Workflows

- Review a proposed MCP server.
- Prepare safe config snippets for Codex, Claude, or Cursor.
- Create a rollback checklist for removing a risky integration.

## Quality Checks

- Server commands and packages are reviewed.
- File and account scopes are minimal.
- Credentials stay outside repository files.

## Useful Prompts

### Prompt 1

Review this MCP server proposal for least privilege and secret risk.

### Prompt 2

Create a safe MCP rollout checklist for this team.

### Prompt 3

Compare these MCP configs and flag differences in access scope.

## Reference Files

- MCP.md
- .opendock/mcp/approved-servers.yml
- .opendock/mcp/security-checklist.md

## Edition

This is the simple edition of `opendock/mcp-safe`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/mcp-safe-pro](https://hub.opendock.app/docks/opendock/mcp-safe-pro).

## Good Pairings

- opendock/agent-ready
- opendock/ai-automation
- opendock/agent-safety

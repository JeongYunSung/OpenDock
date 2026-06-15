# AI Automation Workspace

A practical workspace for mapping and designing safe internal automations.

## Who This Is For

Operations, marketing, support, and internal tooling teams.

## What This Dock Sets Up

A repeatable process for moving from manual workflow to reviewed automation without hiding approvals or data access.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-ai-automation/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-ai-automation/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-ai-automation/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-ai-automation.mdc`: Cursor project rule for this dock.

## Start Here

1. Fill in the current manual workflow in AUTOMATION_MAP.md.
2. Select one workflow candidate from WORKFLOW_LIBRARY.md.
3. Document systems, data owners, and approval gates before building.

## Common Workflows

- Map a process and score automation readiness.
- Design a lead qualification, reporting, or support triage workflow.
- Review MCP or API access before connecting tools.

## Quality Checks

- The automation has an owner and rollback path.
- Data sources, permissions, and approval points are documented.
- Human review stays in place for irreversible or customer-facing actions.

## Useful Prompts

### Prompt 1

Map this process into triggers, inputs, decisions, outputs, and risks.

### Prompt 2

Design a safe first automation for this workflow with human approval gates.

### Prompt 3

Review this MCP or API integration plan for over-broad access.

## Reference Files

- AUTOMATION_MAP.md
- WORKFLOW_LIBRARY.md
- MCP_GUIDE.md

## Edition

This is the simple edition of `opendock/ai-automation`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/ai-automation-pro](https://hub.opendock.app/docks/opendock/ai-automation-pro).

## Good Pairings

- opendock/mcp-safe
- opendock/agent-safety
- opendock/repo-context

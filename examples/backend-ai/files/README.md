# Backend AI Workspace

Backend API, database, security, and testing guidance for AI-assisted engineering.

## Who This Is For

Backend engineers and teams maintaining APIs, services, and data layers.

## What This Dock Sets Up

AI agents get clear API contracts, data rules, security checks, and test expectations before changing server behavior.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-backend-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-backend-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-backend-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-backend-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Identify the endpoint, job, schema, or service boundary being changed.
2. Check API_DESIGN.md and DATABASE_GUIDE.md before proposing implementation.
3. Choose tests from TESTING.md before editing behavior.

## Common Workflows

- Design or review an API endpoint.
- Review a schema or migration change.
- Debug a backend failure with logs, tests, and rollback options.

## Quality Checks

- Authorization and input validation are explicit.
- Data changes include migration, rollback, and idempotency notes where needed.
- Tests cover success, failure, and permission paths.

## Useful Prompts

### Prompt 1

Review this API change for security, compatibility, and missing tests.

### Prompt 2

Design the minimal database migration and rollback plan for this requirement.

### Prompt 3

Create a backend implementation plan with files to inspect first.

## Reference Files

- API_DESIGN.md
- DATABASE_GUIDE.md
- SECURITY_CHECKLIST.md
- TESTING.md

## Edition

This is the simple edition of `opendock/backend-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/backend-ai-pro](https://hub.opendock.app/docks/opendock/backend-ai-pro).

## Good Pairings

- opendock/agent-safety
- opendock/repo-context
- opendock/dev-env

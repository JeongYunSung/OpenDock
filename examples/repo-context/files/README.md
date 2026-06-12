# Repo Context Workspace

Repository context packaging, architecture mapping, and change-risk prompts.

## Who This Is For

Teams handing repositories to AI agents for planning, review, or refactoring.

## What This Dock Sets Up

Agents get repeatable repository snapshots and prompt flows instead of rediscovering the whole codebase every time.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-repo-context/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-repo-context/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-repo-context/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-repo-context.mdc`: Cursor project rule for this dock.

## Start Here

1. Review repomix.config.json before generating a bundle.
2. Generate context only for the project surface needed.
3. Pair generated context with one focused prompt from .opendock/prompts.

## Common Workflows

- Create a repository summary for a new agent.
- Map architecture and ownership boundaries.
- Review a proposed change for cross-module risk.

## Quality Checks

- Secrets, build artifacts, dependencies, and stale generated output are excluded.
- Context bundle scope is narrow enough to be useful.
- Generated bundles are not committed unless the team explicitly wants them.

## Useful Prompts

### Prompt 1

Summarize this repository context for a new coding agent.

### Prompt 2

Create an architecture map from this context bundle.

### Prompt 3

Review this planned change against the context and list risky files.

## Reference Files

- repomix.config.json
- .opendock/context/README.md
- .opendock/prompts/repository-summary.md
- .opendock/prompts/architecture-map.md
- .opendock/prompts/change-risk-review.md

## Edition

This is the simple edition of `opendock/repo-context`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/repo-context-pro](https://hub.opendock.app/docks/opendock/repo-context-pro).

## Good Pairings

- opendock/agent-ready
- opendock/monorepo-ai
- opendock/docs-ai

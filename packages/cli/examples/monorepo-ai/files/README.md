# Monorepo AI Workspace

Workspace maps, package boundaries, change impact review, and build cache notes.

## Who This Is For

Teams maintaining multi-package repositories or platform monorepos.

## What This Dock Sets Up

AI agents can locate ownership boundaries, avoid cross-package drift, and validate only the necessary affected surface.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-monorepo-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-monorepo-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-monorepo-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-monorepo-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Map packages and owners in WORKSPACE_MAP.md.
2. Review PACKAGE_BOUNDARIES.md before moving code across packages.
3. Use CHANGE_IMPACT.md to decide validation scope.

## Common Workflows

- Plan a cross-package change.
- Review dependency direction and ownership boundaries.
- Select affected tests and builds for a change.

## Quality Checks

- Dependency direction remains intentional.
- Shared packages keep backwards compatibility or migration notes.
- Validation scope matches changed packages and dependents.

## Useful Prompts

### Prompt 1

Map the package impact of this change and list files to inspect.

### Prompt 2

Review this dependency change for boundary violations.

### Prompt 3

Create a targeted validation plan for this monorepo diff.

## Reference Files

- WORKSPACE_MAP.md
- PACKAGE_BOUNDARIES.md
- CHANGE_IMPACT.md
- BUILD_CACHE.md

## Edition

This is the simple edition of `opendock/monorepo-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/monorepo-ai-pro](https://hub.opendock.app/docks/opendock/monorepo-ai-pro).

## Good Pairings

- opendock/repo-context
- opendock/dev-env
- opendock/agent-safety

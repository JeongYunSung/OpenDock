# Product Manager Workspace

PRD, user story, roadmap, release note, and decision template workspace.

## Who This Is For

Product managers, product owners, founders, and service planners.

## What This Dock Sets Up

AI-assisted product work becomes concrete: problem, users, metrics, requirements, scope, risks, and release communication are separated.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-product-manager/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-product-manager/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-product-manager/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-product-manager.mdc`: Cursor project rule for this dock.

## Start Here

1. Write the problem and success metric before listing features.
2. Use USER_STORY.md to turn requirements into acceptance criteria.
3. Use ROADMAP.md to separate now, next, and later.

## Common Workflows

- Draft a PRD.
- Turn customer feedback into user stories.
- Prepare release notes and rollout communication.

## Quality Checks

- Requirements are testable and prioritized.
- Out-of-scope items are explicit.
- Risks, dependencies, and open questions are visible.

## Useful Prompts

### Prompt 1

Turn this vague product idea into a PRD with assumptions and open questions.

### Prompt 2

Create user stories and acceptance criteria for this feature.

### Prompt 3

Review this roadmap for scope risk and missing dependencies.

## Reference Files

- PRD.md
- USER_STORY.md
- ROADMAP.md
- RELEASE_NOTES.md

## Edition

This is the simple edition of `opendock/product-manager`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/product-manager-pro](https://hub.opendock.app/docks/opendock/product-manager-pro).

## Good Pairings

- opendock/designer-ai
- opendock/data-analyst
- opendock/docs-ai

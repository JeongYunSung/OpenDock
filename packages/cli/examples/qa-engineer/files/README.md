# QA Engineer Workspace

Test planning, regression, bug report, accessibility, and performance review templates.

## Who This Is For

QA engineers, release owners, PMs, and developers reviewing AI-generated changes.

## What This Dock Sets Up

Testing work starts from risk and reproducibility instead of generic checklists.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-qa-engineer/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-qa-engineer/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-qa-engineer/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-qa-engineer.mdc`: Cursor project rule for this dock.

## Start Here

1. Identify the changed behavior and highest-risk users.
2. Use TEST_PLAN.md to select scenarios and environments.
3. Use BUG_REPORT.md when reporting failures.

## Common Workflows

- Create a test plan from requirements.
- Review a change for regression risk.
- Write a bug report with reproduction and expected behavior.

## Quality Checks

- Critical paths, negative cases, and edge cases are covered.
- Accessibility and performance are considered when user-facing UI changes.
- Evidence is reproducible enough for another person or agent.

## Useful Prompts

### Prompt 1

Create a risk-based test plan for this feature.

### Prompt 2

Review this diff for missing regression coverage.

### Prompt 3

Turn these notes into a clear bug report with reproduction steps.

## Reference Files

- TEST_PLAN.md
- REGRESSION_CHECKLIST.md
- BUG_REPORT.md
- ACCESSIBILITY_CHECKLIST.md
- PERFORMANCE_CHECKLIST.md

## Edition

This is the simple edition of `opendock/qa-engineer`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/qa-engineer-pro](https://hub.opendock.app/docks/opendock/qa-engineer-pro).

## Good Pairings

- opendock/frontend-ai
- opendock/backend-ai
- opendock/agent-safety

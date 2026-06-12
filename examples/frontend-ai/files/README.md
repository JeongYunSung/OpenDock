# Frontend AI Workspace

React, Next.js, TypeScript, component, accessibility, and review guidance.

## Who This Is For

Frontend engineers and product teams building web interfaces.

## What This Dock Sets Up

AI agents can edit frontend code with clearer component boundaries, UI states, accessibility checks, and validation expectations.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-frontend-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-frontend-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-frontend-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-frontend-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Read nearby components and design notes before creating new UI.
2. Check COMPONENT_GUIDE.md and CODE_STYLE.md before editing.
3. Use REVIEW_CHECKLIST.md for loading, empty, error, success, and responsive states.

## Common Workflows

- Implement or review a React component.
- Turn design requirements into acceptance criteria.
- Debug a frontend interaction or layout issue.

## Quality Checks

- Keyboard and screen-reader paths are considered.
- No one-off styling when a local component or token exists.
- Tests or screenshots cover meaningful behavior where practical.

## Useful Prompts

### Prompt 1

Review this component for accessibility, state handling, and maintainability.

### Prompt 2

Create an implementation plan for this UI without inventing a new design system.

### Prompt 3

Find risky layout, responsive, and text-overflow issues in this screen.

## Reference Files

- DESIGN.md
- COMPONENT_GUIDE.md
- CODE_STYLE.md
- REVIEW_CHECKLIST.md

## Edition

This is the simple edition of `opendock/frontend-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/frontend-ai-pro](https://hub.opendock.app/docks/opendock/frontend-ai-pro).

## Good Pairings

- opendock/designer-ai
- opendock/agent-safety
- opendock/dev-env

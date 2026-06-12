# Designer AI Workspace

UI, UX, product design, design system, Figma workflow, and review templates.

## Who This Is For

UI designers, UX designers, product designers, and design leads.

## What This Dock Sets Up

AI agents can critique, improve, and hand off product design work with clear standards and review criteria.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-designer-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-designer-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-designer-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-designer-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Capture product context and audience in DESIGN.md.
2. Use DESIGN_SYSTEM.md before creating new visual rules.
3. Run UX_REVIEW.md before shipping a screen or flow.

## Common Workflows

- Review a UI screen for usability and hierarchy.
- Create a product flow from requirements.
- Prepare Figma handoff notes for engineering.

## Quality Checks

- Accessibility, responsive behavior, and empty/error states are considered.
- Design feedback is specific and tied to user goals.
- Handoff includes constraints, tokens, and acceptance criteria.

## Useful Prompts

### Prompt 1

Review this UI for hierarchy, accessibility, and conversion risk.

### Prompt 2

Create a user flow and identify decision points for this onboarding task.

### Prompt 3

Turn this Figma screen into engineering-ready acceptance criteria.

## Reference Files

- DESIGN.md
- DESIGN_SYSTEM.md
- UX_REVIEW.md
- FIGMA_WORKFLOW.md

## Edition

This is the simple edition of `opendock/designer-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/designer-ai-pro](https://hub.opendock.app/docks/opendock/designer-ai-pro).

## Good Pairings

- opendock/frontend-ai
- opendock/ui-case-study
- opendock/product-manager

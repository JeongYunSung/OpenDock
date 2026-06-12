# Docs AI Workspace

Documentation standards, API doc templates, changelogs, and release notes.

## Who This Is For

Technical writers, developers, PMs, and teams with drifting documentation.

## What This Dock Sets Up

AI documentation work becomes accurate, concise, and tied to the actual product or code behavior.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-docs-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-docs-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-docs-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-docs-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Identify the reader and task the doc must support.
2. Use DOCS_STYLE_GUIDE.md for tone and structure.
3. Check source files, API behavior, or product screenshots before claiming behavior.

## Common Workflows

- Rewrite a README for onboarding.
- Create API documentation from routes or examples.
- Draft release notes from merged changes.

## Quality Checks

- Every claim is traceable to current behavior or an explicit assumption.
- Examples are runnable or clearly marked as illustrative.
- Docs distinguish setup, usage, troubleshooting, and reference.

## Useful Prompts

### Prompt 1

Audit this README for outdated commands and missing setup steps.

### Prompt 2

Turn this API behavior into user-facing documentation.

### Prompt 3

Write release notes that explain impact, not implementation trivia.

## Reference Files

- DOCS_STYLE_GUIDE.md
- API_DOC_TEMPLATE.md
- CHANGELOG_TEMPLATE.md
- RELEASE_NOTES.md

## Edition

This is the simple edition of `opendock/docs-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/docs-ai-pro](https://hub.opendock.app/docks/opendock/docs-ai-pro).

## Good Pairings

- opendock/repo-context
- opendock/product-manager
- opendock/agent-safety

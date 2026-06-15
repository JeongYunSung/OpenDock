# Mobile AI Workspace

Mobile architecture, UI patterns, release readiness, and testing guidance.

## Who This Is For

iOS, Android, Flutter, and React Native teams.

## What This Dock Sets Up

AI agents can reason about mobile app changes with platform constraints, release risks, and UX states in view.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-mobile-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-mobile-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-mobile-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-mobile-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Identify the target platform and app architecture.
2. Review UI_PATTERNS.md before changing screens.
3. Use RELEASE_CHECKLIST.md when the change affects store release, permissions, or native capabilities.

## Common Workflows

- Plan a mobile feature change.
- Review navigation, permissions, offline, and error states.
- Prepare a release-risk checklist.

## Quality Checks

- Platform-specific behavior is not assumed to be identical.
- Permissions, privacy, and crash reporting are considered.
- Manual QA paths cover key devices or simulators.

## Useful Prompts

### Prompt 1

Review this mobile feature for lifecycle, permission, and offline risks.

### Prompt 2

Create a test plan for this screen across iOS and Android.

### Prompt 3

Prepare release notes and rollout risks for this app update.

## Reference Files

- MOBILE_ARCHITECTURE.md
- UI_PATTERNS.md
- RELEASE_CHECKLIST.md
- TESTING.md

## Edition

This is the simple edition of `opendock/mobile-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/mobile-ai-pro](https://hub.opendock.app/docks/opendock/mobile-ai-pro).

## Good Pairings

- opendock/qa-engineer
- opendock/agent-safety
- opendock/dev-env

# Agent Ready Workspace

Baseline instructions and shared rules for AI coding agents.

## Who This Is For

Teams that use one or more AI coding agents in the same repository.

## What This Dock Sets Up

A repository that exposes clear project context to Codex, Claude Code, Gemini, Copilot, Cursor, Windsurf, Cline, and Roo without forcing a specific tool.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-agent-ready/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-agent-ready/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-agent-ready/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-agent-ready.mdc`: Cursor project rule for this dock.

## Start Here

1. Open AGENTS.md and CLAUDE.md to confirm the project-level working agreement.
2. Review CONVENTIONS.md before making code changes.
3. Use the installed vendor rule files only as thin adapters; keep shared behavior in AGENTS.md.

## Common Workflows

- Start a new agent session with the repository root as the working directory.
- Ask the agent to summarize loaded instructions before a risky change.
- Run validation from README.md or project scripts before handoff.

## Quality Checks

- No secret values in prompts, logs, or examples.
- No broad rewrite unless the user explicitly asks for one.
- Validation commands and skipped checks are reported.

## Useful Prompts

### Prompt 1

Summarize this repository for a new agent session and list the files you would read first.

### Prompt 2

Review this diff for behavior regressions, missing tests, and security-sensitive changes.

### Prompt 3

Create a short handoff note for the next agent, including what was verified and what remains unknown.

## Reference Files

- CONVENTIONS.md

## Edition

This is the simple edition of `opendock/agent-ready`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/agent-ready-pro](https://hub.opendock.app/docks/opendock/agent-ready-pro).

## Good Pairings

- opendock/codex
- opendock/claude-code
- opendock/agent-safety

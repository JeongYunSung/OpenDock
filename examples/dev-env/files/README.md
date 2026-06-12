# Dev Env Workspace

Project-local runtime versions and validation task references for agents.

## Who This Is For

Developers and teams that want AI agents to use the same local commands as humans.

## What This Dock Sets Up

A visible environment contract that tells agents which runtimes and validation tasks to prefer.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-dev-env/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-dev-env/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-dev-env/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-dev-env.mdc`: Cursor project rule for this dock.

## Start Here

1. Review mise.toml and adjust runtimes before enforcing it.
2. Document the package manager and expected validation sequence.
3. Ask the agent to run only project-approved tasks.

## Common Workflows

- Standardize install, lint, test, build, and doctor commands.
- Debug a missing runtime or inconsistent local setup.
- Prepare a clean validation checklist for a repo.

## Quality Checks

- Commands are project-local and reproducible.
- Runtime versions are explicit enough for agents and humans.
- Missing tools are reported instead of guessed.

## Useful Prompts

### Prompt 1

Inspect this repo and update the validation task list without changing application behavior.

### Prompt 2

Explain the local setup sequence for a new contributor.

### Prompt 3

Review these runtime versions for compatibility risk.

## Reference Files

- mise.toml
- .opendock/dev-env.md

## Edition

This is the simple edition of `opendock/dev-env`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/dev-env-pro](https://hub.opendock.app/docks/opendock/dev-env-pro).

## Good Pairings

- opendock/agent-ready
- opendock/frontend-ai
- opendock/backend-ai

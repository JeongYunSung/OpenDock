# Agent Safety Workspace

Review rails, PR structure, and secret-scan defaults for AI-generated changes.

## Who This Is For

Engineering teams that want AI changes to arrive with clearer review evidence.

## What This Dock Sets Up

A project with PR templates, issue templates, security checklists, and agent instructions for safer AI-assisted changes.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-agent-safety/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-agent-safety/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-agent-safety/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-agent-safety.mdc`: Cursor project rule for this dock.

## Start Here

1. Read the PR and security checklists before accepting generated changes.
2. Run the project tests or document why they are unavailable.
3. Use the PR template to force a concise validation trail.

## Common Workflows

- Review an AI-generated diff before merge.
- Prepare a release-risk note for a small team.
- Triage a suspicious token, secret, or permission change.

## Quality Checks

- Secrets are not present in code, docs, logs, screenshots, or fixtures.
- Every behavior change has a validation path.
- Rollback and ownership are clear before deployment.

## Useful Prompts

### Prompt 1

Review this diff using .opendock/checklists/agent-pr-review.md.

### Prompt 2

Find possible secrets or private data exposure in the current change.

### Prompt 3

Create a merge-ready PR summary with validation and rollback notes.

## Reference Files

- .opendock/checklists/agent-pr-review.md
- .opendock/checklists/security-review.md
- .github/pull_request_template.md

## Edition

This is the simple edition of `opendock/agent-safety`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/agent-safety-pro](https://hub.opendock.app/docks/opendock/agent-safety-pro).

## Good Pairings

- opendock/agent-ready
- opendock/frontend-ai
- opendock/backend-ai
- opendock/devops-ai

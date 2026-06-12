# DevOps AI Workspace

CI/CD, deployment, incident, and secrets policy guidance for AI-assisted operations.

## Who This Is For

DevOps engineers, platform teams, SREs, and teams that deploy frequently.

## What This Dock Sets Up

AI agents get operational guardrails before touching pipelines, deploy scripts, credentials, or incident docs.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-devops-ai/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-devops-ai/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-devops-ai/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-devops-ai.mdc`: Cursor project rule for this dock.

## Start Here

1. Identify the environment, owner, and rollback path.
2. Review CI_CD.md and SECRETS_POLICY.md before editing automation.
3. Use runbooks when explaining incidents or deploy changes.

## Common Workflows

- Review a CI/CD workflow.
- Prepare a deployment plan and rollback checklist.
- Draft or update an incident runbook.

## Quality Checks

- No secrets are exposed or printed.
- Deploy changes include observability and rollback.
- Production-impacting actions require explicit human approval.

## Useful Prompts

### Prompt 1

Review this pipeline for security, reliability, and rollback gaps.

### Prompt 2

Create a deployment runbook for this release.

### Prompt 3

Summarize this incident with timeline, impact, root cause, and prevention.

## Reference Files

- CI_CD.md
- DEPLOYMENT_RUNBOOK.md
- INCIDENT_RUNBOOK.md
- SECRETS_POLICY.md

## Edition

This is the simple edition of `opendock/devops-ai`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/devops-ai-pro](https://hub.opendock.app/docks/opendock/devops-ai-pro).

## Good Pairings

- opendock/agent-safety
- opendock/mcp-safe
- opendock/repo-context

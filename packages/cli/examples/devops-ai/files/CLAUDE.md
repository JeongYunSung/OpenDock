# DevOps AI Claude Code Guidance

Claude Code should use this dock as persistent project memory for: DevOps engineers, platform teams, SREs, and teams that deploy frequently.

## Load Order

1. Read AGENTS.md for the shared operating contract.
2. Read this file for Claude-specific behavior.
3. Use /opendock-devops-ai when the task matches this dock and the skill is available.
4. Read the dock reference files only when they are relevant to the current task.

## Claude-Specific Rules

- Keep CLAUDE.md concise; move repeatable procedures into .claude/skills/opendock-devops-ai/SKILL.md.
- Before editing, summarize which project files and dock files are relevant.
- Do not treat this file as a hard safety gate. If an action must be blocked, ask the user to add an explicit hook or policy.
- If instructions conflict, follow the user's latest request and then the nearest project instruction file.

## Reference Files

- CI_CD.md
- DEPLOYMENT_RUNBOOK.md
- INCIDENT_RUNBOOK.md
- SECRETS_POLICY.md
- PROMPTS.md

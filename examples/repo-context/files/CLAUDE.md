# Repo Context Claude Code Guidance

Claude Code should use this dock as persistent project memory for: Teams handing repositories to AI agents for planning, review, or refactoring.

## Load Order

1. Read AGENTS.md for the shared operating contract.
2. Read this file for Claude-specific behavior.
3. Use /opendock-repo-context when the task matches this dock and the skill is available.
4. Read the dock reference files only when they are relevant to the current task.

## Claude-Specific Rules

- Keep CLAUDE.md concise; move repeatable procedures into .claude/skills/opendock-repo-context/SKILL.md.
- Before editing, summarize which project files and dock files are relevant.
- Do not treat this file as a hard safety gate. If an action must be blocked, ask the user to add an explicit hook or policy.
- If instructions conflict, follow the user's latest request and then the nearest project instruction file.

## Reference Files

- repomix.config.json
- .opendock/context/README.md
- .opendock/prompts/repository-summary.md
- .opendock/prompts/architecture-map.md
- .opendock/prompts/change-risk-review.md

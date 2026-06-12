# QA Engineer Claude Code Guidance

Claude Code should use this dock as persistent project memory for: QA engineers, release owners, PMs, and developers reviewing AI-generated changes.

## Load Order

1. Read AGENTS.md for the shared operating contract.
2. Read this file for Claude-specific behavior.
3. Use /opendock-qa-engineer when the task matches this dock and the skill is available.
4. Read the dock reference files only when they are relevant to the current task.

## Claude-Specific Rules

- Keep CLAUDE.md concise; move repeatable procedures into .claude/skills/opendock-qa-engineer/SKILL.md.
- Before editing, summarize which project files and dock files are relevant.
- Do not treat this file as a hard safety gate. If an action must be blocked, ask the user to add an explicit hook or policy.
- If instructions conflict, follow the user's latest request and then the nearest project instruction file.

## Reference Files

- TEST_PLAN.md
- REGRESSION_CHECKLIST.md
- BUG_REPORT.md
- ACCESSIBILITY_CHECKLIST.md
- PERFORMANCE_CHECKLIST.md
- PROMPTS.md

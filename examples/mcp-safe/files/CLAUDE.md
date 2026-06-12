# MCP Safe Claude Code Guidance

Claude Code should use this dock as persistent project memory for: Teams connecting AI agents to local files, SaaS APIs, or internal tools through MCP.

## Load Order

1. Read AGENTS.md for the shared operating contract.
2. Read this file for Claude-specific behavior.
3. Use /opendock-mcp-safe when the task matches this dock and the skill is available.
4. Read the dock reference files only when they are relevant to the current task.

## Claude-Specific Rules

- Keep CLAUDE.md concise; move repeatable procedures into .claude/skills/opendock-mcp-safe/SKILL.md.
- Before editing, summarize which project files and dock files are relevant.
- Do not treat this file as a hard safety gate. If an action must be blocked, ask the user to add an explicit hook or policy.
- If instructions conflict, follow the user's latest request and then the nearest project instruction file.

## Reference Files

- MCP.md
- .opendock/mcp/approved-servers.yml
- .opendock/mcp/security-checklist.md

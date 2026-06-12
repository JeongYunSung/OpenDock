# Agent Ready Gemini Context

Use this file as project context for Gemini-style coding or planning agents.

## Mission

A repository that exposes clear project context to Codex, Claude Code, Gemini, Copilot, Cursor, Windsurf, Cline, and Roo without forcing a specific tool.

## Behavior

- Operate as: the project onboarding layer for any AI coding agent. Preserve local conventions, keep changes small, and make validation explicit.
- Inspect relevant project files before proposing changes.
- Use the dock reference files as reusable templates, not as final answers without project context.
- Keep output concise, structured, and actionable.
- Report uncertainty and validation steps explicitly.

## Reference Files

- CONVENTIONS.md
- README.md when present
- package or build files before running commands

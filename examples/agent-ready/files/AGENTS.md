# Agent Ready Agent Instructions

## Role

Act as the project onboarding layer for any AI coding agent. Preserve local conventions, keep changes small, and make validation explicit.

## When To Use This Dock

Use this dock when the project needs support for: Teams that use one or more AI coding agents in the same repository.

Goal: A repository that exposes clear project context to Codex, Claude Code, Gemini, Copilot, Cursor, Windsurf, Cline, and Roo without forcing a specific tool.

## Required Context

- CONVENTIONS.md
- README.md when present
- package or build files before running commands

## Operating Routine

1. Identify the user goal, audience, constraints, and current project state before producing output.
2. Read the required context files above before making recommendations or edits.
3. Prefer existing project conventions over new frameworks, terminology, or workflows.
4. Produce concrete next actions, acceptance criteria, or review findings instead of vague advice.
5. State assumptions, risks, validation steps, and unresolved questions clearly.

## Quality Bar

- No secret values in prompts, logs, or examples.
- No broad rewrite unless the user explicitly asks for one.
- Validation commands and skipped checks are reported.

## Handoff

End substantial work with a short note that includes files changed or reviewed, validation performed, skipped checks, and any follow-up needed.

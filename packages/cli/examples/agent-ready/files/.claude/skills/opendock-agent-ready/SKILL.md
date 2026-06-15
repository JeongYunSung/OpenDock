---
description: Baseline instructions and shared rules for AI coding agents. Use when working with Teams that use one or more AI coding agents in the same repository..
---

# Agent Ready Skill

## Purpose

A repository that exposes clear project context to Codex, Claude Code, Gemini, Copilot, Cursor, Windsurf, Cline, and Roo without forcing a specific tool.

## Use When

- Start a new agent session with the repository root as the working directory.
- Ask the agent to summarize loaded instructions before a risky change.
- Run validation from README.md or project scripts before handoff.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- CONVENTIONS.md
- README.md when present
- package or build files before running commands

## Quality Checks

- No secret values in prompts, logs, or examples.
- No broad rewrite unless the user explicitly asks for one.
- Validation commands and skipped checks are reported.

## Prompt Starters

- Summarize this repository for a new agent session and list the files you would read first.
- Review this diff for behavior regressions, missing tests, and security-sensitive changes.
- Create a short handoff note for the next agent, including what was verified and what remains unknown.

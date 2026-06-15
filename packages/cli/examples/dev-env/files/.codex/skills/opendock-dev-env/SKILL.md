---
name: opendock-dev-env
description: Project-local runtime versions and validation task references for agents. Use when working with Developers and teams that want AI agents to use the same local commands as humans..
---

# Dev Env Skill

## Purpose

A visible environment contract that tells agents which runtimes and validation tasks to prefer.

## Use When

- Standardize install, lint, test, build, and doctor commands.
- Debug a missing runtime or inconsistent local setup.
- Prepare a clean validation checklist for a repo.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- mise.toml
- .opendock/dev-env.md
- README.md when present

## Quality Checks

- Commands are project-local and reproducible.
- Runtime versions are explicit enough for agents and humans.
- Missing tools are reported instead of guessed.

## Prompt Starters

- Inspect this repo and update the validation task list without changing application behavior.
- Explain the local setup sequence for a new contributor.
- Review these runtime versions for compatibility risk.

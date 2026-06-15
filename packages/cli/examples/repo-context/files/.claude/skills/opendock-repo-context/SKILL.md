---
description: Repository context packaging, architecture mapping, and change-risk prompts. Use when working with Teams handing repositories to AI agents for planning, review, or refactoring..
---

# Repo Context Skill

## Purpose

Agents get repeatable repository snapshots and prompt flows instead of rediscovering the whole codebase every time.

## Use When

- Create a repository summary for a new agent.
- Map architecture and ownership boundaries.
- Review a proposed change for cross-module risk.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- repomix.config.json
- .opendock/context/README.md
- .opendock/prompts/repository-summary.md
- .opendock/prompts/architecture-map.md
- .opendock/prompts/change-risk-review.md

## Quality Checks

- Secrets, build artifacts, dependencies, and stale generated output are excluded.
- Context bundle scope is narrow enough to be useful.
- Generated bundles are not committed unless the team explicitly wants them.

## Prompt Starters

- Summarize this repository context for a new coding agent.
- Create an architecture map from this context bundle.
- Review this planned change against the context and list risky files.

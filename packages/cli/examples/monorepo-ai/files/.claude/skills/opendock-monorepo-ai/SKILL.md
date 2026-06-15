---
description: Workspace maps, package boundaries, change impact review, and build cache notes. Use when working with Teams maintaining multi-package repositories or platform monorepos..
---

# Monorepo AI Skill

## Purpose

AI agents can locate ownership boundaries, avoid cross-package drift, and validate only the necessary affected surface.

## Use When

- Plan a cross-package change.
- Review dependency direction and ownership boundaries.
- Select affected tests and builds for a change.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- WORKSPACE_MAP.md
- PACKAGE_BOUNDARIES.md
- CHANGE_IMPACT.md
- BUILD_CACHE.md
- PROMPTS.md

## Quality Checks

- Dependency direction remains intentional.
- Shared packages keep backwards compatibility or migration notes.
- Validation scope matches changed packages and dependents.

## Prompt Starters

- Map the package impact of this change and list files to inspect.
- Review this dependency change for boundary violations.
- Create a targeted validation plan for this monorepo diff.

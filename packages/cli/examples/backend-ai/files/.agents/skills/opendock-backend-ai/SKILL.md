---
name: opendock-backend-ai
description: Backend API, database, security, and testing guidance for AI-assisted engineering. Use when working with Backend engineers and teams maintaining APIs, services, and data layers..
---

# Backend AI Skill

## Purpose

AI agents get clear API contracts, data rules, security checks, and test expectations before changing server behavior.

## Use When

- Design or review an API endpoint.
- Review a schema or migration change.
- Debug a backend failure with logs, tests, and rollback options.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- API_DESIGN.md
- DATABASE_GUIDE.md
- SECURITY_CHECKLIST.md
- TESTING.md
- PROMPTS.md

## Quality Checks

- Authorization and input validation are explicit.
- Data changes include migration, rollback, and idempotency notes where needed.
- Tests cover success, failure, and permission paths.

## Prompt Starters

- Review this API change for security, compatibility, and missing tests.
- Design the minimal database migration and rollback plan for this requirement.
- Create a backend implementation plan with files to inspect first.

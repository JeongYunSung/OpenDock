---
description: Review rails, PR structure, and secret-scan defaults for AI-generated changes. Use when working with Engineering teams that want AI changes to arrive with clearer review evidence..
---

# Agent Safety Skill

## Purpose

A project with PR templates, issue templates, security checklists, and agent instructions for safer AI-assisted changes.

## Use When

- Review an AI-generated diff before merge.
- Prepare a release-risk note for a small team.
- Triage a suspicious token, secret, or permission change.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- .opendock/checklists/agent-pr-review.md
- .opendock/checklists/security-review.md
- .github/pull_request_template.md

## Quality Checks

- Secrets are not present in code, docs, logs, screenshots, or fixtures.
- Every behavior change has a validation path.
- Rollback and ownership are clear before deployment.

## Prompt Starters

- Review this diff using .opendock/checklists/agent-pr-review.md.
- Find possible secrets or private data exposure in the current change.
- Create a merge-ready PR summary with validation and rollback notes.

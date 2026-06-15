---
name: opendock-devops-ai
description: CI/CD, deployment, incident, and secrets policy guidance for AI-assisted operations. Use when working with DevOps engineers, platform teams, SREs, and teams that deploy frequently..
---

# DevOps AI Skill

## Purpose

AI agents get operational guardrails before touching pipelines, deploy scripts, credentials, or incident docs.

## Use When

- Review a CI/CD workflow.
- Prepare a deployment plan and rollback checklist.
- Draft or update an incident runbook.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- CI_CD.md
- DEPLOYMENT_RUNBOOK.md
- INCIDENT_RUNBOOK.md
- SECRETS_POLICY.md
- PROMPTS.md

## Quality Checks

- No secrets are exposed or printed.
- Deploy changes include observability and rollback.
- Production-impacting actions require explicit human approval.

## Prompt Starters

- Review this pipeline for security, reliability, and rollback gaps.
- Create a deployment runbook for this release.
- Summarize this incident with timeline, impact, root cause, and prevention.

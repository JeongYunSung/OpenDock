---
description: Security-first MCP inventory, config examples, and review checklists. Use when working with Teams connecting AI agents to local files, SaaS APIs, or internal tools through MCP..
---

# MCP Safe Skill

## Purpose

MCP setup remains reviewable, least-privilege, and reversible before any server is enabled in a client.

## Use When

- Review a proposed MCP server.
- Prepare safe config snippets for Codex, Claude, or Cursor.
- Create a rollback checklist for removing a risky integration.

## Procedure

1. Restate the requested outcome in one sentence.
2. Read the relevant project files and the dock reference files listed below.
3. Identify assumptions, constraints, risks, and missing information.
4. Produce the smallest useful artifact: plan, review, template, implementation checklist, or finished content.
5. End with validation, review notes, and next action.

## Required References

- MCP.md
- .opendock/mcp/approved-servers.yml
- .opendock/mcp/security-checklist.md

## Quality Checks

- Server commands and packages are reviewed.
- File and account scopes are minimal.
- Credentials stay outside repository files.

## Prompt Starters

- Review this MCP server proposal for least privilege and secret risk.
- Create a safe MCP rollout checklist for this team.
- Compare these MCP configs and flag differences in access scope.

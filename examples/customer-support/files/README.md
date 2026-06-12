# Customer Support Workspace

Support playbooks, FAQ structure, ticket triage, escalation, and reusable response prompts.

## Who This Is For

Support leads, CX teams, founders, and operations teams handling customer issues.

## What This Dock Sets Up

Customer-facing answers become clearer, policy-aware, and easier to escalate without losing empathy.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-customer-support/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-customer-support/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-customer-support/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-customer-support.mdc`: Cursor project rule for this dock.

## Start Here

1. Classify the ticket using TICKET_TRIAGE.md.
2. Check FAQ.md and SUPPORT_PLAYBOOK.md before drafting a response.
3. Use ESCALATION.md when money, legal, security, safety, or account access is involved.

## Common Workflows

- Draft a customer reply.
- Turn repeated tickets into FAQ entries.
- Create an escalation summary for engineering or leadership.

## Quality Checks

- The answer is specific, respectful, and avoids unsupported promises.
- Sensitive account, billing, legal, or security issues are escalated.
- Internal notes are separated from customer-facing copy.

## Useful Prompts

### Prompt 1

Rewrite this support reply to be clear, empathetic, and policy-safe.

### Prompt 2

Triage these tickets by urgency, owner, and next action.

### Prompt 3

Create an escalation brief with customer impact and evidence.

## Reference Files

- SUPPORT_PLAYBOOK.md
- FAQ.md
- TICKET_TRIAGE.md
- ESCALATION.md

## Edition

This is the simple edition of `opendock/customer-support`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/customer-support-pro](https://hub.opendock.app/docks/opendock/customer-support-pro).

## Good Pairings

- opendock/ai-automation
- opendock/docs-ai
- opendock/agent-safety

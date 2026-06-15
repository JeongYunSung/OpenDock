# Data Analyst Workspace

Metric definitions, SQL review, dashboard briefs, and experiment analysis templates.

## Who This Is For

Data analysts, PMs, founders, and operators who need decision-ready metrics.

## What This Dock Sets Up

AI-assisted analysis starts with definitions, assumptions, and validation instead of untraceable numbers.

## Installed Agent Context

- `AGENTS.md`: shared instructions for Codex and other agent runtimes.
- `CLAUDE.md`: Claude Code project memory and skill routing notes.
- `GEMINI.md`: Gemini-compatible workspace context.
- `.agents/skills/opendock-data-analyst/SKILL.md`: OpenDock/OMA-style reusable skill instructions.
- `.codex/skills/opendock-data-analyst/SKILL.md`: Codex skill entry for this workspace role.
- `.claude/skills/opendock-data-analyst/SKILL.md`: Claude Code skill entry for this workspace role.
- `.cursor/rules/opendock-data-analyst.mdc`: Cursor project rule for this dock.

## Start Here

1. Write the business question and decision owner.
2. Check METRICS_DICTIONARY.md before naming a metric.
3. Use SQL_REVIEW.md before trusting query results.

## Common Workflows

- Define a KPI or metric dictionary entry.
- Review SQL for join, grain, filter, and timezone issues.
- Summarize an experiment with confidence and caveats.

## Quality Checks

- Metric grain, filters, and source tables are named.
- The analysis states limitations and confidence level.
- No personal data is exposed in examples or outputs.

## Useful Prompts

### Prompt 1

Review this SQL for metric correctness and edge cases.

### Prompt 2

Turn this dashboard request into a brief with metrics, filters, and owners.

### Prompt 3

Analyze this experiment and separate evidence from recommendation.

## Reference Files

- METRICS_DICTIONARY.md
- SQL_REVIEW.md
- DASHBOARD_BRIEF.md
- EXPERIMENT_ANALYSIS.md

## Edition

This is the simple edition of `opendock/data-analyst`. It keeps setup small and installs the core workspace context. For a stronger specialist team, use the pro addon: [opendock/data-analyst-pro](https://hub.opendock.app/docks/opendock/data-analyst-pro).

## Good Pairings

- opendock/product-manager
- opendock/startup-founder
- opendock/agent-safety

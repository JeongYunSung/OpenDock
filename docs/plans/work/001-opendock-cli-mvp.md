# OpenDock CLI MVP

> Build the TypeScript CLI that installs, updates, diagnoses, logs, authenticates, and submits OpenDock docks.

**Status**: Completed
**Created**: 2026-06-07
**Owner**: Codex

## Goal

Create a high-quality Bun-first TypeScript CLI in this repository that supports the agreed OpenDock command surface:

```bash
opendock install opendock/codex
opendock update
opendock doctor
opendock log
opendock version
opendock auth login
opendock deploy codex
```

The MVP applies approved docks to the current directory, preserves user-authored files with declared update policies, writes `.opendock/` project state, exposes diagnostics and logs, stores OpenDock Hub auth tokens, and provides deploy submission plumbing.

## Context

The product direction is a CLI-first dock runner. The implementation now follows the TypeScript/Bun CLI shape used by adjacent agent-native projects such as Open Design and oh-my-agent.

Core decisions:

- Bun-first TypeScript CLI with ESM modules.
- Commander for CLI routing.
- YAML + Zod for `dock.yml` parsing and validation.
- Vitest for temp-dir CLI integration tests.
- Biome for lint/format checks.
- Dock references use `{owner}/{dock}`, e.g. `opendock/codex`.
- `install` is public and login-free.
- `deploy` requires login and creates a submission for approval.
- Existing files are updated through explicit `files[].update` policies.
- `.opendock/project.yml` and `.opendock/dock.lock.yml` are shared project metadata.
- Detailed logs stay outside project source control in the user data directory.

## Constraints

- Do not modify parent `.agents/` SSOT files.
- Hub/auth/deploy code must keep the runtime dock source fixed to the approved Hub.
- Commands that execute lifecycle steps must use an allowlist and must not execute arbitrary shell pipelines.
- Generated build output stays out of source control.

## API Contracts

OpenDock Hub API draft:

Base URL: `https://hub.opendock.app`

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /v1/docks/{owner}/{name}/versions/latest` | Resolve latest approved dock version | No |
| `GET /v1/docks/{owner}/{name}/versions/{selector}` | Resolve an approved dock by version selector | No |
| `GET /v1/docks/{owner}/{name}/versions/{version}/download` | Download dock archive | No |
| `POST /v1/auth/login` | Exchange login token or email token for CLI token | No |
| `POST /v1/docks/submissions` | Submit dock for review | Yes |

Local development contract:

- Dock source and Hub host are not configurable by runtime environment variables.
- Install refs support `owner/name@selector`; the CLI stores both requested selector and resolved exact version in lock state.

## Tasks

| # | Task | Area | Priority | Status |
|---|------|------|----------|--------|
| 1 | Create TypeScript package scaffold and baseline CLI | cli | P0 | DONE |
| 2 | Implement `dock.yml` parser and schema validation | core | P0 | DONE |
| 3 | Implement dock reference parsing and local/remote resolver | core | P0 | DONE |
| 4 | Implement file application with update policies | core | P0 | DONE |
| 5 | Write `.opendock/project.yml` and `.opendock/dock.lock.yml` | core | P0 | DONE |
| 6 | Implement lifecycle runner with command allowlist | core | P0 | DONE |
| 7 | Implement `install`, `doctor`, `log`, `version`, and `update` | cli | P0 | DONE |
| 8 | Add `auth login` token storage and `deploy` submission flow | cli | P1 | DONE |
| 9 | Keep `examples/codex` dock fixture | fixture | P0 | DONE |
| 10 | Add temp-dir CLI integration tests for edge cases | qa | P0 | DONE |
| 11 | Run typecheck, tests, lint, and final manual smoke checks | qa | P0 | DONE |

## Done When

- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.
- [x] `bun run lint` passes.
- [x] `opendock version` prints CLI, schema, and hub info.
- [x] `opendock install opendock/codex` can install from a configured local dock fixture.
- [x] Existing files are not overwritten.
- [x] Re-running `install` does not duplicate managed blocks.
- [x] `.opendock/project.yml` and `.opendock/dock.lock.yml` are created.
- [x] `opendock doctor` reports project state and missing items.
- [x] `opendock log` shows recent project runs.
- [x] `opendock update` reads lock state and applies newer dock versions.
- [x] `opendock deploy` fails clearly when not logged in.
- [x] `opendock auth login` stores a token through the configured login flow.

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-07 | Build CLI before app | It proves the core dock workflow with the smallest product surface. |
| 2026-06-07 | Use TypeScript/Bun | It aligns OpenDock with adjacent open-source agent tooling and keeps the CLI easy to extend. |
| 2026-06-07 | Use `{owner}/{dock}` refs | Shorter and clearer than URL-based install syntax. |
| 2026-06-07 | Use managed append blocks | Existing project files can be updated without overwriting user-authored content. |
| 2026-06-07 | Add `opendock: 1` manifest shape | Keeps docks concise and makes lifecycle the single command surface. |

## Progress Notes

- [2026-06-07] TypeScript package scaffolded with Commander, YAML, Zod, Vitest, and Biome.
- [2026-06-07] Local fixture install flow, update flow, project state, logging, auth, deploy no-login failure, and command allowlist were ported to TypeScript.
- [2026-06-07] Edge cases covered for invalid dock refs, idempotent managed blocks, unique `.gitignore` append, auth token file mode, newer dock updates, and failure logging.
- [2026-06-07] Added `files` policies, `lifecycle.install/update/doctor`, and the `opendock/codex` example dock.
- [2026-06-07] Final verification passed: `bun run typecheck`, `bun run test`, `bun run lint`, `bun run check`, and manual smoke for version/install/doctor/log/update/auth/deploy no-login.

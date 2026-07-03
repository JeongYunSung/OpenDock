# Dependencies QA Plan

This checklist is the source of truth for QA focused only on `dock.yml`
`dependencies`.

## Scope

`dependencies` is for package dependencies that belong to a folder copied into
the target project by a dock. It is not for command-line tools, runtime
installation, or arbitrary task commands.

In scope:

- Manifest parsing for `dependencies`.
- Supported managers and modes.
- Path safety and protected path rejection.
- Install, update, doctor, and uninstall behavior.
- Lockfile records for installed dependency sets.
- Interaction with file preflight and managed file conflict checks.
- Real package-payload shape such as an `image2html` Codex skill folder with
  `package.json` and `package-lock.json`.

Out of scope:

- Global runtime installation internals.
- `tools` command shims.
- Registry approval workflow.
- General file lifecycle tests that do not involve dependency output folders.

## Required Behavior

1. `files` are applied before `dependencies`, so copied package folders exist
   before a manager runs.
2. Task commands such as `npm install --prefix ...` remain blocked. Package
   payload installs must use `dependencies`.
3. Dependency manager commands run in the declared dependency `path`, not in the
   project root.
4. OpenDock records dependency sets in `.opendock/dock.lock.yml`.
5. Update removes old generated dependency outputs before reinstalling them.
6. Uninstall removes generated dependency outputs and then prunes empty managed
   folders.
7. Doctor reports missing dependency outputs without modifying the project.
8. Unsafe paths, protected project-control paths (`.opendock`, `.git`, `.ssh`,
   `.env*`), symlinks, symlink ancestors, files, and missing paths are rejected
   before any manager command runs.
9. File preflight failures stop before dependency manager execution.
10. Lockfile dependency paths are revalidated during update and uninstall
    cleanup, so a tampered lock cannot delete protected or outside outputs.
11. Dependency output symlinks are removed as links; their targets are not
    deleted.
12. Dependency managers use OpenDock's project command path first, so
    project-managed shims in `.opendock/bin` win over host PATH entries.
13. Dependency install failure does not save a successful dock lock record.
14. Supported managers stay constrained to their declared modes:
    - `npm`: `ci`, `install`
    - `pnpm`: `install`
    - `bun`: `install`
    - `uv`: `sync`
    - `pip`, `pip3`: `install`

## QA Matrix

| Area | Evidence |
|---|---|
| Image2HTML-style copied package | `dependencies.test.ts` installs `.codex/skills/image2html` with `npm install`. |
| File apply before dependency install | Dependency test checks `package.json` copied before fake `npm` runs. |
| Update reinstall | Dependency test deletes/stales `node_modules` and verifies update recreates output. |
| Uninstall cleanup | Dependency test verifies copied dependency folder is removed after uninstall. |
| Lock replacement | Dependency test updates from one dependency path/mode to another and verifies final lock contents. |
| Dependency failure | Dependency test verifies manager failure leaves no successful dock lock record. |
| Preflight stop | Dependency test verifies unmanaged file conflict prevents manager execution. |
| Manager modes | Dependency test covers `npm`, `pnpm`, `bun`, `uv`, `pip`, and `pip3`. |
| Project command path | Dependency test verifies `.opendock/bin` manager shims are preferred over host PATH. |
| Doctor failure | Dependency test verifies missing output is reported as failed. |
| Path safety | Dependency and deploy hardening tests reject traversal/protected/symlink/file paths and symlink ancestors. |
| Lock tamper cleanup | Dependency test verifies tampered lock paths cannot delete protected or outside outputs. |
| Output symlink cleanup | Dependency test verifies output symlinks are unlinked without deleting their targets. |
| Task policy | Command policy tests reject package install/update task commands, aliases, and dependency-based permission widening. |
| Real payload smoke | Manual QA can rewrite an existing release manifest to `dependencies` and run install/update/doctor/uninstall in a temp project. |

## Manual Smoke: Image2HTML Payload

Use this shape when checking old `image2html`-style payloads with the current
spec:

```yaml
requires:
  runtimes:
    node: ">=20.0.0"
    npm: ">=10.0.0"

dependencies:
  image2html:
    manager: npm
    path: .codex/skills/image2html
    mode: install
    timeout_ms: 600000

files:
  - from: SKILL.md
    to: .codex/skills/image2html/SKILL.md
  - from: references
    to: .codex/skills/image2html/references
  - from: scripts
    to: .codex/skills/image2html/scripts
  - from: assets/templates
    to: .codex/skills/image2html/assets/templates
  - from: package.json
    to: .codex/skills/image2html/package.json
  - from: package-lock.json
    to: .codex/skills/image2html/package-lock.json
```

Expected result:

- `install` copies the skill folder and runs `npm install --no-audit --no-fund`
  inside `.codex/skills/image2html`.
- `node_modules/sharp` and `node_modules/playwright` exist after install.
- `update` can recreate missing dependency output.
- `doctor` is Ready when dependency output exists.
- `uninstall` removes the managed skill folder and dependency output.

## Commands

Run targeted dependency QA:

```bash
cd packages/cli
bunx vitest run tests/dependencies.test.ts tests/deploy-manifest-hardening.test.ts tests/command-policy-attack-cases.test.ts --testTimeout 15000 --no-file-parallelism
```

Run full CLI regression:

```bash
cd packages/cli
bun run check
```

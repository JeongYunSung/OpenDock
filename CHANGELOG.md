# Changelog

All notable OpenDock CLI and desktop app changes are recorded here.

OpenDock uses exact package versions for CLI releases. GitHub Actions publish the
version declared in `package.json`; they do not auto-increment versions.

## Unreleased

## 0.1.21 - 2026-06-15

### Added

- Added `--events` JSONL progress output for `opendock install`, `opendock update`,
  and `opendock uninstall`.

### Desktop App

- Switched install, update, and uninstall actions to consume structured CLI progress
  events for smoother command progress dialogs.
- Updated the native contract checks to keep the desktop app on event-based command
  progress.

### Tests

- Added CLI coverage for install, update, and uninstall event streams.
- Added desktop bridge coverage for parsing progress and result events.

## 0.1.20 - 2026-06-15

### Changed

- Split the repository into a monorepo with the CLI in `packages/cli` and the
  desktop app in `apps/desktop`.
- Imported the OpenDock desktop app history into this repository under
  `apps/desktop`.
- Updated CLI packaging workflow paths for the new package layout.
- Added a desktop app build workflow for macOS and Windows release bundles.

### Desktop App

- Bundles the OpenDock CLI from `packages/cli/bin/opendock` as the Tauri sidecar.
- Enables Tauri bundling so desktop installers can be produced from this repo.

## 0.1.19 - 2026-06-15

### Changed

- Moved persistent run logging to CLI command entrypoints so install, update,
  uninstall, deploy, auth, bootstrap, doctor, list, outdated, version, and log
  record command-level outcomes.
- Added `Skipped` run status for no-op command outcomes such as no installed
  docks, no available updates, no auth token, and no logs.

### Tests

- Added command log coverage for success, failure, and skipped outcomes.

## 0.1.18 - 2026-06-15

### Added

- Added `opendock list --json` for machine-readable installed dock inventory
  output.

### Tests

- Added list JSON coverage for projects with and without OpenDock state.

## 0.1.17 - 2026-06-15

### Changed

- `opendock update --json` and `opendock uninstall --json` now return structured
  failure payloads instead of throwing plain CLI errors.

### Tests

- Added JSON failure coverage for managed-file conflicts during update and
  uninstall.

## 0.1.16 - 2026-06-15

### Added

- Added `opendock outdated` to check installed docks against the latest approved
  Registry releases.

### Changed

- `opendock update` now skips work when no installed dock has a newer approved
  Registry release.
- `opendock update` only applies docks that are actually outdated.

### Tests

- Added CLI coverage for update checks, no-op updates, and mixed current/outdated
  installed docks.

## 0.1.15 - 2026-06-15

### Added

- Added `--json` output for install, update, and uninstall change reports.

### Changed

- Extended uninstall reports with managed file change details, platform, and version metadata.

### Tests

- Added uninstall report coverage for deleted and updated managed files.

## 0.1.14 - 2026-06-12

### Added

- Added optional manifest `tags` as catalog metadata for Hub search and filtering.
- Added tags to all bundled example dock manifests for macOS and Windows.

### Changed

- Updated README and guide documentation across languages to document catalog tags.

### Tests

- Added manifest validation coverage for tag parsing, duplicate tags, invalid tags,
  and deploy archive preservation.

## 0.1.13 - 2026-06-12

### Changed

- Upgraded workspace example docks into production-ready agent payloads with
  shared root context, Codex skills, Claude Code skills, OMA-style skills, and
  Cursor rules.
- Refreshed README and guide documentation to explain the example dock payload
  structure across languages.

### Tests

- Added regression coverage that every workspace example provisions the expected
  agent context files on macOS and Windows manifests.

## 0.1.12 - 2026-06-12

### Changed

- Added TTY-aware colored CLI output for command status, file changes, list,
  doctor, log, auth, and deploy messages.

## 0.1.11 - 2026-06-12

### Changed

- Print concise file-level changes after `opendock install` and `opendock update`.
- Simplified `opendock list` output by hiding private workdir paths.

## 0.1.10 - 2026-06-12

### Added

- Added `opendock list` to show docks installed in the current project from
  `.opendock/dock.lock.yml`.

### Changed

- Updated README and guide documentation, including translated guide summaries,
  to document the new project list command.

### Tests

- Added CLI coverage for listing multiple installed docks and for empty project
  list output.

## 0.1.9 - 2026-06-12

### Fixed

- Preserve executable permissions for exported agent hook scripts.
- Keep agent runtime files under `.codex/`, `.claude/`, `.agents/`, and related
  instruction directories as exact checksum-managed files so skill frontmatter
  and hook scripts stay valid.

### Changed

- Updated the `opendock/oma` example to run `oma link claude codex` after OMA
  install/update and export the resulting Claude Code and Codex vendor files.
- Updated README and guide documentation to clarify root managed blocks versus
  exact agent runtime files.

### Tests

- Added isolated OMA export coverage for Codex skill frontmatter, Claude Code
  settings, and executable hook scripts.

## 0.1.8 - 2026-06-12

### Added

- Added `workdir.files` for seeding dock-private workdirs before install/update
  task steps run.
- Included `workdir.files[].from` entries in deploy archives.

### Changed

- Updated the `opendock/oma` example to seed `oma-config.yaml` and run
  `oma -y install` as the single generator step for Codex-ready OMA outputs.
- Updated README, guide, docs, and examples to explain `files`,
  `workdir.files`, and `export` as separate paths.

### Tests

- Added regression coverage for workdir file seeding before external command
  execution.
- Added deploy archive coverage for `workdir.files` sources.

## 0.1.7 - 2026-06-12

### Changed

- Allow safe `oma link <vendor...>` task commands.
- Update the `opendock/oma` example to run `oma link claude codex` after OMA
  install/update so Claude and Codex vendor files are generated explicitly.

### Tests

- Added command allowlist coverage for unsafe OMA link vendor arguments.
- Added OMA task coverage for Codex files generated during the link step.

## 0.1.6 - 2026-06-12

### Fixed

- Materialize internal symlinks generated inside dock workdirs during `export`
  collection instead of copying symlinks into the project root.
- Keep manifest `files` symlink rejection unchanged.
- Reject exported symlinks that resolve outside the dock workdir.

### Tests

- Added OMA export coverage for `.claude/skills` symlinked files and
  directories.
- Added regression coverage for blocking external symlink targets during export.

## 0.1.5 - 2026-06-12

### Changed

- Removed CLI package entries from `requires`.
- `requires` now handles host runtimes only.
- Package installs such as `bun install --global ...` and
  `npm install --global ...` are now explicit `install`/`update` task steps.
- Updated example docks and documentation to match the task-based package
  install model.

### Tests

- Replaced removed `requires` package coverage with task-based package install
  coverage.
- Kept example install/uninstall cleanup coverage aligned with the updated OMA
  example.

## 0.1.4 - 2026-06-12

### Fixed

- Preserve `BUN_INSTALL` when OpenDock runs allowed commands, so Bun global
  installs use the expected global install location.

### Tests

- Added regression coverage for Bun command execution with a custom
  `BUN_INSTALL` path.

## 0.1.3 - 2026-06-12

### Fixed

- Prune empty parent directories after managed files are removed during update
  or uninstall.
- Remove empty dock workdir parent directories after uninstalling task-export
  docks.
- Keep user-created files and non-empty directories intact during cleanup.

### Tests

- Added cleanup stress coverage across all example docks for macOS and Windows
  manifests.
- Added repeated install/uninstall coverage for combined example docks.
- Added task export cleanup coverage using the `opendock/oma` example with a
  fake `oma` executable.
- Increased the example cleanup stress-test timeout for slower CI runners.

## 0.1.2 - 2026-06-12

### Fixed

- Published a single executable `bin/opendock` entry for global installs.
- Removed the broken wrapper path that could resolve to a missing `opendock.js`
  after Bun global installation.
- Kept CLI version metadata aligned between `package.json` and
  `src/constants.ts`.

## 0.1.1 - 2026-06-12

### Fixed

- Bumped the GitHub Packages version after the initial package version had
  already been published.
- Added checks to keep package version metadata aligned before publishing.

## 0.1.0 - 2026-06-07

### Added

- Initial OpenDock CLI package.
- Added project install, update, doctor, log, auth, deploy, and version command
  foundations.
- Added dock manifest parsing, file application, managed blocks, project lock
  state, and Registry-oriented release flow.

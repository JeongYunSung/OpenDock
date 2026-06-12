# Changelog

All notable OpenDock CLI changes are recorded here.

OpenDock uses exact package versions for CLI releases. GitHub Actions publish the
version declared in `package.json`; they do not auto-increment versions.

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

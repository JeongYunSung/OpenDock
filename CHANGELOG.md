# Changelog

All notable OpenDock CLI changes are recorded here.

OpenDock uses exact package versions for CLI releases. GitHub Actions publish the
version declared in `package.json`; they do not auto-increment versions.

## 0.1.4 - 2026-06-12

### Fixed

- Preserve `BUN_INSTALL` when OpenDock runs allowed commands, so Bun global
  package installers and package verification use the same global install
  location.
- Fixed `require-package-oma` failing after `bun install --global
  oh-my-agent@latest` with `oh-my-agent is not installed` when users have a
  custom Bun install path.

### Tests

- Added regression coverage for Bun package installation with a custom
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

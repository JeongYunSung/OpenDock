<div align="center">

<img src="./packages/cli/assets/opendock-logo-96.png" alt="OpenDock logo" width="96">

# OpenDock

**Simple AI setup for every workspace.**

</div>

OpenDock is managed as a monorepo.

- `packages/cli` contains the OpenDock CLI, dock format, examples, and CLI documentation.
- `apps/desktop` contains the OpenDock desktop app.
- `CHANGELOG.md` records product-level CLI and desktop changes.

## Packages

| Package | Purpose |
|---|---|
| `packages/cli` | Install, update, uninstall, deploy, and inspect OpenDock docks. |
| `apps/desktop` | Cross-platform desktop app that bundles the CLI as a sidecar. |

## Development

```bash
bun install
bun run check:cli
bun run verify:desktop
```

## Releases

- CLI package publishing is handled by `.github/workflows/publish-github-package.yml`.
- Desktop bundles are built by `.github/workflows/build-desktop.yml` for macOS
  and Windows, then attached as workflow artifacts and release assets.

CLI-only development:

```bash
cd packages/cli
bun run build
bin/opendock version
```

Desktop app development:

```bash
cd apps/desktop
bun run dev
```

# Oh My Agent

Install Oh My Agent and export its generated project setup through OpenDock.

This dock declares Bun and the `oh-my-agent` package in `requires`, runs
`oma -y install` inside the dock-private workdir, and exports generated agent
files back to the project through OpenDock-managed blocks and checksums.

Use it when a project should start from Oh My Agent while still letting OpenDock track the root files that were produced.

# Oh My Agent

Install Oh My Agent and apply its default full project setup.

This dock checks for Bun, installs the `oh-my-agent` CLI, runs `oma -y install`
in the project directory, and verifies the result with `oma doctor`.

Use it when a project should be configured through Oh My Agent without shipping
additional project file payloads in the dock.

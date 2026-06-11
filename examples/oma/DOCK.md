# Oh My Agent

Install Oh My Agent and export its generated project setup through OpenDock.

This dock declares Bun as a required runtime, installs `oh-my-agent` through an
explicit task, seeds an OMA `model_preset: codex` config into the dock-private
workdir, runs `oma -y install`, and exports generated Codex agent files and
skills back to the project through OpenDock-managed blocks and checksums.

Use it when a project should start from Oh My Agent while still letting OpenDock track the root files that were produced.

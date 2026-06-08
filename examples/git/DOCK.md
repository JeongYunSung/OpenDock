# Git

Install Git and initialize the current directory as a `main` branch repository.

## What this dock does

- Verifies Git with `git --version`.
- Installs Git on macOS with Homebrew when needed.
- Installs Git on Windows with `winget` when needed.
- Runs `git init -b main` for new project folders.

## Keep it updated

Run `opendock update` from the project directory to refresh the Git package through the platform-specific package manager and verify the installed version again.

## Doctor checks

`opendock doctor` checks both the Git binary and whether the current directory is a Git project.

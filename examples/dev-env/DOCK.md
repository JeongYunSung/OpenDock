# Dev Env

Add project-local tool version and validation task references.

This dock adds a `mise.toml` with common runtime pins and repeatable task names for install, lint, test, build, and doctor. It does not install mise automatically.

Combine it with tool docks and role docks when agents need an explicit validation surface before editing code.

# Developer Environment

This project uses `mise.toml` as the visible source for runtime versions and
repeatable tasks.

Recommended flow:

1. Install mise with the team's approved method.
2. Run `mise trust` if your local policy requires it.
3. Run `mise install`.
4. Run `mise run doctor` before handing work back.

Adjust task commands to match the actual package manager before enforcing them.

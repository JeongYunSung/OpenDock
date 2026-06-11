# MCP Safety Notes

MCP servers can expose local files, network APIs, and account data. Treat every
server as a privileged integration.

- Enable only reviewed servers.
- Prefer read-only scopes where possible.
- Keep tokens in the client secret store or environment.
- Do not commit generated credentials, session IDs, or local paths.
- Re-review server commands after dependency updates.

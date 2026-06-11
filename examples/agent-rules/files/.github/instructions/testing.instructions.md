---
applyTo: "**/*.{test,spec}.{ts,tsx,js,jsx}"
---

# Testing Instructions

- Test observable behavior, not implementation details.
- Keep fixtures small and named after the scenario they cover.
- Add regression tests for bug fixes.
- Avoid broad snapshots when a direct assertion is clearer.

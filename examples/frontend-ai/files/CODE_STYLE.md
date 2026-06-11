# Code Style

## TypeScript

- Avoid `any` unless the boundary is intentionally untyped.
- Prefer discriminated unions for state machines.
- Keep parsing and validation near input boundaries.

## React

- Keep effects minimal and explain why they are needed.
- Derive state when possible.
- Avoid hidden global state.

## Testing

- Test user-visible behavior.
- Add regression tests for bug fixes.

# Database Guide

## Change Rules

- Explain the domain invariant before changing schema.
- Include migration, rollback, index, and backfill notes.
- Check transaction boundaries and concurrency risks.
- Avoid hidden coupling between persistence and API shape.

## Review Questions

- What can grow without a migration?
- What query needs an index?
- What data must never be deleted silently?

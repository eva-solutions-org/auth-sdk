# ADR-014: Public Package Scope Rename

## Status

Accepted — 2026-05-16

## Context

The internal package name `@eva/auth-sdk` had never been published. The `@eva` npm scope is already owned by an unrelated party. To publish publicly, we need a scope under our control.

We created the npm organization `eva_solutions` at `https://www.npmjs.com/settings/eva_solutions/packages`.

## Decision

Rename the package to **`@eva_solutions/auth-sdk`** for the public release.

- Initial version: `1.0.0` (carries over from internal v1.0.0 — already stable, no premature 0.x bump).
- No deprecated mirror under `@eva/auth-sdk` is required because the original name was never published.
- All internal references (JSDoc, docs, README) updated to the new scope.

## Consequences

### Positive

- Clear ownership and branding under `eva_solutions` org.
- Aligns with GitHub org `eva-solutions-org` (consistent identity).

### Negative / minor

- One-time consumer awareness needed: internal consumers must update their `package.json` from `@eva/auth-sdk` to `@eva_solutions/auth-sdk`. Migration note in `docs/migration.md`.

### Mitigation

- `docs/migration.md` documents the rename explicitly.

## References

- Proposal: `sdd/sdk-public-release/proposal` (Engram, v2)
- D-02 (scope rename)
- Q-E05 (no deprecated mirror needed)
- Org URL: `https://www.npmjs.com/settings/eva_solutions/packages`

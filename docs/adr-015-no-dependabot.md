# ADR-015: No Dependabot — Manual Dependency Management

## Status

Accepted — 2026-05-16

## Context

When configuring the public OSS release infrastructure (see [ADR-013](./adr-013-oss-model.md) and [ADR-014](./adr-014-package-scope.md)), we initially configured Dependabot for both `npm` and `github-actions` ecosystems, opening PRs weekly with version updates.

This SDK is the official TypeScript client for the EVA Auth Service. It handles JWT verification, JWKS rotation, cookie-based session management, S2S HMAC signing, and webhook signature verification — security-critical code paths where a silent dependency update can introduce subtle vulnerabilities or behavior changes.

## Decision

**Remove Dependabot.** Dependency updates are handled manually by the maintaining team:

- The team monitors upstream releases on its own cadence.
- Updates are evaluated for security impact, behavioral changes, and breaking risk before being applied.
- Each update goes through a regular PR cycle with human review of the changelog, threat model, and downstream impact.

This applies to both runtime dependencies (`dependencies` in `package.json`) and CI infrastructure (GitHub Actions versions pinned by SHA — see [SECURITY.md](../SECURITY.md) and the release workflow).

### GitHub Security Advisories remain enabled

This decision does NOT disable GitHub's built-in security advisories. Those are independent from Dependabot configuration and continue to surface CVEs in our dependency graph. The team triages and acts on those alerts manually.

## Consequences

### Positive

- Human gate on every dependency change in a security-critical SDK.
- No noise from automated PRs that would need manual close/rebase anyway.
- Reduced surface for prompt-injection-style attacks via compromised dependencies (an attacker pushing a malicious version cannot leverage an auto-merging Dependabot config).
- Cleaner PR queue — only PRs the team explicitly cares about.

### Negative / risks

- Dependencies can drift behind upstream if the team forgets to check.
- Security patches require active monitoring of GitHub Security Advisories, npm audit, or upstream release notes.

### Mitigations

- Periodic dependency audit as part of the maintenance cadence (recommended: monthly review).
- GitHub Security Advisories surface CVEs automatically — the team responds within the SECURITY.md disclosure window.
- `pnpm audit` can be run locally or in a scheduled workflow if proactive scanning is desired (not added by this ADR).

## References

- Removed file: `.github/dependabot.yml`
- Related ADRs: [ADR-013 OSS Model](./adr-013-oss-model.md), [ADR-014 Package Scope](./adr-014-package-scope.md)
- Related policy: [SECURITY.md](../SECURITY.md)

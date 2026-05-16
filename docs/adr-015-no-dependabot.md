# ADR-015: Dependabot — GitHub Actions Only, No npm

## Status

Accepted — 2026-05-16 (revised same day to refine scope)

## Context

When configuring the public OSS release infrastructure (see [ADR-013](./adr-013-oss-model.md) and [ADR-014](./adr-014-package-scope.md)), we evaluated Dependabot for two distinct ecosystems:

- **npm** — runtime and development dependencies of the SDK package (`package.json`).
- **github-actions** — versions of third-party Actions used in CI/release workflows (pinned by SHA).

These are different in nature:

- npm dependencies execute inside the published SDK at runtime in consumer applications. A bump can introduce subtle vulnerabilities, breaking changes, or behavior shifts in security-critical code paths (JWT verification, JWKS rotation, cookie management, S2S signing, webhook verification).
- GitHub Actions execute only in CI runners during build and release. They never reach published artifacts. Their main risk vector is supply-chain compromise — mitigated by SHA pinning (see [Supply Chain Hardening](https://github.com/eva-solutions-org/auth-sdk/blob/main/.github/workflows/release.yml) and the workflow files). The SHAs need periodic refresh as upstream Actions ship new versions.

## Decision

Use Dependabot **only** for the `github-actions` ecosystem. Do **not** use Dependabot for `npm`.

### npm (NOT managed by Dependabot)

- Runtime and dev dependencies are reviewed and updated **manually** by the maintaining team.
- The team monitors upstream releases on its own cadence.
- Each bump goes through a regular PR cycle with human review of:
  - Upstream changelog.
  - Security impact (CVE database, GHSA).
  - Behavioral and breaking changes.
  - Downstream consumer impact.

### github-actions (managed by Dependabot)

- Weekly schedule.
- Dependabot detects new versions of pinned Actions (e.g. `changesets/action@<SHA>`) and opens a PR with the updated SHA.
- Team reviews the changelog of the Action and the SHA diff before merging.
- Pinning policy (SHA 40-hex for third-party Actions, `@v4` for official GitHub Actions) remains enforced.

### GitHub Security Advisories

Independent from this ADR. Remain enabled at the repo level. Surface CVEs in the npm dependency graph without Dependabot configuration. Team triages alerts manually.

## Consequences

### Positive

- Human gate on every npm dependency change in a security-critical SDK.
- No noise from automated npm PRs that would require manual close/rebase anyway.
- Action SHAs stay up to date without manual scanning — the highest-frequency maintenance task is automated where it makes sense.
- Reduced surface for prompt-injection-style attacks via compromised npm dependencies.

### Negative / risks

- npm dependencies can drift behind upstream if the team forgets to check — mitigated by GitHub Security Advisories and periodic manual audit.
- Dependabot PRs for Actions still need human review (mandatory) — Action upgrades can introduce breaking changes in workflow steps.

### Mitigations

- Monthly cadence for manual npm dependency audit (`pnpm audit`, `npm outdated`).
- GitHub Security Advisories surface CVEs in npm deps automatically — team responds within the SECURITY.md disclosure window.
- Action SHA bumps via Dependabot still require human review; never auto-merge.

## References

- `.github/dependabot.yml` (configured for `github-actions` only).
- Related ADRs: [ADR-013 OSS Model](./adr-013-oss-model.md), [ADR-014 Package Scope](./adr-014-package-scope.md).
- Related policy: [SECURITY.md](../SECURITY.md).
- Workflows that benefit from Action SHA updates: `.github/workflows/release.yml`, `.github/workflows/ci.yml`.

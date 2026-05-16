# ADR-013: Public OSS Release Model

## Status

Accepted — 2026-05-16

## Context

The `@eva/auth-sdk` package was developed as a private internal client for the EVA Auth Service. After reaching v1.0.0 stability (488 tests passing, 100% endpoint coverage), we needed to decide whether and how to release it publicly.

The Auth Service itself remains a private repository for security and operational reasons. The SDK consumes the Auth Service strictly over HTTP and JWKS — no internal service code is exposed.

## Decision

Release the SDK as **fully open source** under the MIT License:

- **Repository**: public at `github.com/eva-solutions-org/auth-sdk`
- **Distribution**: npm public registry under `@eva_solutions/auth-sdk` (org `eva_solutions`)
- **License**: MIT (permissive, broad adoption pattern for TS/JS auth SDKs)
- **Contribution model**: open contributions, Contributor Covenant v3.0 Code of Conduct
- **Positioning**: "Official TypeScript client for the EVA Auth Service" — the SDK is not generic; it targets the EVA Auth Service specifically (hardcoded `aud: 'proyecto-global'`, `iss: 'auth-service'` in JWT verification).
- **Provenance**: npm trusted publishing via OIDC from GitHub Actions

## Consequences

### Positive

- Public auditability of the SDK code increases trust and adoption.
- MIT enables both individual and corporate use without legal friction.
- npm provenance attestation provides supply-chain transparency.
- Open contribution model can surface bugs and improvements faster.

### Negative / risks

- Public exposure of the SDK API contract — any breaking change becomes a community concern.
- Maintenance burden: issues, PRs, security advisories require timely response.
- Auth Service privacy must be maintained through the SDK boundary — runtime behavior cannot leak internals.
- Trademark "EVA" is generic; legal due diligence (USPTO/EUIPO) is the user's responsibility prior to aggressive marketing.

### Mitigations

- `SECURITY.md` defines the disclosure process via GitHub Security Advisories.
- `CONTRIBUTING.md` standardizes the PR + changeset workflow.
- CI workflow includes publish dry-run and no-console checks to catch regressions before release.

## References

- Proposal: `sdd/sdk-public-release/proposal` (Engram, v2)
- Q-E01 Licencia (MIT)
- Q-E13 JWT_CONFIG hardcoded (intentional — SDK is EVA-specific)
- D-01, D-04 (OSS + MIT)

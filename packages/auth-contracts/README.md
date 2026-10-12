# @eva_solutions/auth-contracts

Shared API contract of the EVA Auth Service: the wire shapes that the Auth API and the SDK must agree on, defined once.

> **Private package.** `"private": true`: it is never published to npm on its own, and its version (`0.1.0`) is not bumped by changesets. It is meant to be bundled into `@eva_solutions/auth-sdk` and consumed by the Auth API through the SDK, not installed directly.

> **Skeleton.** Only the route-descriptor types and `API_PREFIX` exist today. The request/response schemas and constants are added slice by slice; this README describes what is in `src/` now.

## What is exported today

From `src/index.ts` (re-exports `src/routes.ts`):

| Export | Kind | Meaning |
|--------|------|---------|
| `API_PREFIX` | const `'/api/v1'` | Version prefix of every Auth route except the root ones (JWKS, health, docs UI) |
| `HttpMethod` | type | `'get' \| 'post' \| 'patch' \| 'delete'` |
| `RouteDescriptor` | type | `{ method, path }`: a route as data. `path` is relative to `API_PREFIX` and uses the OpenAPI template form (`/sessions/{id}`) |

The contract describes routes only as data. Request handling, middleware and the full OpenAPI route definitions stay in the API.

## Rules for this package

- ESM only, `"sideEffects": false`.
- `zod` is a **peer dependency** (`^4.4.3`), so the consumer decides the copy. A consumer must resolve exactly one `zod` version, otherwise schema types stop being compatible with `@hono/zod-openapi`.
- No `hono`, no Drizzle, no runtime dependencies.
- The source is public (this is a public repo). Allowed: shapes, validation rules, error and event codes, scope names, header names, route `{ method, path }`. **Never** put hostnames, URLs, secrets, peppers, keys, rate-limit thresholds, infrastructure topology or real phone numbers or IDs in examples.

`tests/constants.test.ts` checks the manifest flags, the dependency denylist and the source denylist.

## Scripts

Run from the repo root (see [CONTRIBUTING.md](../../CONTRIBUTING.md)): `pnpm run build:contracts` builds this package, and the root `type-check` and `test:run` build it first. Inside the package: `build` (tsdown), `type-check`, `test:run` (Vitest).

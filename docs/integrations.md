# Integrations — how the SDK fits a consuming system

`@eva_solutions/auth-sdk` is a **runtime-configured contract** shared between the Auth Service and the applications that use it: each consumer installs the same npm release and passes its own Auth Service URL at boot. This page documents what the SDK **exposes** to consumers, and how a change to it must propagate. Each consumer documents its own installation and usage in its own repo.

## Roles

| Role | What it does | How it uses the SDK |
|------|--------------|---------------------|
| **Auth Service** | Server. Issues JWTs (ES256), serves the JWKS, exposes the `/internal/*` S2S endpoints. Not part of this repo (see [adr-013-oss-model.md](adr-013-oss-model.md)). | Server-side S2S verification (`s2sAuth`) and request signing (`signS2SRequest`). |
| **Auth - SDK** (this repo) | Client library: JWT cookie middleware, auth proxy routes, S2S client and verifier. | — |
| **App backend** | Any service that protects its routes with JWT cookies and/or calls the Auth Service over S2S. | JWT cookie middleware, auth proxy routes and S2S client. |

## What the SDK exposes

### Entry points by kind of consumer

| Kind of consumer | Entry point | Typical symbols | Purpose |
|------------------|-------------|-----------------|---------|
| Server verifying S2S requests | `@eva_solutions/auth-sdk/hono` | `s2sAuth`, type `S2sAuthVariables`, `requireScope` | Verifies HMAC-signed S2S requests on `/internal/*`-style routes. |
| Server signing outbound S2S calls | `@eva_solutions/auth-sdk/s2s` | `signS2SRequest` | Signs a request to another service that verifies with `s2sAuth`. |
| App backend (root) | `@eva_solutions/auth-sdk` | `configureEvaAuth`, `createS2SClient`, `getAuthUrl`, `COOKIES`, `isNotFound`, `matchError`, `isNetworkError`, types `S2SClient`, `EvaError`, `EvaTokenPayload` | Boot config, S2S client (for example `getUser`), cookie name constants, error narrowing. |
| App backend (Hono) | `@eva_solutions/auth-sdk/hono` | `evaAuth`, `evaAuthRoutes`, `s2sAuth`, `requireScope` | JWT cookie middleware on protected routes, auth proxy routes mounted under a prefix of the consumer's choice, S2S verification with scopes. |

All published entry points are listed in `package.json` `exports`: `.`, `./hono`, `./generic`, `./react`, `./hono-openapi`, `./webhooks`, `./admin`, `./s2s`. Their API is documented in [api.md](api.md).

### Contract points

These are the values the SDK and the Auth Service must agree on. Changing any of them is a coordinated change across repos.

| Contract | Value | Defined in |
|----------|-------|------------|
| Access cookie name | `eva_access_token` (max age 15 min) | `src/constants.ts` (`COOKIES`, `COOKIE_MAX_AGE`) |
| Refresh cookie name | `eva_refresh_token` (max age 30 days) | `src/constants.ts` |
| JWT issuer / audience / algorithm | `auth-service` / `proyecto-global` / `ES256` | `src/constants.ts` (`JWT_CONFIG`) |
| JWKS location | `<auth url>/.well-known/jwks.json`, fetched at runtime | `src/jwks.ts` |
| S2S headers | `X-Eva-Client-Id`, `X-Eva-Timestamp`, `X-Eva-Signature` (`sha256=` prefix) | [api.md, section S2S](api.md#eva_solutionsauth-sdks2s) |
| S2S canonical string | `METHOD`, path, **canonicalized** query (decoded, sorted by name then value, RFC 3986 re-encoded), timestamp, client id, `sha256(body)`, joined by newlines (`canonicalizeQuery` in `src/s2s/sign.ts`) | [api.md, section S2S](api.md#eva_solutionsauth-sdks2s) |
| Auth proxy routes (`evaAuthRoutes()`) | `POST /get-code`, `/login`, `/refresh`, `/logout`; `GET /me`, `/empresas`, `/sessions` (plus the `PATCH`/`DELETE` variants in `src/auth-handlers.ts`) | `src/hono/auth-routes.ts` |
| Wire error shape | `{ error: { code, message } }` by default (`errorWire: 'api'`) | [configuration.md](configuration.md), [migration.md](migration.md) |

The SDK sets the access and refresh cookies in the **consumer's own domain**. Runtime configuration (`cookieDomain`, `errorMessages`, `errorWire`) is documented in [configuration.md](configuration.md); do not repeat it here.

## The Auth URL is configured at runtime

**One npm package for every environment.** The Auth Service URL is not part of the artifact: each consumer passes it once at boot with `configureEvaAuth({ authUrl })`, and `getAuthUrl()` in `src/config.ts` returns it. Rationale: ADR-017 in [decisions.md](decisions.md) (it supersedes the build-time model of the decisions-log ADR-013; note there are two documents named ADR-013).

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'

configureEvaAuth({ authUrl: process.env.AUTH_URL }) // before the first request
```

| Rule | Detail |
|------|--------|
| Accepted | `https://host`, `https://host/path`, and `http` only on loopback (`localhost`, `127.0.0.0/8`, `[::1]`) |
| Rejected | Remote `http`, malformed or non-string values, schemes other than http/https, userinfo, query and fragment (including a lone `?` or `#`). Messages never echo the value |
| Normalized | Lowercase host, no trailing `/` |
| Immutable | Same normalized value again is a no-op; a different value throws |
| Missing | `getAuthUrl()` throws an error named `EvaAuthConfigError`; `authFetch` and `verifyAccessToken` propagate it, so the consumer answers **500**, never 401, and no cookies are cleared |
| Module formats | ESM and CJS builds keep separate config state; configure the format that serves requests |

Implications for consumers:

- The same installed package can serve any environment: change the `authUrl` you pass, not the package.
- `getAuthUrl()` is the supported way to read the configured URL (for example to pass it as `baseUrl` to `createS2SClient`). It throws if `authUrl` was never configured.
- `createS2SClient` and `createAdminClient` throw if `baseUrl` is `http:` and not loopback, so a local `http://localhost` URL only works against `localhost`, `127.x.x.x` or `[::1]`.
- Session cookies are always `Secure`. Safari drops them on `http://localhost`, so local development uses https.

Options, accepted forms and the config-error behavior: [configuration.md](configuration.md#url-del-auth-service). Upgrading from 2.x: [migration.md](migration.md).

## Distribution and propagation

| Channel | How | Used for |
|---------|-----|----------|
| **npm** | Push to `main` runs `.github/workflows/release.yml`: `changesets/action` opens a Version PR and, when it is merged, publishes with `pnpm exec changeset publish` (provenance requested through `PNPM_CONFIG_PROVENANCE`). `prepublishOnly` lints, type-checks, tests and builds before publishing. | Every release. One artifact for all environments. |
| **Local tarball** | `pnpm run build` then `pnpm pack` writes `eva_solutions-auth-sdk-<version>.tgz` in the repo root. `*.tgz` is git-ignored. | Trying unreleased SDK changes in a consumer. |

The publish credentials and the maintainer steps (including the one-time bootstrap) are in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing-maintainers).

Current released version: **2.0.1** (`package.json`, [CHANGELOG.md](../CHANGELOG.md)); the 3.0.0 release described here is pending its Version PR.

### How each consumer installs it

Each consumer documents its own install method, location and pinned version in its own repo. This repo only owns the package contract and the release steps below.

### What a consumer must configure

Entry points that **call** the Auth Service need `authUrl`: JWKS fetching (`src/jwks.ts`), the auth proxy routes (`src/http-client.ts`), and `getAuthUrl()` itself. `signS2SRequest`, `verifyS2SRequest` and the `s2sAuth` middleware (`src/s2s/sign.ts`, `src/s2s/verify.ts`, `src/hono/s2s.ts`) do not import `config.ts`, and `createS2SClient` takes `baseUrl` as an argument.

Rule for consumers:

- If the consumer calls the Auth Service (JWT/JWKS verification, `evaAuthRoutes()`, or the S2S client with `getAuthUrl()`), call `configureEvaAuth({ authUrl })` at boot.
- If the consumer only uses server-side `s2sAuth` and/or `signS2SRequest`, `authUrl` is not needed.

## Releasing a breaking or minor change

A change to an exposed contract above is not done until the consumers run it. Checklist:

- [ ] Add a changeset (`pnpm changeset`): `major` for a breaking change, `minor` for an additive one.
- [ ] Update [migration.md](migration.md) for breaking changes, and [api.md](api.md) / [configuration.md](configuration.md) for changed API or config (link, do not duplicate).
- [ ] Merge to `main`; the release workflow opens the Version PR (`changeset version`) and, once that PR is merged, publishes. Follow the maintainer steps in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing-maintainers).
- [ ] Each consumer updates its pinned version and lockfile, following the install method documented in its own repo, and passes `authUrl` if it did not before.
- [ ] Each consumer runs its tests. They mock or exercise the SDK, so a signature or error-shape change fails there first.

## What the SDK consumes from the Auth Service

The SDK calls the Auth Service at the configured `authUrl`: the JWKS (`/.well-known/jwks.json`) to verify access tokens, the user-facing auth endpoints behind `evaAuthRoutes()` (`login`, `login/get-code`, `login/refresh`, `login/logout`, `user`, `user/empresas`, `sessions`, `health`; `src/http-client.ts`), and the S2S client's `/internal/users/*` and `/internal/webhooks/*` endpoints (`src/s2s/client.ts`, table in [api.md](api.md#eva_solutionsauth-sdks2s)). The Auth Service owns these endpoints, their scopes and their behavior.

## Verification sources

Facts above were checked against: `package.json`, `src/config.ts`, `src/constants.ts`, `src/cookies.ts`, `src/jwks.ts`, `src/http-client.ts`, `src/auth-handlers.ts`, `src/hono/auth-routes.ts`, `src/hono/s2s.ts`, `src/s2s/sign.ts`, `src/s2s/verify.ts`, `src/s2s/client.ts`, `.github/workflows/release.yml`, `.gitignore`.

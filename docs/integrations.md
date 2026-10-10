# Integrations — how the SDK fits a consuming system

`@eva_solutions/auth-sdk` is a **build-time-configured contract** shared between the Auth Service and the applications that use it: each consumer installs one tarball (or npm release) built for one environment. This page documents what the SDK **exposes** to consumers, and how a change to it must propagate. Each consumer documents its own installation and usage in its own repo.

## Roles

| Role | What it does | How it uses the SDK |
|------|--------------|---------------------|
| **Auth Service** | Server. Issues JWTs (ES256), serves the JWKS, exposes the `/internal/*` S2S endpoints. Not part of this repo (see ADR-013 in [decisions.md](decisions.md)). | Server-side S2S verification (`s2sAuth`) and request signing (`signS2SRequest`). |
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

## The Auth URL is baked at build time

**One tarball per environment.** The Auth Service URL is a compile-time constant (`__EVA_AUTH_URL__`), read by `getAuthUrl()` in `src/config.ts`. It cannot be changed at runtime: `configureEvaAuth({ authUrl })` was removed in 2.0.0 and `process.env.EVA_AUTH_URL` is ignored (see [CHANGELOG.md](../CHANGELOG.md), entry 2.0.0, and ADR-013 in [decisions.md](decisions.md)).

| Script | `EVA_BUILD_ENV` | Baked URL (from `tsdown.config.ts`) |
|--------|-----------------|--------------------------------------|
| `pnpm build:local` / `pnpm pack:local` | `local` | `http://localhost:4000` |
| `pnpm build:dev` | `development` | `https://auth-dev.example.com` |
| `pnpm build:prod` (and plain `pnpm build`) | `production` | `https://auth.example.com` |

Implications for consumers:

- A consumer cannot point the same installed package at another environment. To change environment, install a different build.
- `getAuthUrl()` is the supported way for a consumer to read the baked URL (for example to pass it as `baseUrl` to `createS2SClient`).
- `createS2SClient` and `createAdminClient` throw if `baseUrl` is `http:` and not loopback, so a `local` build only works against `localhost`, `127.x.x.x` or `[::1]`.
- The `example.com` URLs in `tsdown.config.ts` are marked there as placeholders ("replaced with real URLs in the published packages"). A tarball built from this repo as-is bakes those placeholder hosts, not a real deployment.

How the build mechanics and scripts work: [configuration.md, build section](configuration.md).

## Distribution and propagation

| Channel | How | Used for |
|---------|-----|----------|
| **npm** | Push to `main` runs `.github/workflows/release.yml`: `pnpm run build:prod`, then `changesets/action` publishes with `npm publish --provenance --access public` (OIDC trusted publishing). | Production-grade releases. Always the `production` build. |
| **Local tarball** | `pnpm pack:local` (= `build:local` + `pnpm pack`) writes `eva_solutions-auth-sdk-<version>.tgz` in the repo root. `*.tgz` is git-ignored. | Local development against `http://localhost:4000`, and consumers that never use the baked URL (see [Which build a consumer needs](#which-build-a-consumer-needs)). |

Current released version: **2.0.1** (`package.json`, [CHANGELOG.md](../CHANGELOG.md)).

### How each consumer installs it

Each consumer documents its own install method, location and pinned version in its own repo. This repo only owns the package contract and the release steps below.

### Which build a consumer needs

The baked URL (`config.ts`, read through `getAuthUrl()` / `getAuthServiceUrl()`) is used only by entry points that **call** the Auth Service: JWKS fetching (`src/jwks.ts`), the auth proxy routes (`src/http-client.ts`), and `getAuthUrl()` itself, which a consumer may pass as `baseUrl` to `createS2SClient`. `signS2SRequest`, `verifyS2SRequest` and the `s2sAuth` middleware (`src/s2s/sign.ts`, `src/s2s/verify.ts`, `src/hono/s2s.ts`) do not import `config.ts`, and `createS2SClient` takes `baseUrl` as an argument.

Rule for consumers:

- If the consumer calls the Auth Service (JWT/JWKS verification, `evaAuthRoutes()`, or the S2S client with `getAuthUrl()`), install the **per-environment** build (`dev` or `prod`). A `local` build is for localhost only.
- If the consumer only uses server-side `s2sAuth` and/or `signS2SRequest`, the baked URL is irrelevant, so a `local` tarball is safe there.

## Releasing a breaking or minor change

A change to an exposed contract above is not done until the consumers run it. Checklist:

- [ ] Add a changeset (`pnpm changeset`): `major` for a breaking change, `minor` for an additive one.
- [ ] Update [migration.md](migration.md) for breaking changes, and [api.md](api.md) / [configuration.md](configuration.md) for changed API or config (link, do not duplicate).
- [ ] Merge to `main`; the release workflow opens the version PR and publishes (`pnpm version` runs `changeset version`).
- [ ] Rebuild the tarball for each environment that has a consumer (`build:local`, `build:dev`, `build:prod`; `pack:local` for local).
- [ ] Each consumer updates its pinned version (new tarball or npm version) and lockfile, following the install method documented in its own repo.
- [ ] Each consumer runs its tests. They mock or exercise the SDK, so a signature or error-shape change fails there first.

## What the SDK consumes from the Auth Service

The SDK calls the Auth Service at the baked URL: the JWKS (`/.well-known/jwks.json`) to verify access tokens, the user-facing auth endpoints behind `evaAuthRoutes()` (`login`, `login/get-code`, `login/refresh`, `login/logout`, `user`, `user/empresas`, `sessions`, `health`; `src/http-client.ts`), and the S2S client's `/internal/users/*` and `/internal/webhooks/*` endpoints (`src/s2s/client.ts`, table in [api.md](api.md#eva_solutionsauth-sdks2s)). The Auth Service owns these endpoints, their scopes and their behavior.

## Verification sources

Facts above were checked against: `package.json`, `tsdown.config.ts`, `src/config.ts`, `src/constants.ts`, `src/jwks.ts`, `src/http-client.ts`, `src/auth-handlers.ts`, `src/hono/auth-routes.ts`, `src/hono/s2s.ts`, `src/s2s/sign.ts`, `src/s2s/verify.ts`, `src/s2s/client.ts`, `.github/workflows/release.yml`, `.gitignore`.

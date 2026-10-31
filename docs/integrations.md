# Integrations — how the SDK fits a consuming system

`@eva_solutions/auth-sdk` is a **runtime-configured contract** shared between the Auth Service and the applications that use it: each consumer installs the same npm release and passes its own Auth Service URL at boot. This page documents what the SDK **exposes** to consumers, and how a change to it must propagate. Each consumer documents its own installation and usage in its own repo.

## Roles

| Role | What it does | How it uses the SDK |
|------|--------------|---------------------|
| **Auth Service** | Server. Issues JWTs (ES256), serves the JWKS, exposes the `/api/v1/internal/*` S2S endpoints. Not part of this repo (see [adr-013-oss-model.md](adr-013-oss-model.md)). | Server-side S2S verification (`s2sAuth`) and request signing (`signS2SRequest`). |
| **Auth - SDK** (this repo) | Client library: JWT cookie middleware, auth proxy routes, S2S client and verifier. | — |
| **App backend** | Any service that protects its routes with JWT cookies and/or calls the Auth Service over S2S. | JWT cookie middleware, auth proxy routes and S2S client. |

## What the SDK exposes

### Entry points by kind of consumer

| Kind of consumer | Entry point | Typical symbols | Purpose |
|------------------|-------------|-----------------|---------|
| Service verifying a service token | `@eva_solutions/auth-sdk/hono` (or `/s2s` for the function) | `serviceTokenAuth`, type `ServiceTokenAuthVariables`, `verifyServiceToken` | Verifies the `Authorization: Bearer` service token (`typ: svc-at+jwt`, `kid` `svc-`, `aud` of this service) on `/internal/*`-style routes. Needs no `product`. |
| Service calling Auth or another service | `@eva_solutions/auth-sdk/s2s` | `createServiceTokenProvider`, `createS2SClient`, `signS2SHeaders`, `generateS2SNonce` | The provider gets and renews the service token (HMAC-signed request to `/internal/token`); `createS2SClient` sends it as Bearer and retries once after a 401. |
| Server verifying HMAC-signed requests | `@eva_solutions/auth-sdk/hono` | `s2sAuth`, type `S2sAuthVariables`, `requireScope` | Only for the surfaces that keep HMAC: the Auth Service token endpoint and `/admin`. |
| App backend (root) | `@eva_solutions/auth-sdk` | `configureEvaAuth`, `createS2SClient`, `createServiceTokenProvider`, `getAuthUrl`, `getCookieNames`, `isNotFound`, `matchError`, `isNetworkError`, types `S2SClient`, `EvaError`, `EvaTokenPayload` | Boot config, S2S client (for example `getUser`), cookie name constants, error narrowing. |
| App backend (Hono) | `@eva_solutions/auth-sdk/hono` | `evaAuth`, `evaAuthRoutes`, `s2sAuth`, `requireScope`, `serviceTokenAuth` | JWT cookie middleware on protected routes, auth proxy routes mounted under a prefix of the consumer's choice, S2S verification with scopes. |

All published entry points are listed in `package.json` `exports`: `.`, `./hono`, `./generic`, `./react`, `./hono-openapi`, `./webhooks`, `./admin`, `./s2s`, `./contracts`. Their API is documented in [api.md](api.md). `./contracts` is the shared wire contract (schemas, constants and route descriptors) that the Auth Service API imports.

### Contract points

These are the values the SDK and the Auth Service must agree on. Changing any of them is a coordinated change across repos.

| Contract | Value | Defined in |
|----------|-------|------------|
| Access cookie name | `eva_<product>_access_token` (max age 15 min) | `packages/auth-sdk/src/constants.ts` (`getCookieNames`, `COOKIE_MAX_AGE`) |
| Refresh cookie name | `eva_<product>_refresh_token` (max age 30 days) | `packages/auth-sdk/src/constants.ts` |
| User access token | ES256, header `typ: at+jwt` and `kid` `usr-…`; claims `iss: auth-service`, `aud` = the product, `client_id` = the product, `sub`, `sessionId`, `empresa` (optional, active company). Verified by `verifyAccessToken`. | `packages/auth-sdk/src/jwt.ts`, `packages/auth-contracts/src/tokens.ts` |
| Product in the login | `POST /login` carries `producto` (always from `configureEvaAuth({ product })`, never from the browser) and optional `empresaId`; `get-code` carries neither. `POST /auth/empresa-activa { empresaId \| null }` switches the active company. | `packages/auth-contracts/src/auth.ts`, `packages/auth-sdk/src/http-client.ts` |
| JWKS location | `<auth url>/.well-known/jwks.json` (root of the Auth Service, not under `/api/v1`), fetched at runtime, cached 10 min. Two key types: `kid` `usr-<thumbprint>` (user) and `svc-<thumbprint>` (service); a token without `kid` is rejected. | `packages/auth-sdk/src/jwks.ts` |
| Auth Service route prefix | `/api/v1` on every route except JWKS, `/health`, `/ui` and `/doc`. Added by `apiPath()`; `authUrl` does not include it. | `packages/auth-contracts/src/routes.ts` (`API_PREFIX`), `packages/auth-sdk/src/api-path.ts` |
| S2S headers | `X-Eva-Client-Id`, `X-Eva-Timestamp`, `X-Eva-Nonce` (32 lowercase hex, `^[0-9a-f]{32}$`, new per request), `X-Eva-Signature` (`sha256=` prefix). All four are required. | [api.md, section S2S](api.md#eva_solutionsauth-sdks2s) |
| S2S canonical string (7 lines) | `METHOD`, path, **canonicalized** query (decoded, sorted by name then value, RFC 3986 re-encoded), timestamp, nonce, client id, `sha256(body)`, joined by newlines (`buildS2SCanonicalString` and `canonicalizeQuery` in `packages/auth-sdk/src/s2s/sign.ts`). The SDK owns this algorithm: any other implementation (for example a server-side verifier in the Auth Service) must follow it, not the reverse. | [api.md, section S2S](api.md#eva_solutionsauth-sdks2s) |
| S2S replay protection | `replayCache.setIfAbsent(key, ttl)` with key `${clientId}:${nonce}` and ttl `2 * timestampWindowSeconds + 1` (241 s by default). Verification failures use the reasons `header_missing`, `timestamp_invalid`, `timestamp_expired`, `nonce_malformed`, `signature_malformed`, `client_unknown`, `signature_invalid`, `replay_detected`. | [api.md, section S2S](api.md#eva_solutionsauth-sdks2s) |
| Service token (client credentials) | Obtained with `POST /api/v1/internal/token` (HMAC-signed, the only service-to-service route that keeps HMAC; body `{ audience, scope? }`, answer RFC 6749 `{ access_token, token_type: 'Bearer', expires_in, scope }`, errors `{ error, error_description }`: `invalid_client` 401, `invalid_target` / `invalid_scope` / `invalid_request` 400, `temporarily_unavailable` 503). Sent as `Authorization: Bearer`: ES256, header `typ: 'svc-at+jwt'`, `kid` `svc-…`; claims `iss: 'auth-service'`, `aud` (ONE service audience), `sub` (service client uuid), `client_id` (slug), `scope`, `iat`, `exp` (<= 300 s; 60 s for the OTP token Auth mints per send), `jti`. Verified with `verifyServiceToken` / `serviceTokenAuth`. | [api.md, section service token](api.md#verificación-de-token-de-servicio-verifyservicetoken--servicetokenauth) |
| Service audiences and permissions | Closed catalog in `auth-contracts`: `auth-api` (`users:read`, `webhooks:read`, `webhooks:write`, `empresas:leer`, `empresas:escribir`; `admin` is NOT grantable) and `whatsapp-api` (`messages:send:text`, `messages:send:media`, `admin`). A product slug never equals an audience; `auth-service` is a reserved service client slug. | `packages/auth-contracts/src/catalog.ts`, `packages/auth-contracts/src/tokens.ts` |
| Companies API | `POST /internal/empresas`, `GET /internal/empresas/{id}`, `POST /internal/empresas/{id}/miembros`, `DELETE /internal/empresas/{id}/miembros/{userId}`, `POST /internal/empresas/{id}/sucursales` with `empresas:leer` / `empresas:escribir`; webhook events `empresa.created`, `empresa.member_added`, `empresa.member_removed`, `empresa.branch_created`. | `packages/auth-contracts/src/empresas.ts`, `packages/auth-sdk/src/s2s/client.ts` |
| S2S parity vector (KAT) | Literal canonical string and signature, computed independently with `node:crypto`, for other repos (verifiers or own signers) to check parity with the contract. Copy it from the test `KAT: canonical y firma literales` in `packages/auth-sdk/tests/s2s-nonce.mock.test.ts`. | `packages/auth-sdk/tests/s2s-nonce.mock.test.ts` |
| Auth proxy routes (`evaAuthRoutes()`) | `POST /get-code`, `/login`, `/refresh`, `/logout`; `GET /me`, `/empresas`, `/sessions` (plus the `PATCH`/`DELETE` variants in `packages/auth-sdk/src/auth-handlers.ts`) | `packages/auth-sdk/src/hono/auth-routes.ts` |
| OTP login challenge | `POST /get-code` responds `{ data: { message, challengeId } }` (opaque, 32 lowercase hex; passed through unchanged). `POST /login` **requires** `challengeId` in the body: `LoginSchema` rejects a body without it with 400 `malformed`, and `http-client.login` sends it to the Auth Service. A new `get-code` invalidates the previous `challengeId`. The SDK never stores it (browser memory only); the React provider is stateless. | `packages/auth-sdk/src/schemas.ts`, `packages/auth-sdk/src/http-client.ts`, `packages/auth-sdk/src/react/eva-auth-provider.tsx` |
| Wire error shape | `{ error: { code, message } }` by default (`errorWire: 'api'`) | [configuration.md](configuration.md), [migration.md](migration.md) |

The SDK sets the access and refresh cookies in the **consumer's own domain**. Runtime configuration (`cookieDomain`, `errorMessages`, `errorWire`) is documented in [configuration.md](configuration.md); do not repeat it here.

## The Auth URL is configured at runtime

**One npm package for every environment.** The Auth Service URL is not part of the artifact: each consumer passes it once at boot with `configureEvaAuth({ authUrl })`, and `getAuthUrl()` in `packages/auth-sdk/src/config.ts` returns it. Rationale: ADR-017 in [decisions.md](decisions.md) (it supersedes the build-time model of the decisions-log ADR-013; note there are two documents named ADR-013).

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
| **Local tarball** | `pnpm run build`, then `pnpm pack` inside `packages/auth-sdk/`, writes `eva_solutions-auth-sdk-<version>.tgz` in that directory. `*.tgz` is git-ignored. | Trying unreleased SDK changes in a consumer. |

The publish credentials and the maintainer steps (including the one-time bootstrap) are in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing-maintainers).

Current released version: **2.0.1** (`packages/auth-sdk/package.json`, [CHANGELOG.md](../packages/auth-sdk/CHANGELOG.md)); the 3.0.0 release described here is pending its Version PR.

### How each consumer installs it

Each consumer documents its own install method, location and pinned version in its own repo. This repo only owns the package contract and the release steps below.

### What a consumer must configure

Entry points that **call** the Auth Service need `authUrl`: JWKS fetching (`packages/auth-sdk/src/jwks.ts`), the auth proxy routes (`packages/auth-sdk/src/http-client.ts`), and `getAuthUrl()` itself. `signS2SRequest`, `verifyS2SRequest` and the `s2sAuth` middleware (`packages/auth-sdk/src/s2s/sign.ts`, `packages/auth-sdk/src/s2s/verify.ts`, `packages/auth-sdk/src/hono/s2s.ts`) do not import `config.ts`, and `createS2SClient` takes `baseUrl` as an argument.

Rule for consumers:

- If the consumer calls the Auth Service (JWT/JWKS verification, `evaAuthRoutes()`, or the S2S client with `getAuthUrl()`), call `configureEvaAuth({ authUrl })` at boot.
- If the consumer only uses server-side `s2sAuth` and/or `signS2SRequest`, `authUrl` is not needed. `verifyServiceToken` / `serviceTokenAuth` need `authUrl` (JWKS) but not `product`; `product` is required only by the login routes, the session cookies and `verifyAccessToken`.

## Releasing a breaking or minor change

A change to an exposed contract above is not done until the consumers run it. Checklist:

- [ ] Add a changeset (`pnpm changeset`): `major` for a breaking change, `minor` for an additive one.
- [ ] Update [migration.md](migration.md) for breaking changes, and [api.md](api.md) / [configuration.md](configuration.md) for changed API or config (link, do not duplicate).
- [ ] If the Auth Service API adds a permission (`SERVICE_AUDIENCE_SCOPES`, `S2S_SCOPES`), an audience or a route, add it to the contract and its exact-set tests (`packages/auth-contracts/tests/constants.test.ts`, `packages/auth-contracts/tests/identity-phase1.test.ts`, `packages/auth-sdk/tests/exports.test.ts`). A new audience also needs its variant in `setServiceClientGrantRequestSchema` (a test fails if it is missing).
- [ ] If the Auth Service API adds an error code on an admin or `/internal/*` route, add it to `ADMIN_ERROR_CODES` / `S2S_ERROR_CODES` (`packages/auth-sdk/src/admin/error-codes.ts`, `packages/auth-sdk/src/s2s/error-codes.ts`) and to the exact-set tests in `tests/exports.test.ts`.
- [ ] Merge to `main`; the release workflow opens the Version PR (`changeset version`) and, once that PR is merged, publishes. Follow the maintainer steps in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing-maintainers).
- [ ] Each consumer updates its pinned version and lockfile, following the install method documented in its own repo, and passes `authUrl` if it did not before.
- [ ] Each consumer runs its tests. They mock or exercise the SDK, so a signature or error-shape change fails there first.

## What the SDK consumes from the Auth Service

The SDK calls the Auth Service at the configured `authUrl`: the JWKS (`/.well-known/jwks.json`) to verify access tokens, the user-facing auth endpoints behind `evaAuthRoutes()` (`/api/v1/login`, `/api/v1/login/get-code`, `/api/v1/login/refresh`, `/api/v1/login/logout`, `/api/v1/user`, `/api/v1/user/empresas`, `/api/v1/sessions`, and `/health` at the root; `packages/auth-sdk/src/http-client.ts`; `login` needs the `challengeId` returned by `login/get-code`, so the SDK 3.0.0 only works against an Auth Service that issues and checks it), the S2S client's `/api/v1/internal/users/*`, `/api/v1/internal/webhooks/*` and `/api/v1/internal/empresas/*` endpoints with a service token of audience `auth-api` (`packages/auth-sdk/src/s2s/client.ts`, table in [api.md](api.md#eva_solutionsauth-sdks2s)), the token endpoint `/api/v1/internal/token` (`packages/auth-sdk/src/s2s/token-provider.ts`), and the admin client's `/api/v1/admin/*` endpoints (`packages/auth-sdk/src/admin/client.ts`), which the Auth Service authenticates with the HMAC S2S signature of a service client flagged `esAdmin` (ADR 0007 of the Auth API; there is no admin password). The Auth Service owns these endpoints, their scopes and their behavior.

## Verification sources

Facts above were checked against: `packages/auth-sdk/package.json`, `packages/auth-sdk/src/config.ts`, `packages/auth-sdk/src/constants.ts`, `packages/auth-sdk/src/cookies.ts`, `packages/auth-sdk/src/jwks.ts`, `packages/auth-sdk/src/http-client.ts`, `packages/auth-sdk/src/auth-handlers.ts`, `packages/auth-sdk/src/hono/auth-routes.ts`, `packages/auth-sdk/src/hono/s2s.ts`, `packages/auth-sdk/src/s2s/sign.ts`, `packages/auth-sdk/src/s2s/verify.ts`, `packages/auth-sdk/src/s2s/client.ts`, `.github/workflows/release.yml`, `.gitignore`.

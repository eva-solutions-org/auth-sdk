# @eva_solutions/auth-contracts

Shared API contract of the EVA Auth Service: the wire shapes that the Auth API and the SDK must agree on, defined once.

> **Private package.** `"private": true`: it is never published to npm on its own, and its version (`0.1.0`) is not bumped by changesets. It is bundled into `@eva_solutions/auth-sdk` and exposed there as the subpath `@eva_solutions/auth-sdk/contracts`. The Auth API consumes it only through that subpath; do not install this package directly.

> **Partial coverage.** The contract grows slice by slice. Today it covers the error body, the generic message responses, the login flow (get-code, login, refresh, logout), the user profile, company list and update-user body, the session list, the internal users batch, the webhook subscriptions and deliveries, the service-client admin endpoints (including user restore), the core error codes, the header names, the webhook event codes and header names, the service audience catalog with its per-audience permissions, the token vocabulary (`typ`, `kid` prefixes, lifetimes), the service token endpoint, the service-client grants, the internal companies API (roles, contracts, groups, authorizations, directory), the token exchange endpoint, the delegation edges, the active company switch, the account/activity/privacy/delivery states, the users batch cap and the route descriptors of all of them. Everything else is still defined in the SDK and in the API.

## What is exported today

All exports come from `src/index.ts`, which re-exports the modules below.

| Module | Kind | Exports |
|--------|------|---------|
| `constants.ts` | PURE | `ERROR_CODES` (12 core codes, each key equals its value) and type `CoreErrorCode`; `HEADERS` (`authorization`, `x-eva-refresh-token`, `x-eva-new-access-token`, `x-eva-new-refresh-token`); `INTERNAL_HEADERS` (the five `x-eva-*` S2S header names); `ACCOUNT_STATES` (object, each key equals its value), `ACTIVITY_STATES` and `PRIVACY_STATES` (`as const` tuples); `USERS_BATCH_MAX_IDS` (`100`); `WEBHOOK_HEADERS` (`SIGNATURE`, `ID`, `TIMESTAMP`, lower case) and `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` (`300`); `DELIVERY_STATUSES` (`as const` tuple) |
| `event-codes.ts` | PURE | `EVENT_CODES` (27 webhook event codes, each key is the upper-case form of its value) and type `EventCode`. Apart from `constants.ts` so the catalog (it grows every phase) stays out of the `react` bundle |
| `empresa-vocab.ts` | PURE | `EMPRESA_ROLES` and `empresaRoleAtLeast`, `EMPRESA_ESTADOS`, `CONTRATACION_ESTADOS` (+ the contracted and billing subsets and `isContratacionVigente`), `AUTORIZACION_DIRECCIONES`, `TITULAR_ANTERIOR_DESTINOS` |
| `catalog.ts` | PURE | `DELEGABLE_AUDIENCE_SCOPES` and helpers (what a delegation edge can carry: never `auth-api`, never `admin`), `INTER_EMPRESA_PERMISSIONS` and helpers (closed catalog of permissions BETWEEN companies, apart from the service permissions), and `SERVICE_AUDIENCE_SCOPES` (closed catalog: `auth-api` -> `users:read`, `webhooks:read`, `webhooks:write`, `empresas:leer`, `empresas:escribir`, `tokens:exchange`, `contrataciones:pedir`, `contrataciones:escribir`, `contrataciones:leer`, `empresas:baja`, `autorizaciones:escribir`, `autorizaciones:leer`, `directorio:leer`; `whatsapp-api` -> `messages:send:text`, `messages:send:media`, `admin`; `admin` is not grantable on `auth-api`), `SERVICE_AUDIENCES`, types `ServiceAudience` and `ServiceScope<A>`, `isServiceAudience` and `isScopeOfAudience` |
| `tokens.ts` | PURE | `TOKEN_ISSUER`, `RESERVED_SERVICE_CLIENT_SLUGS` and `isReservedServiceClientSlug`, `AUTH_SERVICE_SUB`, `USER_TOKEN_TYP` / `SERVICE_TOKEN_TYP`, `USER_KID_PREFIX` / `SERVICE_KID_PREFIX`, `SERVICE_TOKEN_LIFETIME_SECONDS` (300), `INTERNAL_SERVICE_TOKEN_LIFETIME_SECONDS` (60), `SERVICE_TOKEN_ERROR_CODES`, and the delegated token vocabulary (`DELEGATED_TOKEN_TYP` `dlg-at+jwt`, `DELEGATED_TOKEN_LIFETIME_SECONDS` 120, `DELEGATED_TOKEN_MAX_DEPTH` 3, `TOKEN_EXCHANGE_GRANT_TYPE`, `ACCESS_TOKEN_TYPE`, `SUBJECT_TOKEN_HEADER`, `TOKEN_EXCHANGE_ERROR_CODES`) |
| `routes.ts` | PURE | `API_PREFIX` (`'/api/v1'`), types `HttpMethod` and `RouteDescriptor`, and `AUTH_ROUTES` (`getCode`, `login`, `refresh`, `logout`), `USER_ROUTES` (`get`, `update`, `deactivate`, `listCompanies`), `SESSION_ROUTES` (`list`, `deleteOne`, `deleteAll`) and `INTERNAL_USER_ROUTES` (`get`, `batch`), `WEBHOOK_ROUTES` (7: create, list, get, update, delete and rotate-secret of subscriptions, plus list of deliveries) and `ADMIN_ROUTES` (15: the six `/admin/service-clients` operations, the three grants operations, the three `/admin/productos` operations (no delete), `restoreUser`, `republishPendingWebhooks` and `maintenanceCleanup`), `INTERNAL_TOKEN_ROUTES` (`issue`) and `INTERNAL_EMPRESA_ROUTES` (`create`, `get`, `addMember`, `removeMember`, `createBranch`); `AUTH_ROUTES` also has `setActiveEmpresa` |
| `errors.ts` | SCHEMA | `errorResponseSchema` (OpenAPI id `ErrorBody`) and type `ErrorResponse` |
| `common.ts` | SCHEMA | `messageResponseSchema`, `messageWithCountResponseSchema` and their types |
| `auth.ts` | SCHEMA | `getCodeRequestSchema`, `getCodeResponseSchema`, `loginRequestSchema` (`producto` required, `empresaId` optional), `loginResponseSchema`, `productoSlugSchema`, `setActiveEmpresaRequestSchema`, `setActiveEmpresaResponseSchema` and their types |
| `users.ts` | SCHEMA | `publicProfileSchema`, `profileResponseSchema`, `companyListResponseSchema`, `updateUserRequestSchema` (strict base object, no `.refine`) and types `PublicProfile`, `ProfileResponse`, `CompanyListResponse`, `Company`, `UpdateUserRequest` |
| `sessions.ts` | SCHEMA | `sessionListResponseSchema` and types `SessionListResponse`, `Session` |
| `internal-users.ts` | SCHEMA | `usersBatchRequestSchema` (no `.max`: the cap is `USERS_BATCH_MAX_IDS`, enforced by the consumers), `usersBatchResponseSchema` and types `UsersBatchRequest`, `UsersBatchResponse` |
| `webhooks.ts` | SCHEMA | `createSubscriptionRequestSchema`, `updateSubscriptionRequestSchema`, `deliveriesQuerySchema`, `subscriptionSchema`, `subscriptionWithSecretResponseSchema`, `subscriptionResponseSchema`, `subscriptionListResponseSchema`, `rotateSubscriptionSecretResponseSchema`, `deliverySchema`, `deliveryListResponseSchema` and their types (`Subscription`, `Delivery`, `*Request`, `*Response`) |
| `maintenance.ts` | SCHEMA | `maintenanceCleanupQuerySchema`, `maintenanceCleanupResponseSchema` (+ types `MaintenanceCleanupQuery`, `MaintenanceCleanupResponse`): `POST /api/v1/admin/maintenance/cleanup` |
| `service-clients.ts` | SCHEMA | `serviceClientSlugSchema`, `createServiceClientRequestSchema` (`esAdmin`), `updateServiceClientRequestSchema` (strict base object, no `.refine`), `serviceClientPublicSchema` (`esAdmin`, `grants`), `setServiceClientGrantRequestSchema` (one variant per audience), `serviceClientGrantSchema`, the grants list and set responses, the create, list, get, update and rotate-secret responses, `restoreUserResponseSchema` and their types (`ServiceClientPublic`, `*Request`, `*Response`) |
| `service-tokens.ts` | SCHEMA | `serviceTokenRequestSchema`, `serviceTokenResponseSchema` (RFC 6749, no `data` envelope) and `serviceTokenErrorSchema` (+ types) |
| `productos.ts` | SCHEMA | `productoSchema`, `createProductoRequestSchema`, `updateProductoRequestSchema`, `listProductosResponseSchema`, `productoResponseSchema` (+ types): the products admin API |
| `empresas.ts` | SCHEMA | Companies, members and branches. Every body of a person carries `subjectToken` (`subjectTokenSchema`); `getEmpresaResponseSchema` is `completa` or `recortada` (`data.vista`). `companyListResponseSchema` (in `users.ts`) carries `rol`, `grupo`, `contratado` and `sucursales` |
| `contrataciones.ts`, `grupos.ts`, `directorio.ts`, `autorizaciones.ts`, `delegations.ts`, `token-exchange.ts`, `identity-events.ts` | SCHEMA | Contracts of products, groups, directory, authorizations between companies (and authorizable permissions per product), delegation edges (admin), the RFC 8693 endpoint, and the `data` of the 12 phase 2 events (ids only) |

Request types are `z.input<>` of the schema, response types are `z.output<>`. Refresh answers with `loginResponseSchema` and logout with `messageResponseSchema`: there is no separate schema for them.

Route descriptors are plain data: `path` is relative to `API_PREFIX` and uses the OpenAPI template form (`/sessions/{id}`). `API_PREFIX` (`/api/v1`) is declared here and the SDK clients prepend it to every route they build (`apiPath()`); the JWKS and `/health` stay at the origin root. Request handling, middleware and the full OpenAPI route definitions (`createRoute`) stay in the API.

## PURE and SCHEMA modules

Every module is one of two kinds, and the difference is enforced:

- **PURE** (`catalog.ts`, `constants.ts`, `empresa-vocab.ts`, `event-codes.ts`, `routes.ts`, `tokens.ts`): no `zod` import and no import of a SCHEMA module. Only `as const` data and types.
- **SCHEMA** (`errors.ts`, `common.ts`, `auth.ts`, `users.ts`, `sessions.ts`, `internal-users.ts`, `webhooks.ts`, `maintenance.ts`, `service-clients.ts`, `service-tokens.ts`, `empresas.ts`, `productos.ts`, `contrataciones.ts`, `grupos.ts`, `directorio.ts`, `autorizaciones.ts`, `delegations.ts`, `token-exchange.ts`, `identity-events.ts`): import `zod` and register `.meta()` metadata when loaded. They may import PURE modules.

Why it matters: the SDK `react` entry is size-budgeted. `.meta()` writes to zod's global registry, so a SCHEMA module cannot be tree-shaken once something reaches it. SDK code reachable from `src/react/index.ts` may therefore import only **values from PURE modules** or `import type` from this package, never a value from a SCHEMA module. Put new constants and route descriptors in a PURE module; put schemas in a SCHEMA module. The rule and the gate that enforces it are described in [docs/architecture.md](../../docs/architecture.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md#react-entry-closure-gate).

## Rules for this package

- ESM only, `"sideEffects": false`, built with `unbundle: true` (one `dist` file per source module).
- Metadata uses `.meta({ id, description, example })` only. Never `.openapi()`: the contract has no `hono` or `@hono/zod-openapi` dependency, and the API plugs these schemas into `createRoute` as they are.
- Body schemas stay plain strict objects, without `.refine`, so the OpenAPI document does not change when a schema moves here. Extra validation is added by the consumer.
- Regexes in schemas carry **no flags** (`/i`, `/u`...). JSON Schema has no flags, so the OpenAPI generator would publish the flag as literal text inside `pattern` and every real value would fail a spec-built validator. Use explicit classes instead (`[0-9a-fA-F]`). `tests/examples.test.ts` fails if any format regex has flags.
- Webhook requests: `url` must be `http` or `https` followed by `//`, with no whitespace or control characters (C0 and DEL), through a regex without flags that is published as the spec `pattern` (`^[hH][tT][tT][pP][sS]?:\/\/[^\s\x00-\x1F\x7F]+$`), plus `.url({ protocol })` and a 2048 maximum, and `eventCodes` is `z.enum(EVENT_CODES)` with at least one item (type `EventCode[]`). Userinfo (`user:pass@host`) and duplicates are not rejected here: no regex over the raw text detects it reliably (the WHATWG parser reads several forms as userinfo, and a lookahead in the published `pattern` would not be portable to RE2 validators), so the API applies the userinfo rule by parsing the URL and the duplicate rule with a refinement.
- Identifiers are English; schemas are named `{subject}{Request|Response}Schema`.
- `zod` is a **peer dependency** (`^4.6.7`), so the consumer decides the copy. A consumer must resolve exactly one `zod` version, otherwise schema types stop being compatible with `@hono/zod-openapi` in `createRoute`.
- No `hono`, no Drizzle, no runtime dependencies.
- The source is public (this is a public repo). Allowed: shapes, validation rules, error and event codes, scope names, header names, route `{ method, path }`. **Never** put hostnames, URLs, secrets, peppers, keys, rate-limit thresholds, infrastructure topology or real phone numbers or IDs in examples.

## Tests

`tests/constants.test.ts` checks the manifest flags, the dependency denylist, the source denylist, the wire values and the PURE-module rule (a PURE module importing `zod` or a SCHEMA module fails the test). `tests/examples.test.ts` checks that every `.meta({ example })` parses and that the request and response schemas accept and reject the expected payloads.

## Scripts

Run from the repo root (see [CONTRIBUTING.md](../../CONTRIBUTING.md)): `pnpm run build:contracts` builds this package, and the root `type-check` and `test:run` build it first. Inside the package: `build` (tsdown), `type-check`, `test:run` (Vitest).

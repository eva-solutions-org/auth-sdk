# @eva_solutions/auth-contracts

Shared API contract of the EVA Auth Service: the wire shapes that the Auth API and the SDK must agree on, defined once.

> **Private package.** `"private": true`: it is never published to npm on its own, and its version (`0.1.0`) is not bumped by changesets. It is bundled into `@eva_solutions/auth-sdk` and exposed there as the subpath `@eva_solutions/auth-sdk/contracts`. The Auth API consumes it only through that subpath; do not install this package directly.

> **Partial coverage.** The contract grows slice by slice. Today it covers the error body, the generic message responses, the login flow (get-code, login, refresh, logout), the user profile, company list and update-user body, the session list, the internal users batch, the webhook subscriptions and deliveries, the service-client admin endpoints (including user restore), the core error codes, the header names, the webhook event codes and header names, the service-client scopes, the account/activity/privacy/delivery states, the users batch cap and the route descriptors of all of them. Everything else is still defined in the SDK and in the API.

## What is exported today

All exports come from `src/index.ts`, which re-exports the modules below.

| Module | Kind | Exports |
|--------|------|---------|
| `constants.ts` | PURE | `ERROR_CODES` (12 core codes, each key equals its value) and type `CoreErrorCode`; `HEADERS` (`authorization`, `x-eva-refresh-token`, `x-eva-new-access-token`, `x-eva-new-refresh-token`); `INTERNAL_HEADERS` (the five `x-eva-*` S2S header names); `ACCOUNT_STATES` (object, each key equals its value), `ACTIVITY_STATES` and `PRIVACY_STATES` (`as const` tuples); `USERS_BATCH_MAX_IDS` (`100`); `EVENT_CODES` (11 webhook event codes, each key is the upper-case form of its value) and type `EventCode`; `WEBHOOK_HEADERS` (`SIGNATURE`, `ID`, `TIMESTAMP`, lower case) and `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` (`300`); `SERVICE_CLIENT_SCOPES` (`as const` tuple: `users:read`, `webhooks:read`, `webhooks:write`) and type `ServiceClientScope`; `DELIVERY_STATUSES` (`as const` tuple) |
| `routes.ts` | PURE | `API_PREFIX` (`'/api/v1'`), types `HttpMethod` and `RouteDescriptor`, and `AUTH_ROUTES` (`getCode`, `login`, `refresh`, `logout`), `USER_ROUTES` (`get`, `update`, `deactivate`, `listCompanies`), `SESSION_ROUTES` (`list`, `deleteOne`, `deleteAll`) and `INTERNAL_USER_ROUTES` (`get`, `batch`), `WEBHOOK_ROUTES` (7: create, list, get, update, delete and rotate-secret of subscriptions, plus list of deliveries) and `ADMIN_ROUTES` (7: the six `/admin/service-clients` operations plus `restoreUser`) |
| `errors.ts` | SCHEMA | `errorResponseSchema` (OpenAPI id `ErrorBody`) and type `ErrorResponse` |
| `common.ts` | SCHEMA | `messageResponseSchema`, `messageWithCountResponseSchema` and their types |
| `auth.ts` | SCHEMA | `getCodeRequestSchema`, `getCodeResponseSchema`, `loginRequestSchema`, `loginResponseSchema` and types `GetCodeRequest`, `GetCodeResponse`, `LoginRequest`, `LoginResponse` |
| `users.ts` | SCHEMA | `publicProfileSchema`, `profileResponseSchema`, `companyListResponseSchema`, `updateUserRequestSchema` (strict base object, no `.refine`) and types `PublicProfile`, `ProfileResponse`, `CompanyListResponse`, `Company`, `UpdateUserRequest` |
| `sessions.ts` | SCHEMA | `sessionListResponseSchema` and types `SessionListResponse`, `Session` |
| `internal-users.ts` | SCHEMA | `usersBatchRequestSchema` (no `.max`: the cap is `USERS_BATCH_MAX_IDS`, enforced by the consumers), `usersBatchResponseSchema` and types `UsersBatchRequest`, `UsersBatchResponse` |
| `webhooks.ts` | SCHEMA | `createSubscriptionRequestSchema`, `updateSubscriptionRequestSchema`, `deliveriesQuerySchema`, `subscriptionSchema`, `subscriptionWithSecretResponseSchema`, `subscriptionResponseSchema`, `subscriptionListResponseSchema`, `rotateSubscriptionSecretResponseSchema`, `deliverySchema`, `deliveryListResponseSchema` and their types (`Subscription`, `Delivery`, `*Request`, `*Response`) |
| `service-clients.ts` | SCHEMA | `serviceClientSlugSchema`, `createServiceClientRequestSchema`, `updateServiceClientRequestSchema` (strict base object, no `.refine`), `serviceClientPublicSchema`, the create, list, get, update and rotate-secret responses, `restoreUserResponseSchema` and their types (`ServiceClientPublic`, `*Request`, `*Response`) |

Request types are `z.input<>` of the schema, response types are `z.output<>`. Refresh answers with `loginResponseSchema` and logout with `messageResponseSchema`: there is no separate schema for them.

Route descriptors are plain data: `path` is relative to `API_PREFIX` and uses the OpenAPI template form (`/sessions/{id}`). `API_PREFIX` is declared here, but the SDK clients do not prepend it yet; routes are still served and requested without it. Request handling, middleware and the full OpenAPI route definitions (`createRoute`) stay in the API.

## PURE and SCHEMA modules

Every module is one of two kinds, and the difference is enforced:

- **PURE** (`constants.ts`, `routes.ts`): no `zod` import and no import of a SCHEMA module. Only `as const` data and types.
- **SCHEMA** (`errors.ts`, `common.ts`, `auth.ts`, `users.ts`, `sessions.ts`, `internal-users.ts`, `webhooks.ts`, `service-clients.ts`): import `zod` and register `.meta()` metadata when loaded. They may import PURE modules.

Why it matters: the SDK `react` entry is size-budgeted. `.meta()` writes to zod's global registry, so a SCHEMA module cannot be tree-shaken once something reaches it. SDK code reachable from `src/react/index.ts` may therefore import only **values from PURE modules** or `import type` from this package, never a value from a SCHEMA module. Put new constants and route descriptors in a PURE module; put schemas in a SCHEMA module. The rule and the gate that enforces it are described in [docs/architecture.md](../../docs/architecture.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md#react-entry-closure-gate).

## Rules for this package

- ESM only, `"sideEffects": false`, built with `unbundle: true` (one `dist` file per source module).
- Metadata uses `.meta({ id, description, example })` only. Never `.openapi()`: the contract has no `hono` or `@hono/zod-openapi` dependency, and the API plugs these schemas into `createRoute` as they are.
- Body schemas stay plain strict objects, without `.refine`, so the OpenAPI document does not change when a schema moves here. Extra validation is added by the consumer.
- Identifiers are English; schemas are named `{subject}{Request|Response}Schema`.
- `zod` is a **peer dependency** (`^4.4.3`), so the consumer decides the copy. A consumer must resolve exactly one `zod` version, otherwise schema types stop being compatible with `@hono/zod-openapi` in `createRoute`.
- No `hono`, no Drizzle, no runtime dependencies.
- The source is public (this is a public repo). Allowed: shapes, validation rules, error and event codes, scope names, header names, route `{ method, path }`. **Never** put hostnames, URLs, secrets, peppers, keys, rate-limit thresholds, infrastructure topology or real phone numbers or IDs in examples.

## Tests

`tests/constants.test.ts` checks the manifest flags, the dependency denylist, the source denylist, the wire values and the PURE-module rule (a PURE module importing `zod` or a SCHEMA module fails the test). `tests/examples.test.ts` checks that every `.meta({ example })` parses and that the request and response schemas accept and reject the expected payloads.

## Scripts

Run from the repo root (see [CONTRIBUTING.md](../../CONTRIBUTING.md)): `pnpm run build:contracts` builds this package, and the root `type-check` and `test:run` build it first. Inside the package: `build` (tsdown), `type-check`, `test:run` (Vitest).

# Changelog

## 1.1.0

### Minor Changes

- fa7baf4: Add server-side S2S verification primitives.

  New exports for verifying inbound HMAC-signed S2S requests:

  - `verifyS2SRequest` from `@eva_solutions/auth-sdk/s2s` and root barrel — framework-agnostic primitive using Web API Request. Returns a `S2SVerifyResult<{ clientId }>` discriminated by `ok: true | false`. Timing-safe defense applied when the client is unknown.
  - `s2sAuth` and `requireScope` from `@eva_solutions/auth-sdk/hono` — Hono middlewares that wrap the primitive, set `c.var.s2sClientId` / `c.var.s2sScopes`, and respond with the standard `{ error: { code, message } }` wire format.
  - New types: `S2SVerifyError`, `S2SVerifyReason`, `S2SVerifyResult`, `S2SVerifyOptions`, `S2sAuthOptions`, `S2sAuthVariables`.

  Backward-compatible — no changes to existing exports or runtime behavior.

Todas las versiones notables de `@eva_solutions/auth-sdk` están documentadas aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/). Este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-public] — 2026-05-16

### Changed

- **Package scope rename**: internal name → `@eva_solutions/auth-sdk` for the public npm release. The original internal name was never published to npm; this is a branding change only. See [ADR-014](docs/adr-014-package-scope.md).
- **Repository**: public at `github.com/eva-solutions-org/auth-sdk`.
- **License**: MIT — see [LICENSE](LICENSE).
- Community health files added: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- CI/CD workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- npm provenance publishing via OIDC (GitHub Actions Trusted Publisher).

---

## [1.0.0] — 2026-05-10

### Breaking Changes

- **`Result<T>.error` cambia de `string` a `EvaError`** (discriminated union `EvaApiError | EvaSdkError`). Todos los callsites que tratan `result.error` como string deben actualizarse. Ver [docs/migration.md](docs/migration.md#1-resulterror--string--evaerror).

- **`Result<T>` en el branch `ok: false` ya no tiene `status` top-level** — el status vive en `result.error.status`. Ver [docs/migration.md](docs/migration.md#2-resultstatus--resulterrorstatus).

- **Wire HTTP del SDK cambia de `{ error: string }` a `{ error: { code, message } }` por default** — el nuevo default `errorWire: 'api'` emite el shape del Auth Service. Para compat 0.x usar `configureEvaAuth({ errorWire: 'string' })`. Ver [docs/configuration.md#errorwire](docs/configuration.md#errorwire).

- **`EvaAuthError`, `createAuthError`, `isAuthError` eliminados** — `src/errors.ts` hard-deleted sin @deprecated. No existen en 1.0.0. Ver [docs/migration.md](docs/migration.md#3-evaautherror--eliminado-sin-reemplazo).

- **`ERROR_CODES` tiene 12 entries** (antes 11 — se agregó `account_state_locked`).

- **`parseErrorResponse` async (tomaba `Response`) eliminada** — reemplazada por versión sync en `src/schemas.ts` con firma `(status: number, body: unknown): EvaError`.

- **`Result<T>` — segundo parámetro genérico `E` eliminado** — el tipo de error es siempre `EvaError`. La firma es `Result<T>`, no `Result<T, E>`.

### Added

- **`EvaApiError`** — tipo para errores del Auth Service: `{ kind: 'api', code: string, message: string, status: number }`.
- **`EvaSdkError`** — tipo para errores internos del SDK: `{ kind: 'sdk', reason: SdkErrorReason, message: string, status: number }`.
- **`EvaError`** — discriminated union `EvaApiError | EvaSdkError`. Nuevo tipo de `Result<T>.error`.
- **`ERROR_CODES`** — catálogo `as const` de 12 error codes core del Auth Service. Solo aplica a `EvaApiError` (kind: `'api'`).
- **`SDK_ERROR_REASONS`** — enum cerrado `as const` de 6 reasons internos del SDK.
- **`CoreErrorCode`** — unión cerrada de los 12 values de `ERROR_CODES`.
- **`ErrorCode`** — `CoreErrorCode | (string & {})` — tipo abierto para feature-specific codes con autocomplete.
- **`SdkErrorReason`** — tipo de los 6 values de `SDK_ERROR_REASONS`.
- **`getMessage(err: EvaError): string`** — helper de conveniencia para migración gradual desde 0.x. Equivale a `err.message`.
- **`@eva_solutions/auth-sdk/webhooks`** — nuevo entry point con `verifyWebhookSignature`, `EVENT_CODES`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` y tipos.
- **`@eva_solutions/auth-sdk/admin`** — nuevo entry point con `createAdminClient()` para gestión de service clients y restauración de usuarios.
- **`@eva_solutions/auth-sdk/s2s`** — nuevo entry point con `createS2SClient()` para llamadas internas con firma HMAC S2S automática.
- **`errorWire?: 'api' | 'string'`** en `configureEvaAuth()` — controla el shape HTTP que el SDK emite al rechazar requests. Default: `'api'`.
- **`getErrorWire(): 'api' | 'string'`** — getter público de la config runtime `errorWire`.
- **`EVENT_CODES`** — 11 event codes del Auth Service re-exportados desde `@eva_solutions/auth-sdk` y `@eva_solutions/auth-sdk/webhooks`.
- **`ACCOUNT_STATES`** — catálogo `as const` de 6 estados de cuenta (`no_verificado`, `verificado`, `pendiente_de_verificacion`, `suspendido`, `baneado`, `eliminado`). Espejo de `src/core/constants/account-states.ts` del API. Re-exportado desde `@eva_solutions/auth-sdk`.
- **`AccountState`** — tipo union de los 6 literales de `ACCOUNT_STATES`. `RestoreUserResult.stateAccount` tipado como `AccountState`.
- **`WEBHOOK_HEADERS`** — headers que el Auth Service incluye en cada webhook entregado: `SIGNATURE`, `ID`, `TIMESTAMP`. Re-exportado desde `@eva_solutions/auth-sdk/webhooks` y `@eva_solutions/auth-sdk`.
- **`S2S_SCOPES`** — catálogo `as const` de scopes S2S reconocidos: `USERS_READ`, `WEBHOOKS_READ`, `WEBHOOKS_WRITE`. Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **`S2SScope`** — tipo union de los literales de `S2S_SCOPES`.
- **`S2S_RESPONSE_HEADERS`** — header de respuesta S2S: `SERVER_TIME` (`x-eva-server-time`). Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **`ADMIN_ERROR_CODES`** — códigos de error específicos del módulo Admin: `service_client_already_exists`, `service_client_not_found`. Re-exportado desde `@eva_solutions/auth-sdk/admin` y `@eva_solutions/auth-sdk`.
- **`AdminErrorCode`** — tipo union de los literales de `ADMIN_ERROR_CODES`.
- **`USERS_BATCH_MAX_IDS = 100`** — constante documentando el límite del API para `batchUsers`. Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **Validación client-side en `batchUsers`** — si `ids.length > 100` retorna `Result ok:false` con `kind: 'sdk', reason: 'malformed'` sin hacer fetch.
- **Validación client-side en `listWebhookDeliveries`** — si `limit` fuera de `[1, 100]` u `offset < 0`, retorna `Result ok:false` con `kind: 'sdk', reason: 'malformed'` sin hacer fetch.

### Changed

- **`parseErrorResponse`** — de función async (tomaba `Response`) a función sync (toma `status: number, body: unknown`). Vive en `src/schemas.ts`.
- **`ErrorResponseSchema`** — de `{ error: z.string() }` a `{ error: z.object({ code: z.string(), message: z.string() }) }`. Afecta la spec OpenAPI generada por `evaAuthOpenAPIRoutes()`.
- **`configureEvaAuth()`** — acepta nuevo campo `errorWire?: 'api' | 'string'`. Validación inline en setup time.
- **`src/hono/middleware.ts`** — el reject path construye `EvaSdkError` local y consulta `getErrorWire()` para emitir el shape correcto.
- **`src/auth-handlers.ts`** — `errorResponse()` privado ahora acepta `EvaError` + consulta `getErrorWire()`. Nuevo helper interno `resolveCode()` para mapear `SdkErrorReason` → `ErrorCode`.
- **Todos los callsites de `result.error`** en `src/http-client.ts`, `src/jwt.ts`, `src/generic/verify.ts` — migrados a `EvaError`.

### Removed

- **`src/errors.ts`** — hard-deleted. `EvaAuthError`, `createAuthError`, `isAuthError` y `parseErrorResponse` async eliminados.
- **`Result<T>` propiedad `.status` top-level** en el branch `ok: false` — eliminada. El status vive en `result.error.status`.
- **Re-exports de `EvaAuthError`, `createAuthError`, `isAuthError`** desde `src/index.ts`.

### Migration

Ver [`docs/migration.md`](docs/migration.md) para guía completa con before/after por área, tabla de mapping de reasons y snippets de codemod manual.

---

## [0.1.0] — 2026-04-09

Versión inicial del SDK.

### Added

- Core: `createEvaAuth()`, `createHttpClient()`, `verifyAccessToken()`, JWKS cache con ETag/304.
- Hono: `evaAuth()` middleware, `evaAuthRoutes()`, `getEvaPayload()`, `getSessionId()`, `parseDeviceInfo()`.
- Generic: `verifyRequest()`, `setTokenCookies()`, `clearTokenCookies()`.
- React: `EvaAuthProvider`, `useAuth()`, `useUser()`, `useSessions()`, `useEmpresas()`, `authFetch()`.
- Config build-time via `tsup define` (`__EVA_AUTH_URL__`, `__EVA_ENV__`).
- Runtime config via `configureEvaAuth({ authUrl, cookieDomain, errorMessages })`.
- Sistema i18n de 16 mensajes de error con precedencia local > global > default.
- Entry point `@eva_solutions/auth-sdk/hono-openapi` con `evaAuthOpenAPIRoutes()`.
- `EvaTokenPayload<TExtra>` genérico con validación opcional via `extraClaimsSchema`.
- `RESERVED_JWT_CLAIMS` (RFC 7519 + OIDC Core 1.0) con fail-fast en extraClaimsSchema.
- Auto-refresh con deduplicación via `Map<string, Promise>`.
- `Result<T>` pattern para todos los flujos de error.

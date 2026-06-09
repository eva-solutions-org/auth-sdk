# Changelog

Todas las versiones notables de `@eva_solutions/auth-sdk` están documentadas aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/). Este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] — 2026-06-08

### Breaking Changes

- **`configureEvaAuth.authUrl` eliminado** — el campo `authUrl` ya no existe en `ConfigureEvaAuthOptions`. TypeScript rechazará `configureEvaAuth({ authUrl: '...' })` en compilación. En JS puro, el campo extra es ignorado silenciosamente (sin throw).

- **`process.env.EVA_AUTH_URL` ignorado** — la variable de entorno ya no tiene efecto. `getAuthUrl()` retorna exclusivamente la URL horneada en build-time (`__EVA_AUTH_URL__`).

- **`createS2SClient` lanza si `baseUrl` es HTTP no-loopback** — se requiere `https:` para hosts no-loopback. `http://localhost:*`, `http://127.x.x.x:*`, `http://[::1]:*` y `http://::1:*` siguen siendo válidos para entornos de test/desarrollo local.

- **`createAdminClient` lanza si `baseUrl` es HTTP no-loopback** — mismo comportamiento que `createS2SClient`.

- **`getPublicKey` eliminado** — el export `getPublicKey(): Promise<CryptoKey>` ya no existe en el barrel raíz. Era una API interna expuesta accidentalmente. Consumers que necesiten la clave pública deben usar `verifyAccessToken()` directamente.

- **`fetchJwks` eliminado** — el export `fetchJwks(): Promise<void>` ya no existe. La hidratación del cache JWKS es automática y gestionada internamente por jose.

- **`clearJwksCache` eliminado** — el export `clearJwksCache(): void` ya no existe. Con la URL del Auth Service siendo build-time pura (ADR-013), no hay caso de uso válido para invalidar el cache manualmente.

### Migration Guide

#### Si usabas `configureEvaAuth({ authUrl })`

```ts
// v1.x — ya no funciona
configureEvaAuth({ authUrl: 'https://auth.example.com' })

// v2.x — usar la variante de build correcta
// El SDK ya trae la URL horneada. No se necesita ningún código adicional.
// Asegurarse de consumir la variante 'production' del SDK.
```

#### Si usabas `process.env.EVA_AUTH_URL`

Eliminar la variable de entorno. La URL se fija en build-time con `EVA_BUILD_ENV=production` al publicar.

#### Si tus tests usan `http://auth.test` como baseUrl de S2S o Admin

```ts
// v1.x
createS2SClient({ baseUrl: 'http://auth.test', ... })

// v2.x — usar loopback
createS2SClient({ baseUrl: 'http://localhost:4000', ... })
// O mockear el factory completo en lugar de crear el cliente real
```

### Security

- `validateHttpsUrl` reemplaza `validateAuthUrl`: requiere HTTPS salvo host loopback (`localhost`, `127.0.0.0/8`, `::1`/`[::1]`). Mitiga CWE-319 para `secretHex` (S2S) y `adminPassword` (Admin).
- Auth URL build-time puro elimina superficie de misconfiguración accidental de URL en deploys.
- **kid-matching RFC 7517** — la verificación de tokens ahora usa `createRemoteJWKSet` de jose, que selecciona la clave pública por `kid` + `alg` + `use`. Resuelve el bug de selección ciega `keys[0]` que producía comportamiento incorrecto con múltiples claves (rotación de clave).
- **`algorithms: ['ES256']` explícito en jwtVerify** — defensa en profundidad contra algorithm confusion attacks. jose ya rechazaba el algoritmo vía la CryptoKey tipada, pero ahora la restricción es declarativa.
- **jose pinado a `~6.2.3`** — el rango de patch acota upgrades automáticos. El comportamiento fail-closed verificado se protege con `tests/jwks.contract.test.ts`.

### Changed

- **Mensajes de error JWKS** — `EvaSdkError.message` ahora contiene mensajes de jose en inglés técnico (ej: `"Expected 200 OK from the JSON Web Key Set HTTP response"`) en lugar de mensajes en español del SDK (ej: `"Clave pública no disponible"`). El discriminator `reason: 'token_invalid'` y `status: 401` no cambian.

### Internal

- ADR-010 marcado como SUPERSEDED por ADR-013.
- ADR-013 agregado a `docs/decisions.md`.
- `src/globals.d.ts` JSDoc actualizado.
- `tsdown.config.ts` comentario de cabecera actualizado.

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

# Registro de decisiones

Formato ADR simplificado. Cada entrada documenta una decisión de diseño del SDK, su contexto y la justificación.

---

## ADR-001: Error propagation transparente

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

El SDK actúa como proxy entre el frontend y el Auth Service. Los mensajes de error del Auth Service están diseñados para ser útiles al usuario final.

### Decisión

Los errores del Auth Service se propagan **sin sanitizar** al frontend. El SDK no modifica, oculta ni reemplaza mensajes de error.

### Justificación

- El consumidor conoce su propio Auth Service y controla los mensajes
- Los mensajes son útiles para UX (ej: "Código expirado", "Teléfono no registrado")
- Sanitizar agregaría complejidad sin beneficio real en este contexto

---

## ADR-002: Cookie Secure=true en development

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

Los entornos de desarrollo modernos suelen tener HTTPS configurado. El flag `Secure` en cookies impide que se envíen por HTTP plano.

### Decisión

`Secure=true` en todos los entornos excepto `NODE_ENV=local`. El valor `development` **no** desactiva Secure.

### Justificación

- Development con HTTPS es lo esperado, no un entorno sin HTTPS
- Solo `local` (desarrollo puramente local sin HTTPS) necesita la excepción
- Esto evita configuraciones inseguras accidentales en staging o pre-producción

---

## ADR-003: Paradigma funcional sin clases

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

El SDK necesita ser ligero, tree-shakeable y compatible con Edge runtime.

### Decisión

Todo el SDK usa **funciones + objetos**. Sin clases. Result Pattern para errores de negocio. Excepciones solo para errores de programación (ej: middleware no aplicado).

### Justificación

- Las funciones son más simples de componer y testear
- Mejor tree-shaking que clases con métodos
- Result Pattern hace los errores explícitos en el tipo de retorno
- Las excepciones quedan reservadas para bugs reales, no flujos esperados

---

## ADR-004: Auto-refresh con deduplicación

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

Cuando un access token expira, múltiples requests concurrentes pueden llegar al middleware simultáneamente. Cada una intentaría hacer refresh contra el Auth Service, causando race conditions.

### Decisión

El middleware usa un **`Map<string, Promise>` a nivel de módulo**, keyed por `refreshToken`, para deduplicar refresh requests concurrentes. Solo el primer request para un refresh token dado ejecuta el refresh contra el Auth Service; los demás esperan su resultado.

Este patrón se aplica tanto en `hono/middleware.ts` como en `generic/verify.ts`.

### Justificación

- Evita que múltiples requests usen el mismo refresh token simultáneamente
- El Auth Service podría invalidar un refresh token después del primer uso
- Reduce carga innecesaria contra el Auth Service
- Patrón simple sin necesidad de locks o mutexes
- El Map permite deduplicar por token específico (antes era una variable global compartida)

---

## ADR-005: JWKS cache con hard max TTL

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

La public key del Auth Service se cachea localmente para evitar fetch en cada verificación. Si el Auth Service rota la key, el SDK debe obtener la nueva.

### Decisión

- TTL normal de refresh: **24 horas**
- Grace period si fetch falla: **1 hora adicional** (25h total)
- Después de 25 horas sin actualización exitosa: **rechazar verificación**

### Justificación

- 24h es suficiente para operación normal sin exceso de requests al JWKS
- 1h de grace period tolera downtime breve del Auth Service
- Después de 25h, usar una key potencialmente revocada es un riesgo de seguridad inaceptable
- Es preferible rechazar requests temporalmente a verificar con una key obsoleta

---

## ADR-006: Constantes build-time vía tsup define

**Fecha**: 2026-04-09
**Estado**: Aceptada — parcialmente reemplazada por [ADR-010](#adr-010-auth-url-runtime-override-con-fallback-build-time)

### Contexto

Originalmente la URL del Auth Service se leía de `process.env.EVA_AUTH_URL` en runtime y `NODE_ENV` controlaba el flag Secure de cookies. Esto exponía detalles de infraestructura al consumidor y requería que el deploy configurara env vars.

### Decisión

La URL y el entorno se **hornean como constantes** en el paquete al momento del build vía `tsup define`. Se usa `EVA_BUILD_ENV` (solo al momento de build) para seleccionar de un map interno de URLs. El consumidor NO configura nada — ni en código, ni en variables de entorno, ni en deploy. Instala la versión correcta del SDK y listo.

Scripts de build: `build:local`, `build:dev`, `build:prod`, `pack:local`.

`config.ts` expone: `getAuthUrl()`, `getEvaEnv()`. Los exports de constantes `AUTH_URL` y `ENV` fueron eliminados en el change `deployment-flexibility` (ver ADR-010). Se eliminaron `configure()`, `resetConfig()`, `getConfig()` y toda lectura de `process.env` en runtime.

> **Nota**: ADR-010 introduce override runtime de URL via `configureEvaAuth({ authUrl })` y lectura de `process.env.EVA_AUTH_URL` como nivel de precedencia intermedio. El build-time permanece como fallback final. El modelo zero-config sigue siendo válido si el consumidor no llama `configureEvaAuth()`.

### Justificación

- El consumidor no necesita saber la URL del Auth Service ni configurar nada
- Elimina una categoría entera de bugs (env var mal configurada, faltante, o diferente entre deploys)
- Reduce la superficie de API pública
- El SDK se comporta idénticamente en cualquier runtime (Edge, Node, browser) sin depender de `process.env`
- `createEvaAuth()` sin parámetros es más simple de consumir

---

## ADR-007: Cookie Secure por entorno build-time

**Fecha**: 2026-04-09
**Estado**: Aceptada (reemplaza versión anterior con NODE_ENV runtime)

### Contexto

Antes el flag `Secure` se decidía leyendo `NODE_ENV` de `process.env` en runtime. Con la migración a constantes build-time, ya no existe lectura de env vars en runtime.

### Decisión

`isSecureCookie()` usa `getEvaEnv()` (constante horneada en build-time). Solo `local` desactiva Secure; `development` y `production` mantienen `Secure=true`.

### Justificación

- Consistente con el modelo build-time: todo se decide al compilar, no al ejecutar
- Elimina la dependencia de `process.env` en runtime
- Development con HTTPS es lo esperado — solo `local` necesita la excepción
- Evita configuraciones inseguras accidentales en staging o pre-producción

---

## ADR-008: createEvaAuth() como punto de extensión

**Fecha**: 2026-04-09
**Estado**: Aceptada

### Contexto

`createEvaAuth()` actualmente es un wrapper trivial sobre `createHttpClient()`. Podría parecer innecesario.

### Decisión

Se mantiene `createEvaAuth()` como API pública del SDK. Es el punto de entrada intencional para consumidores que necesitan acceso directo al cliente HTTP.

### Justificación

- Provee un punto de extensión estable si el SDK añade configuración futura (logger, rate limiter, plugins)
- La firma sin parámetros es consistente con el modelo build-time (ADR-006)
- `createHttpClient()` es un detalle de implementación; `createEvaAuth()` es la API pública semántica
- El costo es mínimo (una función, una indirección)

---

## ADR-009: Cookie Domain Runtime Configuration

**Fecha**: 2026-05-02
**Estado**: Aceptada

### Contexto

Consumidores del SDK que despliegan en arquitecturas multi-subdominio (ej: `app.miempresa.com` + `api.miempresa.com`) necesitan que las cookies de auth sean accesibles en todos los subdominios. El atributo `Domain=.miempresa.com` en `Set-Cookie` resuelve esto. Sin embargo, `getCookieOptions()` no emitía `Domain` en ningún escenario — forzando a los consumidores a implementar middlewares custom para reescribir el header `Set-Cookie`, duplicando la lógica de cookies del SDK.

Adicionalmente, CVE-2026-29086 (Hono < v4.12.4) demostró que la inyección de `;\r\n` en el atributo `domain` de un `Set-Cookie` permite a un atacante inyectar headers arbitrarios. El SDK debe validar cualquier valor de `cookieDomain` provisto por el consumidor.

### Decisión

Se agrega `configureEvaAuth({ cookieDomain })` como setter runtime. `src/config.ts` mantiene estado mutable `_runtimeConfig.cookieDomain`. `getCookieDomain()` lo expone a `src/cookies.ts`, que inyecta `Domain=<valor>` en `serializeCookie` y `serializeClearCookie` cuando está definido.

Validación anti-injection: `configureEvaAuth({ cookieDomain })` lanza `Error("cookieDomain inválido: caracteres prohibidos (;, \r, \n)")` si el valor contiene `;`, `\r` o `\n`.

### Consecuencias

- **Orden de inicialización**: `configureEvaAuth` debe llamarse al boot, antes del primer request. Las cookies ya emitidas no se reescriben.
- **Footgun de logout**: Si `cookieDomain` cambia entre un `Set-Cookie` de login y el `Set-Cookie; Max-Age=0` de logout, el browser NO borra la cookie original (RFC 6265 exige matching exacto de `name + domain + path`). Mitigación: configurar al boot y no cambiar post-deploy. Ver [gotcha documentada en docs/configuration.md](configuration.md#footgun-cambiar-cookiedomain-entre-login-y-logout).
- **Fricción menor con paradigma funcional**: el estado global mutable es aceptado por consistencia con `jwks.ts` (cachedKey, cachedAt) y `refresh-dedup.ts` (Map global). ADR-003 sigue vigente para todo el resto.
- **Zero regression**: sin llamar `configureEvaAuth`, las cookies salen sin `Domain` (comportamiento previo preservado).

### Alternativas descartadas

- **A1 — parámetro `domain` en `setTokenCookies`/`clearTokenCookies`**: breaking change en las firmas públicas de `@eva_solutions/auth-sdk/generic`. Rechazado.
- **A3 — factory pattern** (`createEvaAuth({ cookieDomain })`): refactor masivo de 4 entry points, contradice ADR-008. Rechazado.
- **A4 — normalización RFC 6265** (leading dot, IDN): fuera de scope. El SDK acepta el valor tal cual; el consumidor es responsable del formato.

---

## ADR-010: Auth URL Runtime Override con Fallback Build-Time

**Fecha**: 2026-05-02
**Estado**: Aceptada — parcialmente reemplaza [ADR-006](#adr-006-constantes-build-time-vía-tsup-define)

### Contexto

El modelo build-time de ADR-006 requiere un binario por entorno. Consumidores que usan PR previews, staging efímero o Cloudflare Workers (donde el binding de `env` llega por request, no en build-time) no pueden reutilizar un mismo tarball en múltiples entornos sin rebuild.

Adicionalmente, `new URL(value)` acepta cualquier scheme registrado por WHATWG (incluyendo `javascript:`, `data:`, `file:`, `ftp:`). Sin validación adicional, un `authUrl` mal configurado podría redirigir requests del SDK a URLs maliciosas (SSRF/XSS).

### Decisión

Se establece una **precedencia de tres niveles** para la resolución de la URL del Auth Service:

1. `configureEvaAuth({ authUrl })` — override programático (máxima precedencia).
2. `process.env.EVA_AUTH_URL` — variable de entorno en runtime (accedida vía `globalThis.process?.env` para compatibilidad con Edge runtimes sin `process` global).
3. `__EVA_AUTH_URL__` — constante horneada en build-time (fallback final).

**Validación asimétrica de protocolo** (`http:` / `https:` únicamente):
- En `configureEvaAuth({ authUrl })`: `throw Error` inmediato. Error de programación — fallo rápido.
- En `process.env.EVA_AUTH_URL`: `console.warn` + fallback a build-time. Error de deploy — resiliencia.

**Manejo de strings inválidos en env**: `EVA_AUTH_URL` vacío, whitespace-only, `"undefined"` o `"null"` (interpolación CI mal hecha) — tratados como ausentes (silencioso) o con warn+fallback según si pasan `new URL()`.

**Invalidación de JWKS cache**: cuando `configureEvaAuth({ authUrl })` recibe un valor distinto al previo, se invoca `clearCache()` antes de retornar. Si el valor es idéntico, el cache se preserva (ETag incluido). Esto evita que `getPublicKey()` retorne una clave del host anterior tras un switch de entorno.

### Consecuencias

- **`process.env` vuelve a runtime**: parcial reemplazo del modelo zero-process.env de ADR-006. Solo aplica al nivel de URL del Auth Service. `getEvaEnv()` y el flag `Secure` siguen siendo build-time (ADR-007 sin cambios).
- **Guard para Edge runtimes**: `(globalThis as ...).process?.env?.EVA_AUTH_URL` con optional chaining — no lanza en Cloudflare Workers viejos sin `process` global.
- **JWKS cache se invalida en reconfiguraciones runtime**: necesario para correctitud cuando se usa el mismo proceso con múltiples URLs (testing, PR previews con hot reload).
- **Eliminación de `AUTH_URL` y `ENV` exports**: las constantes exportadas de `src/config.ts` se eliminaron directamente (SDK no está en producción, no hay consumers externos a romper). Consumers internos migraron a `getAuthUrl()` y `getEvaEnv()`.

### Alternativas descartadas

- **B2 — solo parámetro (configureEvaAuth, sin env)**: DX inferior para consumidores que solo quieren setear `EVA_AUTH_URL` en deploy sin tocar código.
- **B4 — solo env sin override programático**: menos flexible, no cubre Cloudflare Workers con binding.
- **B5 — mantener `AUTH_URL`/`ENV` como deprecated**: deuda técnica gratuita. SDK no está en producción → eliminación directa.

---

## ADR-011: Generic EvaTokenPayload + optional schema validation

**Fecha**: 2026-05-02
**Estado**: Aceptada

### Contexto

El SDK definía `EvaTokenPayload` cerrado a `{ id: string; sessionId: string }`. Los consumers que necesitaban acceder a claims adicionales del JWT (ej: `phone`, `empresaId`, `role`) debían hacer cast manual `as MyExpanded`, perdiendo type safety en runtime y compilación.

Pain points identificados:
1. `c.var.evaPayload.phone` genera error de TS — el consumer hace `(c.var.evaPayload as any).phone`.
2. No hay validación runtime: si el JWT no tiene `phone`, el cast silencia el error y el handler lee `undefined`.
3. No hay single source of truth entre el tipo TS y lo que el JWT realmente contiene.

### Decisión

**Tipo genérico TS + schema runtime inline opcional (Approach H).**

`EvaTokenPayload<TExtra extends Record<string, unknown> = {}>` como tipo de retorno. El consumer puede proveer un `extraClaimsSchema?: ZodType<TExtra>` al crear el middleware o llamar a las funciones de verificación. El generic es inferido automáticamente del schema.

**Decisión clave: sin schema = sin extras (REQ-TE-012 — defense-in-depth).**

Sin `extraClaimsSchema`, el payload retornado es exactamente `{ id, sessionId }`. Los claims extra del JWT se descartan. El opt-in a claims adicionales es explícito via schema. El SDK NO expone claims que no validó.

Con schema: `payload = { id, sessionId, ...parsedExtra }` donde `parsedExtra = extraClaimsSchema.safeParseAsync(extrasCandidate)`.

### Claims reservados

Los siguientes claims NUNCA aparecen en `EvaTokenPayload`, aunque estén presentes en el JWT:

| Claim | Fuente |
|-------|--------|
| `iat`, `exp`, `iss`, `aud`, `jti`, `sub`, `nbf` | RFC 7519 §4.1 |
| `nonce`, `auth_time`, `acr`, `amr`, `azp` | OIDC Core 1.0 §2 |

`sub` se mapea a `id` (REQ-TE-022). `sessionId` es un claim custom del Auth Service (no reservado RFC), se expone directamente.

Si `extraClaimsSchema` declara una de estas keys, `assertSchemaNoReservedKeys` lanza un error en la primera invocación (fail-fast). La validación está cacheada con `WeakMap<ZodType, true>` — zero overhead amortizado.

### Justificación

- **Approach H vs F (global)**: inline schema por entry point soporta multi-tenant (un handler con `role` y otro con `phone`). `configureEvaAuth` queda enfocado en deploy config (ADR-009/010), sin contaminar la validación de tokens.
- **Runtime validation**: el tipo TS promete propiedades que existen a runtime (o el middleware rechaza con 401). Elimina la clase de bug "cast que miente".
- **WeakMap cache**: O(1) por referencia, no penaliza el path zero-config ni el path con schema en requests subsiguientes.
- **safeParseAsync**: cubre schemas con refinements/transforms async. Costo despreciable vs `jose.jwtVerify` (firma criptográfica).
- **Sin schema = drop all**: comportamiento idéntico al SDK previo a este change para consumers que no opten in. Zero regression runtime.

### Consecuencias

- `EvaTokenPayload` sin parametrizar sigue siendo `{ id, sessionId }` (backward compat).
- Consumers que usaban cast manual siguen compilando; la migration recomendada es `evaAuth({ extraClaimsSchema })`.
- Anti-pattern documentado: `evaAuth<{ phone: string }>()` (generic sin schema) compila pero `phone` será `undefined` a runtime. El tipo miente — usar siempre con `extraClaimsSchema`.
- El refresh path también aplica el schema: si el AT post-refresh viola el schema, el middleware rechaza con 401 (consistencia).

### Alternativas descartadas

- **Approach F (global `configureEvaAuth({ tokenSchema })`)**: no soporta multi-tenant, contamina config de deploy.
- **Helper `defineExtraClaims(schema)`**: fricción extra sin beneficio claro. Se evalúa si hay demanda.
- **Passthrough silencioso (design v1)**: exposición de claims no validados — viola defense-in-depth.

---

## ADR-012: errorMessages i18n + variante OpenAPIHono + factory buildAuthHandlers

**Fecha**: 2026-05-03
**Estado**: Aceptada

### Contexto

SDD `dx-improvements` — Items 4 (cookie exports cross-entry), 6 (errorMessages i18n), 7 (variante OpenAPIHono), 8 (docs avanzada). El SDK tenía mensajes de error 4xx hardcoded en español en tres archivos distintos sin mecanismo de override.

### Decisiones

**(a) EvaErrorMessages — 16 keys flat por concepto**

Tipo `EvaErrorMessages` con 16 keys nombradas por concepto (no por endpoint). Flat en lugar de namespace (`{ authRequired }` vs `{ middleware: { authRequired } }`). Justificación: simplicidad del override; 16 keys son manejables flat; TypeScript autocompletion provee discoverability. Si las keys crecen >25 en una iteración futura, migrar a namespace requiere major bump (deprecation path posible en minor).

**(b) Precedencia local > global > default, merge shallow**

`resolveErrorMessages(local, global)` aplica la precedencia estricta. El merge es shallow string-por-string. `""` (string vacío) se respeta como override explícito (≠ `undefined`). `undefined` en un campo de `Partial<>` sobreescribe igual que en cualquier spread JS — se recomienda omitir la key si no se quiere override.

**(c) Validación runtime con Zod en `config.ts` — M4**

`validateErrorMessagesInput` usa `ErrorMessagesSchema` generado dinámicamente desde `DEFAULT_ERROR_MESSAGES` con `.partial().strict()`. Motivos: (1) convención SDK existente (config.ts ya usa Zod para authUrl/cookieDomain), (2) `.strict()` detecta typos automáticamente con mensajes ricos de Zod (path + reason), (3) schema generado dinámicamente garantiza fuente única de verdad. Sin ciclo de imports: `error-messages.ts` es standalone (zero imports internos), `config.ts` importa solo el type + DEFAULT.

**(d) Closure messages() por-request — M2 — tradeoff de perf aceptado**

La resolución `messages = () => resolveErrorMessages(opts.local, getErrorMessages())` se evalúa en cada request en lugar de cachearse. Costo: ~3 spreads + 2 fn calls por request. Justificación: permite que `configureEvaAuth({ errorMessages })` llamado post-`buildAuthHandlers()` tome efecto en el siguiente request — consistente con cómo se resuelve `authUrl`. Comparación: negligible vs JWT verify (~20μs vs ~1ms = 2% del costo del request). Alternativa rechazada: cache + invalidator en `configureEvaAuth` — más complejo, ~2x perf, no justifica para esta operación.

**(e) factory buildAuthHandlers() — fuente única de verdad**

Los 11 handlers de auth extraídos a `src/auth-handlers.ts` como factory `buildAuthHandlers(opts)`. Ambas variantes (`evaAuthRoutes` y `evaAuthOpenAPIRoutes`) consumen el mismo factory. Garantiza zero drift de comportamiento entre variantes. Los tests cross-variant (hono-openapi.mock.test.ts) verifican paridad HTTP request-por-request.

**(f) tokenNotFound — key unificada para access y refresh ausentes**

El SDK original usaba dos strings distintos: `'Token de acceso no encontrado'` y `'Token de refresco no encontrado'`. Consolidados en una sola key `tokenNotFound` con default `'Token de acceso no encontrado'`. Justificación: simplifica el override (una sola key cubre ambos casos); el consumer que requiera diferenciación puede usar el mensaje del servidor (propagado transparentemente vía ADR-001). Tests de regression actualizados.

**(g) `/hono-openapi` como entry point separado**

El entry point `@eva_solutions/auth-sdk/hono-openapi` es opcional y aislado. Consumers que NO usan OpenAPI no incluyen `@hono/zod-openapi` en su bundle (peer dep opcional). `splitting: true` en tsup previene duplicación de `auth-handlers.ts` en chunks ESM.

**(h) createRoute + double assertion `as unknown as RouteHandler<R>` — B3 revisado**

La variante OpenAPI usa `createRoute` (no `defineOpenAPIRoute` — que es para el método `openapiRoutes()`). Los handlers del factory tienen firma genérica `(c: Context) => Promise<Response>` que TS no reconcilia automáticamente con `RouteConfigToTypedResponse<R>`. Se usa double assertion (`as unknown as RouteHandler<typeof route>`) — type assertion específica con el tipo target concreto (no `as never`). Behavior runtime es correcto y verificado con suite cross-variant.

**(i) Schemas Zod en `src/schemas.ts` (canónico) — B1 confirmado**

T-00 probe validó que `@hono/zod-openapi@1.3.0` con schemas importados desde módulo distinto funciona correctamente con `createRoute` y type inference. Issue #1412 de honojs/middleware NO afecta este setup. Schemas declarados en `src/schemas.ts` e importados desde `auth-handlers.ts` y `hono-openapi/index.ts`.

**(j) Parent OpenAPIHono required — CE1**

`evaAuthOpenAPIRoutes()` retorna un `OpenAPIHono` que debe montarse en un parent `OpenAPIHono` (no `Hono` plano). Si el parent es `new Hono()`, los paths NO aparecen en el documento `/doc` generado. Documentado con warning visible en `docs/configuration.md`. Referencia: honojs/middleware#952.

**(k) pnpm peer dep workaround — B2**

pnpm ≥8 no respeta consistentemente `peerDependenciesMeta.optional` (issues pnpm#5152, #8142). Consumers en pnpm que no usen `/hono-openapi` pueden recibir warning. Workaround documentado en `docs/configuration.md`: agregar `.npmrc` con `strict-peer-dependencies=false` o instalar explícitamente la peer dep.

### Consecuencias

- Cero breaking: consumers sin override de errorMessages reciben comportamiento idéntico.
- `evaAuthRoutes()` sin args: comportamiento idéntico al SDK anterior.
- Nuevo entry `@eva_solutions/auth-sdk/hono-openapi`: opt-in, zero impacto en consumers existentes.
- Re-exports adicionales en `/hono`, `/generic`, `/react`: aditivos, no reemplazan nada.

### Alternativas descartadas

- Namespace en EvaErrorMessages (`{ middleware: { authRequired } }`): complejidad sin beneficio claro para 16 keys.
- Validación manual sin Zod (plan v1): inconsistente con convención del SDK.
- Cache de messages() con invalidator: complejidad innecesaria para micro-ganancia de perf.
- defineOpenAPIRoute para wiring de routes: es la API para openapiRoutes() (array), no para app.openapi() individual.
- Schemas inline duplicados en hono-openapi/index.ts: innecesario, T-00 probe confirmó que cross-module funciona.

---

## ADR — Error shape `Result<T>.error` — Discriminated Union EvaError (D-02 v3)

**Fecha**: 2026-05-10
**Estado**: Aceptada (override post-audit Abogado del Diablo #2)
**Change**: `sync-auth-api-updates`

### Contexto

`Result<T>.error` era `string` en 0.x. El API cambió su wire de errores a `{ error: { code, message } }`, rompiendo el contrato. Necesitábamos una nueva forma que:
1. Represente errores del API (con `code` y `message`).
2. Represente errores internos del SDK (red, parsing, lógica de verify).
3. Sea idiomática en TypeScript moderno y friendly al tree-shaking.

### Alternativas evaluadas

| Opción | Shape | Pros | Contras |
|--------|-------|------|---------|
| A: string | `error: string` | Backward compat | No structured; imposible branching |
| B: objeto plano | `error: { code, message, status }` | Simple | Requiere inventar codes SDK sintéticos que contaminan el catálogo del API |
| C: discriminated union | `EvaError = EvaApiError \| EvaSdkError` | Type-safe, branching exhaustivo, sin contaminación de catálogos | Breaking change |

### Decisión

**Opción C — discriminated union**.

```typescript
type EvaApiError = { kind: 'api'; code: string; message: string; status: number }
type EvaSdkError = { kind: 'sdk'; reason: SdkErrorReason; message: string; status: number }
type EvaError = EvaApiError | EvaSdkError
type Result<T> = { ok: true; data: T } | { ok: false; error: EvaError }
```

### Rationale

- **Alineación cross-stack**: el API ya usa `LoginError = ApiError | ...` — mismo pattern.
- **Sin contaminación de catálogos**: errores del SDK tienen su propio enum cerrado (`SdkErrorReason`), no comparten espacio con los `ERROR_CODES` del API.
- **Exhaustiveness**: el compilador detecta branches faltantes en switch/if sobre `kind`.
- **Ecosistema**: patrón recomendado por neverthrow, ofetch `FetchError<T>`, Hono RPC. Idiomático TS 2025.
- **Override post-audit**: la Opción B (propuesta en decisiones v1 D-02) fue revisada por el Abogado del Diablo que identificó que los reasons de SDK no encajan en `code` sin inventar strings sintéticos. El usuario aceptó el override a Opción C.

### Consecuencias

- Breaking change: todos los callsites de `result.error` (como string) deben actualizarse.
- Helper `getMessage(err: EvaError): string` disponible para migración gradual.
- Migration guide en `docs/migration.md` con before/after.
- Bump major: 0.1.0 → 1.0.0.

### Referencias

- `sdd:sync-auth-api-updates:amendment:v3` — decisión de override
- neverthrow: https://github.com/supermacro/neverthrow

---

## ADR — Catálogo ERROR_CODES — fuente de verdad es el `as const` runtime del API (D-07)

**Fecha**: 2026-05-10
**Estado**: Aceptada
**Change**: `sync-auth-api-updates`

### Contexto

El API tiene 12 error codes core en `src/core/constants/error-codes.ts`. El JSDoc del archivo original decía "11 codes" (sin contar `account_state_locked`). El catálogo real en runtime tiene 12.

### Decisión

El SDK replica el `as const` runtime del API (12 entries, incluyendo `account_state_locked`), NO el JSDoc. El SDK exporta `ERROR_CODES` como espejo exacto. Aplica SOLO a `EvaApiError` (kind: `'api'`).

```typescript
export const ERROR_CODES = {
  account_state_locked:  'account_state_locked',
  unauthorized:          'unauthorized',
  validation_error:      'validation_error',
  not_found:             'not_found',
  conflict:              'conflict',
  forbidden:             'forbidden',
  rate_limited:          'rate_limited',
  gone:                  'gone',
  unprocessable_entity:  'unprocessable_entity',
  bad_request:           'bad_request',
  internal_error:        'internal_error',
  service_unavailable:   'service_unavailable',
} as const
```

### Rationale

El runtime manda. Documentación desincronizada con código es ruido. El SDK debe ser consistente con lo que el API realmente envía en el wire.

### Consecuencias

12 cores en el catálogo. `account_state_locked` no tiene HTTP default fijo (depende de la feature).

---

## ADR — Dual type `CoreErrorCode`/`ErrorCode` — apertura wire con autocomplete (D-08)

**Fecha**: 2026-05-10
**Estado**: Aceptada
**Change**: `sync-auth-api-updates`

### Contexto

El API usa `code: z.string()` (no `z.enum([...])`) — el catálogo es abierto. Features pueden agregar codes específicos (`service_client_already_exists`, `service_client_not_found`, etc.). El SDK debe permitir que consumers comparen con esos codes sin perder autocomplete para los 12 cores.

### Decisión

Dual type:
- `CoreErrorCode`: unión cerrada de los 12 valores — para autocomplete.
- `ErrorCode = CoreErrorCode | (string & {})` — tipo abierto — para features específicas.
- Ambos aplican SOLO a `EvaApiError.code` (kind: `'api'`).
- Para errores SDK (kind: `'sdk'`) se usa `SdkErrorReason` — enum cerrado, 6 valores.

### Rationale

El pattern `LiteralType | (string & {})` es idiomático en TS para catálogos semiabiertos con autocomplete. Preserva el DX (autocomplete de los 12 cores) sin bloquear feature-specific codes. La separación SDK/API en tipos distintos evita confusión conceptual.

### Consecuencias

`EvaApiError.code` tipado como `string` en runtime pero con `ErrorCode` como type (para uso en funciones). Los consumers pueden hacer `result.error.code === ERROR_CODES.unauthorized` con autocomplete completo.

---

## ADR — Wire de error HTTP del SDK — Configurable con default 'api' (D-13 v2)

**Fecha**: 2026-05-10
**Estado**: Aceptada (override D-13 — amendment v4)
**Change**: `sync-auth-api-updates`

### Contexto

El SDK emite respuestas HTTP de error desde dos puntos:
1. `buildAuthHandlers()` → `errorResponse()` en `src/auth-handlers.ts` (11 callsites).
2. `evaAuth()` middleware → rechazo de request no autenticado en `src/hono/middleware.ts`.

En 0.x, ambos emitían `{ error: "string" }` — legacy plain. El API ahora usa `{ error: { code, message } }`. La pregunta es: ¿qué wire debe emitir el SDK hacia sus consumers?

### Alternativas evaluadas

| Opción | Shape emitido | Pros | Contras |
|--------|--------------|------|---------|
| A: siempre legacy string | `{ error: string }` | Backward compat con consumers | Inconsistente con el API; consumers necesitan parseo diferente |
| B: siempre api shape | `{ error: { code, message } }` | Consistente cross-stack | Breaking change para consumers existentes |
| C: configurable con default='api' | `errorWire?: 'api' \| 'string'` | Consistente por default, escape para legacy | Pequeña complejidad de config |

### Decisión

**Opción C — configurable con default='api'**.

```typescript
configureEvaAuth({ errorWire: 'api' })    // default — shape del API
configureEvaAuth({ errorWire: 'string' }) // legacy plain
```

### Rationale

- **Consistencia cross-stack por default**: el API ya emite `{ error: { code, message } }`. El SDK debe replicar el contrato para que los consumers no necesiten parseo diferente según la fuente del error.
- **Escape para consumers legacy**: `errorWire: 'string'` permite migración gradual sin romper consumers existentes.
- **Pre-producción**: el proyecto no tiene consumers en producción, por lo que el default='api' (breaking vs 0.x) es viable.
- **Configuración en setup time**: la validación de `errorWire` ocurre en `configureEvaAuth()`, no en cada request.

### Consecuencias

- `src/config.ts`: nuevo campo `errorWire` en `_runtimeConfig` + getter `getErrorWire()`.
- `src/auth-handlers.ts`: `errorResponse()` privado consulta `getErrorWire()` + nuevo `resolveCode()`.
- `src/hono/middleware.ts`: final return consulta `getErrorWire()` — inline (1 reason fijo: `auth_required` → `'unauthorized'`).
- Tests: actualizados al shape `'api'` (default) cuando no se configura `errorWire`.
- `docs/configuration.md`: opción `errorWire` documentada.
- OpenAPI spec (`ErrorResponseSchema`): siempre refleja el shape `'api'` independientemente de la config — ver nota en `docs/configuration.md`.

---

## ADR — Hard delete de src/errors.ts sin migración gradual (D-09 v2)

**Fecha**: 2026-05-10
**Estado**: Aceptada (override D-09 — amendment v4)
**Change**: `sync-auth-api-updates`

### Contexto

`src/errors.ts` contenía `EvaAuthError`, `createAuthError`, `isAuthError` (legacy 0.x) y `parseErrorResponse(response: Response)` (async, tomaba Response completo). El design v1 proponía `@deprecated` gradual. El usuario override a hard delete.

### Decisión

Hard delete de `src/errors.ts`. Ningún símbolo migrado ni deprecado.
- `EvaAuthError`, `createAuthError`, `isAuthError` → eliminados sin reemplazo (tipos legacy 0.x que no existen en 1.0.0).
- `parseErrorResponse` async → reemplazada por versión sync en `src/schemas.ts` con firma `(status: number, body: unknown): EvaError`.

### Rationale

- Proyecto pre-producción: sin consumers externos que dependan de estos símbolos.
- Código legacy `EvaAuthError` sería confuso junto a `EvaError` del nuevo sistema.
- Eliminar directamente reduce deuda técnica de día uno.

### Consecuencias

- `src/index.ts`: re-exports de `./errors` eliminados.
- `src/http-client.ts`: import de `parseErrorResponse` migrado a `./schemas`.
- Tests que importaban de `./errors`: actualizados o eliminados.
- Migration guide (`docs/migration.md`): documenta que `EvaAuthError` no existe en 1.0.0.

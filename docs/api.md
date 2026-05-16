# Referencia de API

## `@eva_solutions/auth-sdk`

Entry point principal. Core del SDK.

### Funciones

#### `createEvaAuth()`

Obtiene acceso directo al HTTP client para llamadas server-to-server al Auth Service. **Uso avanzado** — el flujo normal usa `evaAuth()` middleware y `evaAuthRoutes()` directamente, sin necesidad de llamar a esta función.

No recibe parámetros. La URL del Auth Service y el entorno se hornean en build-time.

```ts
const { client } = createEvaAuth()
```

Retorna `{ client: EvaHttpClient }`.

---

#### `createHttpClient()`

Crea un cliente HTTP tipado contra el Auth Service.

```ts
const client = createHttpClient()
```

Retorna `EvaHttpClient`.

---

#### `verifyAccessToken<TExtra extends Record<string, unknown> = {}>(token: string, opts?: { extraClaimsSchema?: ZodType<TExtra> })`

Verifica un JWT localmente usando la public key del JWKS. Soporta extensión de claims con validación de schema.

```ts
// Sin claims extra (solo id, sessionId)
const result = await verifyAccessToken(token)
if (result.ok) {
  console.log(result.data.id) // string
}

// Con claims extra validados
const phoneSchema = z.object({ phone: z.string() })
const result = await verifyAccessToken<{ phone: string }>(token, {
  extraClaimsSchema: phoneSchema
})
if (result.ok) {
  console.log(result.data.phone) // string | guaranteed
}
```

Retorna `Promise<Result<EvaTokenPayload<TExtra> & TExtra>>`.

---

#### `getPublicKey()`

Obtiene la public key del JWKS endpoint. Usa cache con ETag/304.

```ts
const key = await getPublicKey()
```

Retorna `Promise<CryptoKey>`.

---

#### `fetchJwks()`

Fuerza un fetch del JWKS, ignorando la cache.

```ts
await fetchJwks()
```

Retorna `Promise<void>`.

---

#### `clearJwksCache()`

Limpia la cache local del JWKS.

```ts
clearJwksCache()
```

Retorna `void`.

---

### Types exportados

| Type | Descripción |
|------|-------------|
| `EvaUser` | Datos del usuario autenticado |
| `EvaSession` | Sesión activa del usuario |
| `EvaEmpresa` | Empresa asociada al usuario |
| `EvaTokenPayload<TExtra>` | Claims base del JWT: `{ id: string, sessionId: string }`. Extendible con TExtra. |
| `Result<T>` | `{ ok: true, data: T } \| { ok: false, error: EvaError }` |
| `EvaApiError` | Error del Auth Service: `{ kind: 'api', code, message, status }` |
| `EvaSdkError` | Error interno del SDK: `{ kind: 'sdk', reason, message, status }` |
| `EvaError` | `EvaApiError \| EvaSdkError` — discriminated union |
| `CoreErrorCode` | Unión cerrada de los 12 codes core del API |
| `ErrorCode` | `CoreErrorCode \| (string & {})` — tipo abierto para feature-specific codes |
| `SdkErrorReason` | Enum cerrado de 6 reasons internos del SDK |
| `DeviceInfo` | Información parseada del User-Agent |
| `TokenPair` | Par de access + refresh token |
| `ActivityState` | Estado de actividad |
| `PrivacyState` | Estado de privacidad |
| `ReservedJwtClaim` | Tipo union: `typeof RESERVED_JWT_CLAIMS[number]` |
| `EvaErrorMessages` | Interface con las 16 keys de mensajes de error del SDK |
| `ConfigureEvaAuthOptions` | Opciones de `configureEvaAuth()` incluyendo `errorMessages?` y `errorWire?` |

### Error utilities

#### `getMessage(err: EvaError)`

Helper de conveniencia para obtener el mensaje de un `EvaError`. Equivale a `err.message`. Útil para migración gradual desde 0.x.

```ts
import { getMessage } from '@eva_solutions/auth-sdk'

const result = await verifyRequest(req)
if (!result.ok) {
  console.error(getMessage(result.error)) // === result.error.message
}
```

Retorna `string`.

---

### Constantes

| Constante | Descripción |
|-----------|-------------|
| `HEADERS` | Nombres de headers custom (`Authorization`, `X-Eva-Refresh-Token`, etc.) |
| `COOKIES` | Nombres de cookies (`eva_access_token`, `eva_refresh_token`) |
| `COOKIE_MAX_AGE` | TTL de cookies (access: 900s, refresh: 2592000s) |
| `JWT_CONFIG` | Configuración de verificación JWT (issuer, audience, algorithms) |
| `RESERVED_JWT_CLAIMS` | Array readonly con 12 claims reservados (RFC 7519 + OIDC): `iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`, `nonce`, `auth_time`, `acr`, `amr`, `azp` |
| `DEFAULT_ERROR_MESSAGES` | Objeto frozen con los 16 mensajes de error en español (ver tabla en [configuration.md](configuration.md#mensajes-de-error-personalizados)) |
| `ERROR_CODES` | Catálogo de 12 error codes core del Auth Service. Solo aplica a `EvaApiError` (kind: `'api'`). |
| `SDK_ERROR_REASONS` | Enum cerrado de 6 reasons internos del SDK. Solo aplica a `EvaSdkError` (kind: `'sdk'`). |
| `ACCOUNT_STATES` | Catálogo de 6 estados de cuenta: `no_verificado`, `verificado`, `pendiente_de_verificacion`, `suspendido`, `baneado`, `eliminado`. Úsalo en lugar de magic strings para comparar `stateAccount`. |
| `WEBHOOK_HEADERS` | Nombres de los headers HTTP que el Auth Service incluye en cada webhook: `SIGNATURE`, `ID`, `TIMESTAMP`. |
| `ADMIN_ERROR_CODES` | Códigos de error específicos del módulo Admin: `service_client_already_exists`, `service_client_not_found`. |
| `S2S_SCOPES` | Catálogo de scopes S2S reconocidos: `USERS_READ`, `WEBHOOKS_READ`, `WEBHOOKS_WRITE`. |
| `S2S_RESPONSE_HEADERS` | Header de respuesta S2S: `SERVER_TIME` (`x-eva-server-time`). |
| `USERS_BATCH_MAX_IDS` | Número máximo de IDs por llamada a `batchUsers` (100). El cliente valida este límite antes de hacer fetch. |

### Re-exports desde `@eva_solutions/auth-sdk`

| Export | Tipo | Descripción |
|--------|------|-------------|
| `readTokensFromCookies` | función | Lee tokens desde un string de cookies; retorna `{ accessToken?, refreshToken? }` |
| `DEFAULT_ERROR_MESSAGES` | constante | Objeto frozen con los 16 defaults en español |
| `EvaErrorMessages` | type | Interface de los 16 keys de mensajes de error |
| `ERROR_CODES` | constante | Catálogo de 12 codes core del Auth Service |
| `SDK_ERROR_REASONS` | constante | 6 reasons del SDK como `as const` |
| `getMessage` | función | Helper `getMessage(err: EvaError): string` |
| `verifyWebhookSignature` | función | Verifica firma HMAC-SHA256 de webhooks |
| `EVENT_CODES` | constante | 11 event codes del Auth Service |
| `WEBHOOK_HEADERS` | constante | Headers de webhooks entrantes (SIGNATURE, ID, TIMESTAMP) |
| `createAdminClient` | función | Factory del cliente Admin |
| `ADMIN_ERROR_CODES` | constante | Error codes específicos del módulo Admin |
| `createS2SClient` | función | Factory del cliente S2S |
| `S2S_SCOPES` | constante | Scopes S2S reconocidos por el Auth Service |
| `S2S_RESPONSE_HEADERS` | constante | Headers de respuesta S2S (SERVER_TIME) |
| `USERS_BATCH_MAX_IDS` | constante | Límite de IDs por llamada a `batchUsers` (100) |
| `ACCOUNT_STATES` | constante | Catálogo de estados de cuenta de usuario |
| `AccountState` | type | Unión de literales de estados de cuenta |
| `S2SScope` | type | Unión de literales de scopes S2S |
| `AdminErrorCode` | type | Unión de literales de error codes Admin |

---

## `@eva_solutions/auth-sdk/hono`

Integración con Hono. Middleware, rutas y helpers.

### `evaAuth<TExtra extends Record<string, unknown> = {}>(opts?: EvaAuthOptions<TExtra>)`

Middleware que protege rutas. Lee cookies, verifica JWT, auto-refresh si expirado, inyecta payload en context, actualiza cookies.

```ts
import { evaAuth } from '@eva_solutions/auth-sdk/hono'

// Sin opciones
app.use('/api/*', evaAuth())

// Con claims extra validados
const phoneSchema = z.object({ phone: z.string() })
app.use('/api/*', evaAuth({ extraClaimsSchema: phoneSchema }))

// Con mensajes de error personalizados
app.use('/api/*', evaAuth({ errorMessages: { authRequired: 'Authentication required' } }))
```

Retorna `MiddlewareHandler<{ Variables: { evaPayload: EvaTokenPayload<TExtra> & TExtra } }>`.

**`EvaAuthOptions<TExtra>`:**

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `extraClaimsSchema` | `ZodType<TExtra>` | Schema para validar claims extra del JWT |
| `errorMessages` | `Partial<EvaErrorMessages>` | Override local de mensajes de error |

---

### `evaAuthRoutes(opts?: EvaAuthRoutesOptions)`

Sub-router con todos los endpoints de auth. Se monta como ruta en Hono.

```ts
import { evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

// Sin opciones
app.route('/auth', evaAuthRoutes())

// Con mensajes de error personalizados
app.route('/auth', evaAuthRoutes({
  errorMessages: { loginFailed: 'Credenciales incorrectas' },
}))
```

Retorna `Hono`.

**`EvaAuthRoutesOptions`:**

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `errorMessages` | `Partial<EvaErrorMessages>` | Override local de mensajes de error |

#### Endpoints

| Método | Ruta | Body / Entrada | Respuesta |
|--------|------|----------------|-----------|
| `POST` | `/get-code` | `{ phone }` | `{ data: { message } }` |
| `POST` | `/login` | `{ phone, code }` | `{ data: { user: { id } } }` + Set-Cookie |
| `POST` | `/refresh` | cookies | `{ data: { user: { id } } }` + Set-Cookie |
| `POST` | `/logout` | cookies | `{ data: { message } }` + Clear-Cookie |
| `GET` | `/me` | cookies | `{ data: EvaUser }` |
| `PATCH` | `/me` | body + cookies | `{ data: EvaUser }` |
| `DELETE` | `/me` | cookies | `{ data: { message } }` + Clear-Cookie |
| `GET` | `/empresas` | cookies | `{ data: EvaEmpresa[] }` |
| `GET` | `/sessions` | cookies | `{ data: EvaSession[] }` |
| `DELETE` | `/sessions/:id` | cookies | `{ data: { message } }` |
| `DELETE` | `/sessions` | cookies | `{ data: { message, count } }` + Clear-Cookie |

---

### `getEvaPayload<TExtra extends Record<string, unknown> = {}>(c)`

Extrae el payload del JWT desde el context de Hono. Requiere que `evaAuth()` esté aplicado. El tipo retornado coincide con el tipo pasado a `evaAuth<TExtra>`.

```ts
app.get('/api/profile', (c) => {
  const payload = getEvaPayload(c) // EvaTokenPayload<{}>
  return c.json({ userId: payload.id })
})

// Con claims extra
app.get('/api/profile', (c) => {
  const payload = getEvaPayload<{ phone: string }>(c)
  return c.json({ userId: payload.id, phone: payload.phone })
})
```

Retorna `EvaTokenPayload<TExtra> & TExtra`. Lanza error si el middleware no está aplicado.

---

### `getSessionId(c)`

Extrae el session ID del context.

```ts
const sessionId = getSessionId(c)
```

Retorna `string`.

---

### `parseDeviceInfo(request)`

Parsea el User-Agent de una request usando bowser.

```ts
const deviceInfo = parseDeviceInfo(c.req.raw)
```

Retorna `DeviceInfo`.

---

### Re-exports desde `@eva_solutions/auth-sdk/hono`

Además de sus propias funciones, el entry point `/hono` re-exporta los siguientes símbolos para evitar imports cruzados:

| Export | Origen | Descripción |
|--------|--------|-------------|
| `readTokensFromCookies` | `cookies.ts` | Lee tokens desde un string de cookies |
| `setTokenCookies` | `cookies.ts` | Genera headers Set-Cookie para access + refresh |
| `clearTokenCookies` | `cookies.ts` | Genera headers Set-Cookie con Max-Age=0 |
| `COOKIES` | `constants.ts` | Nombres de las cookies |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 16 keys |
| `EvaAuthRoutesOptions` | `hono/auth-routes.ts` | Opciones de `evaAuthRoutes()` |
| `getAuthUrl` | `config.ts` | URL del Auth Service resuelta |
| `getEvaEnv` | `config.ts` | Entorno actual |
| `getCookieDomain` | `config.ts` | Cookie domain configurado |

---

## `@eva_solutions/auth-sdk/hono-openapi`

Variante de las rutas de auth compatible con OpenAPI 3.1. Requiere `@hono/zod-openapi >=1.3.0` instalado en el proyecto consumidor.

> **Importante**: `evaAuthOpenAPIRoutes()` retorna un `OpenAPIHono`. Para que `/doc` funcione, el app padre también debe ser `OpenAPIHono`. Si se monta sobre `new Hono()`, los handlers funcionan pero la documentación no estará disponible.

### `evaAuthOpenAPIRoutes(opts?: EvaAuthOpenAPIRoutesOptions)`

Crea un `OpenAPIHono` con 11 rutas de auth documentadas según OpenAPI 3.1.

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { evaAuthOpenAPIRoutes } from '@eva_solutions/auth-sdk/hono-openapi'

const app = new OpenAPIHono()  // padre DEBE ser OpenAPIHono
app.route('/auth', evaAuthOpenAPIRoutes())

// Spec en /doc
app.get('/doc', (c) => c.json(app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Eva Auth API', version: '1.0.0' },
})))
```

Retorna `OpenAPIHono`.

**`EvaAuthOpenAPIRoutesOptions`:** Idéntico a `EvaAuthRoutesOptions`.

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `errorMessages` | `Partial<EvaErrorMessages>` | Override local de mensajes de error |

### Re-exports desde `@eva_solutions/auth-sdk/hono-openapi`

| Export | Origen | Descripción |
|--------|--------|-------------|
| `OpenAPIHono` | `@hono/zod-openapi` | Re-export para conveniencia |
| `createRoute` | `@hono/zod-openapi` | Función para definir rutas tipadas |
| `defineOpenAPIRoute` | `@hono/zod-openapi` | Identity function para array API `openapiRoutes()` |

---

## `@eva_solutions/auth-sdk/generic`

Funciones framework-agnostic usando Web API estándar (`Request`).

### `verifyRequest<TExtra extends Record<string, unknown> = {}>(request: Request, opts?: VerifyRequestOptions<TExtra>)`

Verifica una Web API Request. Lee cookies, valida JWT, ejecuta auto-refresh si necesario. Soporta extensión de claims con validación de schema.

```ts
// Sin claims extra
const result = await verifyRequest(request)
if (result.ok) {
  const { payload, newCookies } = result.data
  // payload: EvaTokenPayload<{}>
  // newCookies: string[] | undefined (headers Set-Cookie si hubo refresh)
}

// Con claims extra validados
const phoneSchema = z.object({ phone: z.string() })
const result = await verifyRequest<{ phone: string }>(request, {
  extraClaimsSchema: phoneSchema
})
if (result.ok) {
  const { payload } = result.data
  // payload: EvaTokenPayload<{ phone: string }> & { phone: string }
}
```

Retorna `Promise<Result<{ payload: EvaTokenPayload<TExtra> & TExtra, newCookies?: string[] }>>`.

**`VerifyRequestOptions<TExtra>`:**

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `extraClaimsSchema` | `ZodType<TExtra>` | Schema para validar claims extra del JWT |
| `errorMessages` | `Partial<EvaErrorMessages>` | Override local de mensajes de error |

---

### `setTokenCookies(tokens: TokenPair)`

Genera headers `Set-Cookie` para setear ambos tokens como cookies.

```ts
const headers = setTokenCookies(tokens)
// headers: string[]
```

Retorna `string[]`.

---

### `clearTokenCookies()`

Genera headers `Set-Cookie` para limpiar las cookies de auth.

```ts
const headers = clearTokenCookies()
```

Retorna `string[]`.

---

### Re-exports desde `@eva_solutions/auth-sdk/generic`

| Export | Origen | Descripción |
|--------|--------|-------------|
| `readTokensFromCookies` | `cookies.ts` | Lee tokens desde un string de cookies |
| `COOKIES` | `constants.ts` | Nombres de las cookies |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 16 keys |
| `getAuthUrl` | `config.ts` | URL del Auth Service resuelta |
| `getEvaEnv` | `config.ts` | Entorno actual |
| `getCookieDomain` | `config.ts` | Cookie domain configurado |

---

## Comportamiento crítico con claims extensibles

### Sin `extraClaimsSchema`

Cuando NO proporcionas un schema, el payload retornado es **exactamente** `{ id: string, sessionId: string }`. **Ningún claim extra del JWT se expone**, aunque existan en el token:

```ts
// JWT contiene: { id, sessionId, sub, phone, custom_role, ... }
const result = await verifyAccessToken(token)
// result.data es SOLO { id, sessionId }
// phone, custom_role, etc. NO están disponibles
```

### Con `extraClaimsSchema`

Cuando proporcionas un schema, el SDK:

1. Filtra claims reservados (`RESERVED_JWT_CLAIMS`) + propiedades base (`id`, `sessionId`, `sub`)
2. Valida los restantes contra el schema
3. Merge los validados al payload

```ts
const phoneSchema = z.object({ phone: z.string() })
const result = await verifyAccessToken<{ phone: string }>(token, {
  extraClaimsSchema: phoneSchema
})
// result.data es { id, sessionId, phone } si válido
// Si el claim phone no existe o es inválido → 401 "Token claims invalid"
```

### Error: Claim reservado en schema

Si intentas incluir un claim reservado en `extraClaimsSchema`, lanza un error inmediatamente:

```ts
const badSchema = z.object({ exp: z.number() }) // exp es reservado
const result = await verifyAccessToken(token, {
  extraClaimsSchema: badSchema
})
// Throws: "Claim reservado no puede usarse en extraClaimsSchema: exp"
```

### Error: Schema mismatch

Si el JWT no tiene un claim obligatorio del schema, o los tipos no coinciden, retorna 401:

```ts
const result = await verifyAccessToken<{ phone: string }>(token, {
  extraClaimsSchema: z.object({ phone: z.string() })
})
if (!result.ok) {
  console.log(result.error.message) // "Token claims invalid"
  console.log(result.error.status)  // 401
}
```

---

## Anti-patterns comunes

### Tipado sin schema = runtime undefined

**Problema:** TypeScript dice que `payload.phone` existe, pero a runtime es `undefined` porque no pasaste schema.

```ts
// MAL: El tipo miente
const payload = await verifyAccessToken<{ phone: string }>(token)
console.log(payload.data.phone) // TS: string | undefined
                                // Runtime: undefined (claim no se incluyó sin schema)

// BIEN: Pasar el schema para que realmente se incluya
const payload = await verifyAccessToken<{ phone: string }>(token, {
  extraClaimsSchema: z.object({ phone: z.string() })
})
console.log(payload.data.phone) // TS: string | undefined
                                // Runtime: string (garantizado)
```

**Solución:** Siempre pasa `extraClaimsSchema` si esperas claims extensibles. El tipo y el runtime coincidirán.

### Schema de claims internos

No intentes validar claims base (`id`, `sessionId`) nuevamente en el schema. El SDK ya lo hace:

```ts
// MAL
const schema = z.object({
  id: z.string(), // Redundante, ya validado
  phone: z.string()
})

// BIEN
const schema = z.object({
  phone: z.string() // Solo claims extra
})
```

---

## Referencias

- **ADR-011**: Token Extensibility — Decisión de diseño de claims genéricos. Ver `docs/decisions.md`.
- **Configuración**: Sección "Extending JWT claims" en `docs/configuration.md`.

---

## Error handling — `EvaError` (v1.0.0+)

Desde v1.0.0, `Result<T>.error` es una **discriminated union** con dos variantes:

### EvaApiError — errores del Auth Service

```typescript
type EvaApiError = {
  kind: 'api'
  code: string      // ErrorCode (CoreErrorCode | string)
  message: string
  status: number    // HTTP status (400–503)
}
```

### EvaSdkError — errores internos del SDK

```typescript
type EvaSdkError = {
  kind: 'sdk'
  reason: SdkErrorReason  // enum cerrado: 6 valores
  message: string
  status: number           // 401 (auth), 500 (verify_failed), 0 (network/malformed)
}

type SdkErrorReason =
  | 'auth_required'      // no hay tokens en el request
  | 'token_invalid'      // token presente pero inválido
  | 'refresh_no_tokens'  // refresh OK pero sin tokens nuevos
  | 'verify_failed'      // fallo de verificación no clasificable
  | 'network'            // error de red / fetch fallido
  | 'malformed'          // respuesta HTTP no parseable
```

### Narrowing por kind

```typescript
import { ERROR_CODES, getMessage } from '@eva_solutions/auth-sdk'

const result = await verifyRequest(req)
if (!result.ok) {
  // Narrowing por kind:
  if (result.error.kind === 'api') {
    // result.error es EvaApiError — .code disponible
    if (result.error.code === ERROR_CODES.rate_limited) {
      return new Response('Too many requests', { status: 429 })
    }
  } else {
    // result.error es EvaSdkError — .reason disponible
    if (result.error.reason === 'auth_required') {
      return new Response('Unauthorized', { status: 401 })
    }
  }
  // Fallback: solo el mensaje
  return new Response(result.error.message, { status: result.error.status || 500 })
}
```

### Helper getMessage (migración gradual)

```typescript
import { getMessage } from '@eva_solutions/auth-sdk'

if (!result.ok) {
  console.error(getMessage(result.error))  // equivale a result.error.message
}
```

### ERROR_CODES — catálogo core

```typescript
import { ERROR_CODES } from '@eva_solutions/auth-sdk'
// ERROR_CODES.unauthorized, .not_found, .rate_limited, .conflict, etc.
// 12 codes core. Solo aplican a kind: 'api'.
```

---

## `@eva_solutions/auth-sdk/webhooks`

Utilidades para verificar firmas de webhooks entrantes del Auth Service.

### `verifyWebhookSignature(params)`

```typescript
import { verifyWebhookSignature } from '@eva_solutions/auth-sdk/webhooks'
// o desde el entry point principal:
import { verifyWebhookSignature } from '@eva_solutions/auth-sdk'

const isValid = await verifyWebhookSignature({
  rawBody: await req.text(),                                   // body raw como string, sin parsear
  signingKey: process.env.WEBHOOK_SIGNING_KEY!,               // hex 64 chars del API
  signature: req.headers.get('x-eva-webhook-signature')!,     // "sha256=<hex>"
  eventId: req.headers.get('x-eva-webhook-id')!,
  timestamp: Number(req.headers.get('x-eva-webhook-timestamp')),
})

if (!isValid) {
  return new Response('Invalid signature', { status: 401 })
}
```

**IMPORTANTE**: `signingKey` es el `secretHash` del subscription tal como el API lo entrega — **NO debe re-hashearse** antes de pasarlo. Re-hashearlo produce `false`.

### Ventana anti-replay

El SDK verifica que `|now - timestamp| <= 300` segundos (`WEBHOOK_TIMESTAMP_WINDOW_SECONDS`). Requests con timestamp fuera de ventana retornan `false`.

### `EVENT_CODES`

```typescript
import { EVENT_CODES } from '@eva_solutions/auth-sdk/webhooks'

EVENT_CODES.USER_CREATED         // 'user.created'
EVENT_CODES.USER_VERIFIED        // 'user.verified'
EVENT_CODES.USER_LOGIN_SUCCESS   // 'user.login_success'
EVENT_CODES.USER_LOGIN_FAILED    // 'user.login_failed'
EVENT_CODES.SESSION_CREATED      // 'session.created'
EVENT_CODES.SESSION_DELETED      // 'session.deleted'
EVENT_CODES.SESSION_DELETED_ALL  // 'session.deleted_all'
EVENT_CODES.USER_PROFILE_UPDATED // 'user.profile_updated'
EVENT_CODES.USER_DELETED         // 'user.deleted'
EVENT_CODES.USER_RESTORED        // 'user.restored'
EVENT_CODES.USER_HARD_DELETED    // 'user.hard_deleted'
```

### Payload wire

```typescript
type WebhookPayload<TData = Record<string, unknown>> = {
  id: string        // evento UUID
  eventCode: EventCode
  timestamp: number // unix seconds
  data: TData
}
```

---

## `@eva_solutions/auth-sdk/admin`

Para operaciones de administración de service clients y restauración de usuarios.

```typescript
import { createAdminClient } from '@eva_solutions/auth-sdk/admin'

const admin = createAdminClient({
  adminPassword: process.env.EVA_ADMIN_PASSWORD!,
  baseUrl: 'https://auth.miapp.com',
})

// Crear service client
const result = await admin.createServiceClient({
  slug: 'mi-servicio',
  name: 'Mi Servicio',
  scopes: ['users:read'],
})
if (result.ok) {
  console.log(result.data.secret) // guardar AHORA — no se muestra de nuevo
}

// Listar
const list = await admin.listServiceClients()

// Obtener por slug
const detail = await admin.getServiceClient('mi-servicio')

// Actualizar
const updated = await admin.updateServiceClient('mi-servicio', { enabled: false })

// Eliminar
await admin.deleteServiceClient('mi-servicio') // 204, result.data es void

// Rotar secret
const rotated = await admin.rotateServiceClientSecret('mi-servicio')

// Restaurar usuario eliminado
const restored = await admin.restoreUser('uuid-del-usuario')
```

### Métodos del AdminClient

| Método | HTTP | Path | Descripción |
|--------|------|------|-------------|
| `createServiceClient(input)` | POST | `/admin/service-clients` | Crea client. Secret one-time. |
| `listServiceClients()` | GET | `/admin/service-clients` | Lista todos. |
| `getServiceClient(slug)` | GET | `/admin/service-clients/:slug` | Detalle por slug. |
| `updateServiceClient(slug, input)` | PATCH | `/admin/service-clients/:slug` | Parche parcial. |
| `deleteServiceClient(slug)` | DELETE | `/admin/service-clients/:slug` | Hard-delete. 204. |
| `rotateServiceClientSecret(slug)` | POST | `/admin/service-clients/:slug/rotate-secret` | Rota secret. One-time. |
| `restoreUser(userId)` | POST | `/admin/users/:id/restore` | Restaura usuario eliminado. |

Todos los métodos retornan `Promise<Result<T>>` con `error: EvaError`.

> **Advertencia**: solo usar desde backends seguros. La contraseña de admin nunca debe exponerse en el cliente/browser.

---

## `@eva_solutions/auth-sdk/s2s`

Para llamadas internas al Auth Service autenticadas con HMAC S2S (SigV4-style).

```typescript
import { createS2SClient } from '@eva_solutions/auth-sdk/s2s'

const s2s = createS2SClient({
  clientId: 'mi-servicio',            // slug del service client
  secretHex: process.env.S2S_SECRET!, // hex del secret
  baseUrl: 'https://auth.example.com',
})

// Obtener usuario por ID
const user = await s2s.getUser('uuid-del-usuario')

// Lote de usuarios
const users = await s2s.batchUsers({ ids: ['uuid1', 'uuid2'] })

// Gestión de webhook subscriptions
const sub = await s2s.createWebhookSubscription({
  url: 'https://mi-app.com/webhooks',
  eventCodes: ['user.created', 'user.deleted'],
})
if (sub.ok) {
  console.log(sub.data.signingKey) // guardar para verificación
}

const subs = await s2s.listWebhookSubscriptions()
const rotated = await s2s.rotateWebhookSubscriptionSecret('subscription-id')
const deliveries = await s2s.listWebhookDeliveries({ status: 'failed', limit: 20 })
```

### Firma HMAC automática

El cliente genera automáticamente los headers de autenticación S2S:

| Header | Descripción |
|--------|-------------|
| `x-eva-client-id` | Slug del service client |
| `x-eva-timestamp` | Unix seconds del request |
| `x-eva-signature` | `sha256=<hmac-sha256-hex>` |

### Canonical string

El SDK construye el canonical string de la firma como:

```
METHOD\n
/path\n
rawQuery\n
timestamp\n
clientId\n
sha256(bodyBytes)
```

Para requests sin body, se usa el hash del cuerpo vacío (`EMPTY_BODY_SHA256_HEX`).

### Métodos del S2SClient

| Método | HTTP | Path | Descripción |
|--------|------|------|-------------|
| `getUser(userId)` | GET | `/internal/users/:id` | Obtiene usuario por ID. |
| `batchUsers(input)` | POST | `/internal/users/batch` | Lote de usuarios por IDs. |
| `createWebhookSubscription(input)` | POST | `/internal/webhooks/subscriptions` | Crea subscription. `signingKey` one-time. |
| `listWebhookSubscriptions()` | GET | `/internal/webhooks/subscriptions` | Lista subscriptions. |
| `getWebhookSubscription(id)` | GET | `/internal/webhooks/subscriptions/:id` | Detalle por ID. |
| `updateWebhookSubscription(id, input)` | PATCH | `/internal/webhooks/subscriptions/:id` | Actualiza subscription. |
| `deleteWebhookSubscription(id)` | DELETE | `/internal/webhooks/subscriptions/:id` | Elimina subscription. 204. |
| `rotateWebhookSubscriptionSecret(id)` | POST | `/internal/webhooks/subscriptions/:id/rotate-secret` | Rota signing key. One-time. |
| `listWebhookDeliveries(query?)` | GET | `/internal/webhooks/deliveries` | Lista entregas con filtros. |

Todos los métodos retornan `Promise<Result<T>>` con `error: EvaError`.

---

## `@eva_solutions/auth-sdk/react`

Componentes y hooks para React.

### `EvaAuthProvider`

Context provider que gestiona el estado de autenticación. Ejecuta silent refresh al montar.

```tsx
import { EvaAuthProvider } from '@eva_solutions/auth-sdk/react'

<EvaAuthProvider basePath="/auth" onAuthChange={(auth) => console.log(auth)}>
  <App />
</EvaAuthProvider>
```

| Prop | Tipo | Requerido | Descripción |
|------|------|-----------|-------------|
| `children` | `ReactNode` | Sí | Componentes hijos |
| `basePath` | `string` | No | Prefijo de las rutas de auth (default: `/auth`) |
| `apiUrl` | `string` | No | URL base del backend. Si se proporciona, se antepone a `basePath`. Útil cuando el frontend se comunica con un backend en otro dominio. |
| `onAuthChange` | `(auth) => void` | No | Callback cuando cambia el estado de auth |

---

### `useAuth()`

Hook principal de autenticación.

```ts
const { isAuthenticated, isLoading, error, login, logout } = useAuth()

// Login en dos pasos
await login.getCode(phone)
await login.verify(phone, code)

// Logout
await logout()
```

Retorna:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isAuthenticated` | `boolean` | Si hay sesión activa |
| `isLoading` | `boolean` | Si hay operación en curso |
| `error` | `string \| null` | Último error |
| `login.getCode` | `(phone) => Promise` | Solicita código OTP |
| `login.verify` | `(phone, code) => Promise` | Verifica código y autentica |
| `logout` | `() => Promise` | Cierra sesión |

---

### `useUser()`

Hook para obtener datos del usuario autenticado. Usa `useAuthData` internamente para `GET /me`.

```ts
const { data, isLoading, error } = useUser()
```

---

### `useSessions()`

Hook para obtener sesiones activas. Usa `useAuthData` internamente para `GET /sessions`.

```ts
const { data, isLoading, error } = useSessions()
```

---

### `useEmpresas()`

Hook para obtener empresas del usuario. Usa `useAuthData` internamente para `GET /empresas`.

```ts
const { data, isLoading, error } = useEmpresas()
```

---

### `authFetch<T>(url, options?)`

Fetch wrapper con `credentials: 'include'` y `Content-Type: application/json`.

```ts
const result = await authFetch<EvaUser>('/auth/me')
if (result.ok) {
  console.log(result.data)
}
```

Retorna `Promise<Result<T>>`.

Timeout de **30 segundos**. Distingue errores:

| Error | `status` | Descripción |
|-------|----------|-------------|
| `'Tiempo de espera agotado'` | `0` | Timeout de 30s excedido |
| `'Solicitud cancelada'` | `0` | Abortada externamente (ej: unmount) |
| `'Error de red'` | `0` | Otro error de conexión |

**Compatibilidad:** Usa `AbortSignal.any()` internamente, que requiere Chrome 116+, Safari 17.4+, Firefox 124+.

**Nota sobre tipado:** La respuesta del Auth Service se valida estructuralmente (`{ data: T }`), pero el contenido de `data` se castea como `T` sin un schema Zod específico. Esto asume confianza en el backend. Si el consumidor necesita validación estricta, debe aplicar su propio schema sobre `result.data`.

---

### Re-exports desde `@eva_solutions/auth-sdk/react`

| Export | Origen | Descripción |
|--------|--------|-------------|
| `readTokensFromCookies` | `cookies.ts` | Lee tokens desde un string de cookies |
| `COOKIES` | `constants.ts` | Nombres de las cookies |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 16 keys |

---

## Referencias cruzadas

- **ADR-011**: `EvaTokenPayload<TExtra>` y `extraClaimsSchema` — ver [decisions.md](decisions.md#adr-011-generic-evatokenpayload--optional-schema-validation)
- **ADR-012**: Sistema i18n de mensajes de error, `buildAuthHandlers`, entry point `/hono-openapi` — ver [decisions.md](decisions.md#adr-012-sistema-i18n-de-mensajes-de-error)
- **ADR — EvaError discriminated union**: D-02 v3 — ver [decisions.md](decisions.md)
- **ADR — errorWire configurable**: D-13 v2 — ver [decisions.md](decisions.md)
- **Migration 0.x → 1.0.0**: [migration.md](migration.md)
- **Configuración completa**: [configuration.md](configuration.md)

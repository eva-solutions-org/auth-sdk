# Referencia de API

## `@eva_solutions/auth-sdk`

Entry point principal. Core del SDK.

### Funciones

#### `createEvaAuth()`

Obtiene acceso directo al HTTP client para llamadas server-to-server al Auth Service. **Uso avanzado** — el flujo normal usa `evaAuth()` middleware y `evaAuthRoutes()` directamente, sin necesidad de llamar a esta función.

No recibe parámetros. Usa la URL del Auth Service configurada con `configureEvaAuth({ authUrl })`; los usos que la necesitan lanzan un error de configuración si no se configuró (ver [configuration.md](configuration.md#url-del-auth-service)).

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

Retorna `EvaHttpClient`. Además de login, sesiones y empresas del usuario, trae `getDirectorio({ accessToken, q?, rubro?, ciudad?, cursor? })` (`GET /api/v1/directorio`): busca en el directorio de empresas con el access token de **cualquier producto habilitado** (Auth limita los pedidos por usuario). Devuelve `{ empresas: [{ id, razonSocial, rubro, ciudad, descripcion, img }], nextCursor }` (solo empresas activas que optaron por aparecer, 50 por página; la siguiente página se pide con `cursor: nextCursor`).

---

#### `verifyAccessToken<TExtra extends Record<string, unknown> = {}>(token: string, opts?: { extraClaimsSchema?: ZodType<TExtra> })`

Verifica un access token de usuario localmente con el JWKS. Exige firma ES256 con una clave de **usuario** (`kid` con prefijo `usr-`; un token sin `kid` o firmado con una clave de servicio se rechaza), header `typ: at+jwt`, `iss: auth-service`, `aud` igual al producto configurado con `configureEvaAuth({ product })` (un `aud` arreglo se rechaza), `client_id` igual al producto, `exp` obligatorio y los claims base. Soporta extensión de claims con validación de schema.

```ts
// Sin claims extra: id, sessionId, clientId (client_id, el producto) y empresaId (claim `empresa`)
const result = await verifyAccessToken(token)
if (result.ok) {
  console.log(result.data.id) // string
  console.log(result.data.empresaId) // string | undefined: empresa activa de la sesión
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

Un token inválido o expirado devuelve `{ ok: false }` (401) y no lanza. **Lanza** un error de configuración (`name === 'EvaAuthConfigError'`) si `authUrl` o `product` no fueron configurados: no se degrada a 401, el consumidor debe responder 500. `empresaId` solo está presente si la sesión tiene empresa activa; los claims `client_id` y `empresa` no se pueden pedir en `extraClaimsSchema`.

---

> **JWKS (v2.0.0+)**: no existen exports públicos para manejar el JWKS (`getPublicKey`, `fetchJwks` y `clearJwksCache` fueron eliminados; ver [CHANGELOG](../packages/auth-sdk/CHANGELOG.md)). `verifyAccessToken()` y los middlewares resuelven la clave por `kid` con `createRemoteJWKSet` de jose, sobre `<authUrl>/.well-known/jwks.json` (en la raíz del Auth Service, sin `/api/v1`). La URL viene de `configureEvaAuth({ authUrl })` (ver [configuration.md](configuration.md#url-del-auth-service)). Cache de 10 min (igual al `max-age` del JWKS), cooldown de 30 s entre refetch y timeout de 5 s (`src/jwks.ts`). El JWKS publica dos tipos de clave: `usr-<thumbprint>` (usuario) y `svc-<thumbprint>` (servicio). Cada verificador solo entrega a jose las claves de su prefijo y **rechaza los tokens sin `kid`** (`src/key-resolver.ts`). Un `kid` desconocido fuerza una recarga, respetando el cooldown. No hay forma de invalidar la cache manualmente.

---

### Types exportados

| Type | Descripción |
|------|-------------|
| `EvaUser` | Datos del usuario autenticado |
| `EvaSession` | Sesión activa del usuario |
| `EvaEmpresa` | Empresa asociada al usuario |
| `EvaTokenPayload<TExtra>` | Claims base del access token: `{ id, sessionId, clientId, empresaId? }`. Extendible con TExtra. |
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
| `EvaErrorMessages` | Interface con las 17 keys de mensajes de error del SDK |
| `ConfigureEvaAuthOptions` | Opciones de `configureEvaAuth()`: `authUrl?`, `product?`, `cookieDomain?`, `errorMessages?` y `errorWire?` |

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
| `getCookieNames()` | Función: nombres de las cookies del producto configurado (`eva_<producto>_access_token`, `eva_<producto>_refresh_token`). Lanza `EvaAuthConfigError` si falta `product` |
| `COOKIE_MAX_AGE` | TTL de cookies (access: 900s, refresh: 2592000s) |
| `JWT_CONFIG` | Configuración de verificación JWT (`ISSUER`, `ALGORITHM`). La audiencia de usuario es el producto configurado |
| `RESERVED_JWT_CLAIMS` | Array readonly con 12 claims reservados (RFC 7519 + OIDC): `iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`, `nonce`, `auth_time`, `acr`, `amr`, `azp` |
| `DEFAULT_ERROR_MESSAGES` | Objeto frozen con los 16 mensajes de error en español (ver tabla en [configuration.md](configuration.md#mensajes-de-error-personalizados)) |
| `ERROR_CODES` | Catálogo de 12 error codes core del Auth Service. Solo aplica a `EvaApiError` (kind: `'api'`). |
| `SDK_ERROR_REASONS` | Enum cerrado de 6 reasons internos del SDK. Solo aplica a `EvaSdkError` (kind: `'sdk'`). |
| `ACCOUNT_STATES` | Catálogo de 6 estados de cuenta: `no_verificado`, `verificado`, `pendiente_de_verificacion`, `suspendido`, `baneado`, `eliminado`. Úsalo en lugar de magic strings para comparar `stateAccount`. |
| `WEBHOOK_HEADERS` | Nombres de los headers HTTP que el Auth Service incluye en cada webhook: `SIGNATURE`, `ID`, `TIMESTAMP`. |
| `ADMIN_ERROR_CODES` | Códigos de error específicos del módulo Admin: `service_client_already_exists`, `service_client_not_found`, `service_client_secret_rotation_conflict`, `last_admin_client`. |
| `S2S_ERROR_CODES` | Códigos de error específicos del módulo S2S (usuarios y webhooks): `user_not_found`, `webhook_subscription_duplicate`, `webhook_subscription_not_found`, `webhook_secret_rotation_conflict`, `webhook_url_invalid`, `webhook_event_codes_empty`. |
| `S2S_SCOPES` | Permisos de la audiencia `auth-api`: `USERS_READ`, `WEBHOOKS_READ`, `WEBHOOKS_WRITE`, `EMPRESAS_LEER`, `EMPRESAS_ESCRIBIR`. `admin` no está: la superficie `/admin` de Auth se firma, no usa tokens. |
| `S2S_RESPONSE_HEADERS` | Header de respuesta S2S: `SERVER_TIME` (`x-eva-server-time`). |
| `USERS_BATCH_MAX_IDS` | Número máximo de IDs por llamada a `batchUsers` (100). El cliente valida este límite antes de hacer fetch. |

### Re-exports desde `@eva_solutions/auth-sdk`

| Export | Tipo | Descripción |
|--------|------|-------------|
| `readTokensFromCookies` | función | Lee tokens desde un string de cookies; retorna `{ accessToken?, refreshToken? }` |
| `DEFAULT_ERROR_MESSAGES` | constante | Objeto frozen con los 16 defaults en español |
| `EvaErrorMessages` | type | Interface de los 17 keys de mensajes de error |
| `ERROR_CODES` | constante | Catálogo de 12 codes core del Auth Service |
| `SDK_ERROR_REASONS` | constante | 6 reasons del SDK como `as const` |
| `getMessage` | función | Helper `getMessage(err: EvaError): string` |
| `verifyWebhookSignature` | función | Verifica firma HMAC-SHA256 de webhooks |
| `EVENT_CODES` | constante | 27 event codes del Auth Service (11 de usuario/sesión, los 4 de empresas de la fase 1 y los 12 de la fase 2: `empresa.updated`, `deactivated`, `reactivated`, `member_role_changed`, `branch_updated`, `branch_deactivated`, `product_changed`, `grupo.updated`, `member_added`, `member_removed`, `autorizacion.granted`, `revoked`) |
| `WEBHOOK_HEADERS` | constante | Headers de webhooks entrantes (SIGNATURE, ID, TIMESTAMP) |
| `createAdminClient` | función | Factory del cliente Admin |
| `ADMIN_ERROR_CODES` | constante | Error codes específicos del módulo Admin |
| `createS2SClient` | función | Factory del cliente S2S (Bearer con un `ServiceTokenProvider`) |
| `createServiceTokenProvider` | función | Pide, guarda y renueva el token de servicio (client credentials) |
| `verifyServiceToken` | función | Verifica un token de servicio recibido como Bearer |
| `verifyDelegatedToken` | función | Verifica un token delegado (token exchange) recibido como Bearer |
| `AUTORIZACION_CACHE_TTL_MS` | constante | Vida del caché de `checkAutorizacion` (30 s) |
| `ServiceTokenRequestError` | clase | Error del pedido de token (`code` RFC 6749, `status`) |
| `signS2SHeaders` | función | Genera los 4 headers S2S (client id, timestamp, nonce, firma) |
| `generateS2SNonce` | función | Genera un nonce S2S (32 hex en minúsculas) |
| `S2S_SCOPES` | constante | Scopes S2S reconocidos por el Auth Service |
| `S2S_RESPONSE_HEADERS` | constante | Headers de respuesta S2S (SERVER_TIME) |
| `USERS_BATCH_MAX_IDS` | constante | Límite de IDs por llamada a `batchUsers` (100) |
| `ACCOUNT_STATES` | constante | Catálogo de estados de cuenta de usuario |
| `AccountState` | type | Unión de literales de estados de cuenta |
| `S2SScope` | type | Unión de literales de permisos de `auth-api` |
| `AdminErrorCode` | type | Unión de literales de error codes Admin |
| `S2S_ERROR_CODES` | constante | Error codes específicos del módulo S2S (usuarios y webhooks) |
| `S2SErrorCode` | type | Unión de literales de error codes S2S |

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

**Login con `challengeId`.** `POST /get-code` devuelve el `challengeId` tal como lo emite el Auth Service (el handler lo pasa sin tocarlo). `POST /login` lo **exige** en el body: `LoginSchema` agrega `challengeId: z.string().min(1)`, y un body sin él responde 400 `malformed` (mensaje `loginFailed`) sin llegar al Auth Service. El `challengeId` es opaco: el navegador lo conserva **en memoria** (sin cookie ni storage) y lo reenvía con el código; cada `get-code` nuevo invalida el anterior. Los handlers `POST /get-code` y `POST /login` responden `Cache-Control: no-store` en **toda** respuesta (éxito y error), porque llevan el `challengeId` y las cookies de sesión; en `evaAuthRoutes` el header se fija al inicio del handler; en `evaAuthOpenAPIRoutes` lo fija un middleware de ruta que corre antes del validador (y el hook de validación en el 400 de body inválido), porque el validador responde antes de que el handler se ejecute. En ambas variantes cubre el 400 de validación y los errores del Auth Service, y esos 400 salen con el mismo wire `{ error: { code, message } }` (sin exponer el `ZodError`). En `evaAuthOpenAPIRoutes` ese manejo (el 400 con el wire del SDK, los mensajes y el `no-store` del middleware) aplica **solo** a las rutas `POST /get-code` y `POST /login` del propio SDK, identificadas por coincidencia exacta de la ruta relativa a la sub-app, sin importar el prefijo de montaje. Las rutas propias que el consumidor agregue a esa misma sub-app (por ejemplo `/admin/login` o `/sms/get-code`) **no** lo heredan: conservan su validación y su respuesta 400 por defecto, sin los mensajes del SDK. Si el `challengeId` no coincide con el vigente, el Auth Service responde 401 sin consumir intentos.

**`EvaAuthRoutesOptions`:**

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `errorMessages` | `Partial<EvaErrorMessages>` | Override local de mensajes de error |
| `allowedOrigins` | `readonly string[]` | Orígenes extra (`https://app.example.com`, `tauri://localhost`; sin path) desde los que se aceptan las mutaciones con cookies. Ver [CSRF por Origin](#csrf-por-origin) |

#### CSRF por Origin

Las cookies son `SameSite=Lax`, que no cubre a un sitio del mismo *site* pero de otro origen (por ejemplo un subdominio comprometido). Por eso `evaAuthRoutes` y `evaAuthOpenAPIRoutes` verifican `Origin` en toda mutación (`POST`, `PATCH`, `PUT`, `DELETE`); `GET`, `HEAD` y `OPTIONS` no se verifican.

- **Mismo origen por defecto**: pasa si el host (host:puerto) de `Origin` es el de la request. El esquema no cuenta, porque tras un proxy que termina TLS el servidor ve `http://` y el navegador manda `https://`.
- **`allowedOrigins`**: orígenes adicionales aceptados (el front en otro subdominio o puerto). Coincidencia exacta de origen (esquema, host y puerto; sin comodines ni subdominios). Acepta cualquier origen serializado `esquema://host[:puerto]`, no solo `http(s)`: un front de escritorio o móvil manda `tauri://localhost` o `capacitor://localhost` y debe listarse así. Una entrada que no sea un origen serializado (por ejemplo `'*'`, `null`, o con path, userinfo o puerto inválido) lanza al construir las rutas. Si tu front vive en otro origen (por ejemplo `http://localhost:5173` contra un API en `:3000`), debes listarlo.
- **Sin `Origin`** (curl, servidores): pasa; todo navegador lo manda en las mutaciones, así que la ausencia indica un cliente que no es navegador.
- **Rechazo**: HTTP 403 con el wire de error configurado y `code: 'forbidden'`, sin llegar al handler. El mensaje es la key `originNotAllowed` de `errorMessages`. `Origin: null` también se rechaza.

#### Endpoints

| Método | Ruta | Body / Entrada | Respuesta |
|--------|------|----------------|-----------|
| `POST` | `/get-code` | `{ phone }` | `{ data: { message, challengeId } }` |
| `POST` | `/login` | `{ phone, code, challengeId, empresaId? }` | `{ data: { user: { id } } }` + Set-Cookie |
| `POST` | `/empresa-activa` | `{ empresaId \| null }` + cookies | `{ data: { empresaId } }` + Set-Cookie (solo access) |
| `POST` | `/refresh` | cookies | `{ data: { user: { id } } }` + Set-Cookie |
| `POST` | `/logout` | cookies | `{ data: { message } }` + Clear-Cookie |
| `GET` | `/me` | cookies | `{ data: EvaUser }` |
| `PATCH` | `/me` | body + cookies | `{ data: EvaUser }` |
| `DELETE` | `/me` | cookies | `{ data: { message } }` + Clear-Cookie |
| `GET` | `/empresas` | cookies | `{ data: EvaEmpresa[] }` |
| `GET` | `/sessions` | cookies | `{ data: EvaSession[] }` |
| `DELETE` | `/sessions/:id` | cookies | `{ data: { message } }` |
| `DELETE` | `/sessions` | cookies | `{ data: { message, count } }` + Clear-Cookie |

**Producto en el login.** El SDK agrega `producto` (el de `configureEvaAuth({ product })`) al `POST /login` que envía al Auth Service; un `producto` que llegue en el body del navegador se ignora. `empresaId` (opcional) deja esa empresa activa en la sesión si la persona pertenece a ella; `get-code` no lleva ninguno de los dos. Las rutas de login, el refresh y los middlewares necesitan `product` configurado: sin él lanzan `EvaAuthConfigError` (500). El cliente HTTP (`createHttpClient`) suma `setActiveEmpresa({ accessToken, empresaId | null })` → `POST /api/v1/auth/empresa-activa`, que valida la pertenencia en Auth y devuelve `{ empresaId, accessToken }`: Auth reemite solo el access token (`x-eva-new-access-token`; el refresh no rota); el BFF lo expone como `POST /empresa-activa` (ver abajo).

**`POST /empresa-activa`.** Toma la sesión de la cookie de access del producto (como `/me`, sin refrescar: si venció, Auth responde 401 y el cliente hace `/refresh`), valida el body (`empresaId` obligatorio: un id o `null`) y llama a `POST /api/v1/auth/empresa-activa`. Auth reemite **solo** el access token (`x-eva-new-access-token`; el refresh no rota): el BFF reescribe únicamente la cookie de access y responde `{ data: { empresaId } }` con `Cache-Control: no-store`. Los errores de Auth (401, 403 si la persona no pertenece a la empresa) salen con el formato de las demás rutas; si Auth responde 200 sin el access token, el BFF responde 502 y no toca cookies. Existe en `evaAuthRoutes` y en `evaAuthOpenAPIRoutes`.

> Estas rutas son las del BFF de **tu** backend, montadas bajo el prefijo que elijas (por ejemplo `/auth`). No son las del Auth Service y no llevan `/api/v1`: por dentro, el SDK llama al Auth Service en `/api/v1/...`.

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
| `getCookieNames` | `constants.ts` | Nombres de las cookies del producto configurado |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 17 keys |
| `EvaAuthRoutesOptions` | `hono/auth-routes.ts` | Opciones de `evaAuthRoutes()` |
| `getAuthUrl` | `config.ts` | URL del Auth Service configurada con `configureEvaAuth({ authUrl })`; lanza un error de configuración (`EvaAuthConfigError`) si no se configuró |
| `getCookieDomain` | `config.ts` | Cookie domain configurado |

---

## `@eva_solutions/auth-sdk/hono-openapi`

Variante de las rutas de auth compatible con OpenAPI 3.1. Requiere `@hono/zod-openapi >=1.4.0` instalado en el proyecto consumidor.

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

La respuesta 200 de `/get-code` documenta `{ data: { message, challengeId } }` y el body de `/login` documenta `challengeId` como obligatorio (mismo `LoginSchema`).

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

Lanza un error de configuración (`name === 'EvaAuthConfigError'`) si la request trae algún token y `authUrl` no fue configurada; una request sin tokens devuelve `auth_required` (401) sin leer la configuración.

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
| `getCookieNames` | `constants.ts` | Nombres de las cookies del producto configurado |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 17 keys |
| `getAuthUrl` | `config.ts` | URL del Auth Service configurada con `configureEvaAuth({ authUrl })`; lanza un error de configuración (`EvaAuthConfigError`) si no se configuró |
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

**IMPORTANTE**: `signingKey` es la signing key que Auth entregó **una sola vez** al crear o rotar la suscripción (Auth la guarda cifrada) — el receptor la usa tal cual y **NO debe re-hashearla** antes de pasarla. Re-hashearlo produce `false`.

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

Para operaciones de administración de service clients, restauración de usuarios y reconciliación de entregas de webhooks.

**Autenticación.** Cada request se firma con HMAC S2S (la misma firma de `createS2SClient`, vía `signS2SHeaders`) con las credenciales de un service client con la marca `esAdmin` (columna `es_admin`; ya no es un scope). `/admin` es, junto con `POST /internal/token`, lo único que conserva la firma HMAC. No hay password global ni header `x-admin-password`: una persona, un client; el API registra el slug que firmó como `actor`. Un client sin `esAdmin` recibe 403. El primer client admin se crea con el script de bootstrap del Auth Service (ADR 0007 del API).

```typescript
import { createAdminClient } from '@eva_solutions/auth-sdk/admin'

const admin = createAdminClient({
  clientId: process.env.AUTH_ADMIN_SLUG!, // service client con `esAdmin`
  secretHex: process.env.AUTH_ADMIN_SECRET!, // su secret en hex (64 chars)
  baseUrl: 'https://auth.miapp.com',
})

// Crear service client
const result = await admin.createServiceClient({
  slug: 'mi-servicio', // 'auth-service' está reservado (es el `iss` de los tokens)
  name: 'Mi Servicio',
})
if (result.ok) {
  console.log(result.data.secret) // guardar AHORA — no se muestra de nuevo
}

// Concesiones: qué permisos puede pedir en su token, por audiencia (catálogo de auth-contracts)
await admin.setServiceClientGrant('mi-servicio', {
  audience: 'auth-api',
  scopes: ['users:read', 'empresas:escribir'], // `admin` no es concedible para auth-api: no compila
})
await admin.setServiceClientGrant('mi-servicio', { audience: 'whatsapp-api', scopes: ['messages:send:text'] })
const grants = await admin.listServiceClientGrants('mi-servicio')
await admin.deleteServiceClientGrant('mi-servicio', 'whatsapp-api') // 204

// Identidad de un backend: el producto al que pertenece y el servicio que ES (los fija el admin)
await admin.updateServiceClient('ventas-backend', { producto: 'ventas', audiencia: 'whatsapp-api' })

// Aristas de delegación (token exchange): hacia qué audiencia puede delegar y con qué permisos
await admin.setServiceClientDelegation('ventas-backend', {
  audience: 'whatsapp-api',                 // `auth-api` no compila: Auth nunca es destino
  scopes: ['messages:send:text'],           // `admin` no compila: nunca es delegable
  requiere_scope_origen: ['messages:send:media'], // opcional: habilita el re-exchange (ver abajo)
})
const edges = await admin.listServiceClientDelegations('ventas-backend')
await admin.deleteServiceClientDelegation('ventas-backend', 'whatsapp-api') // 204

// Permisos entre empresas que un producto puede conceder en nombre de sus empresas
await admin.setProductoPermisosAutorizables('ventas', { permisos: ['whatsapp:mensajes:leer'] })

// Empresas: reasignar titular (disputa de RUC o empresa sin titular), baja/reactivar y contratación a mano
await admin.reassignEmpresaTitular('empresa-id', { userId: 'u2', titularAnterior: 'miembro' })
await admin.bajaEmpresa('empresa-id')
await admin.reactivarEmpresa('empresa-id')
await admin.setContratacion('empresa-id', 'ventas', { estado: 'activo', hasta: null })

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

// Republicar en QStash las entregas `pending` viejas (recuperación tras una falla de publicación)
const republished = await admin.republishPendingWebhooks({ older_than_minutes: 10, limit: 100 })
if (republished.ok && republished.data.hasMore) {
  // quedan más entregas pending viejas: vuelve a llamar
}

// Limpieza on-demand: purga cuentas eliminadas con la ventana de restauración vencida y borra
// webhook_events sin entregas vivas fuera de la retención
const cleanup = await admin.maintenanceCleanup({ limit: 100 })
if (cleanup.ok && cleanup.data.hasMore) {
  // queda más por limpiar: vuelve a llamar
}
```

### Métodos del AdminClient

Los paths llevan el prefijo `/api/v1` del Auth Service (ver [migration.md](migration.md#9-rutas-del-auth-service-bajo-apiv1)).

| Método | HTTP | Path | Descripción |
|--------|------|------|-------------|
| `createServiceClient(input)` | POST | `/api/v1/admin/service-clients` | Crea client. Secret one-time. |
| `listServiceClients()` | GET | `/api/v1/admin/service-clients` | Lista todos. |
| `getServiceClient(slug)` | GET | `/api/v1/admin/service-clients/:slug` | Detalle por slug. |
| `updateServiceClient(slug, input)` | PATCH | `/api/v1/admin/service-clients/:slug` | Parche parcial (`enabled`, `esAdmin`, `name`, y la identidad del backend: `producto` y `audiencia`, `null` las quita). Disjuntas por construcción: el slug de un producto nunca es una audiencia. |
| `deleteServiceClient(slug)` | DELETE | `/api/v1/admin/service-clients/:slug` | Hard-delete. 204. |
| `listServiceClientGrants(slug)` | GET | `/api/v1/admin/service-clients/:slug/grants` | Concesiones del client: `{ grants: [{ audience, scopes }] }`. |
| `setServiceClientGrant(slug, input)` | PUT | `/api/v1/admin/service-clients/:slug/grants` | Crea o reemplaza la concesión de una audiencia. `input` es `{ audience, scopes }` y los `scopes` deben ser de esa audiencia (el tipo y el schema lo imponen). |
| `deleteServiceClientGrant(slug, audience)` | DELETE | `/api/v1/admin/service-clients/:slug/grants/:audience` | Quita la concesión. 204. |
| `listServiceClientDelegations(slug)` | GET | `/api/v1/admin/service-clients/:slug/delegations` | Aristas de delegación del client: `{ delegations: [{ audience, scopes, requiere_scope_origen }] }`. |
| `setServiceClientDelegation(slug, input)` | PUT | `/api/v1/admin/service-clients/:slug/delegations` | Crea o reemplaza la arista hacia una audiencia. `audience` solo puede ser una audiencia delegable (hoy `whatsapp-api`; **`auth-api` nunca**) y `scopes` / `requiere_scope_origen` solo permisos delegables (**`admin` nunca**): el tipo y el schema lo imponen. `requiere_scope_origen` vacío o ausente = la arista no admite re-exchange. |
| `deleteServiceClientDelegation(slug, audience)` | DELETE | `/api/v1/admin/service-clients/:slug/delegations/:audience` | Quita la arista. 204. |
| `getProductoPermisosAutorizables(slug)` | GET | `/api/v1/admin/productos/:slug/permisos-autorizables` | `{ producto, permisos }`: los permisos entre empresas que el producto puede conceder. |
| `setProductoPermisosAutorizables(slug, input)` | PUT | `/api/v1/admin/productos/:slug/permisos-autorizables` | Reemplaza la lista completa (`{ permisos }`, solo permisos del catálogo entre empresas; vacía = ninguno). |
| `reassignEmpresaTitular(empresaId, input)` | POST | `/api/v1/admin/empresas/:id/titular` | La persona `userId` pasa a titular; el titular anterior queda `miembro` (por defecto) o `fuera` (`titularAnterior`). |
| `bajaEmpresa(empresaId)` / `reactivarEmpresa(empresaId)` | POST | `/api/v1/admin/empresas/:id/baja` · `/reactivar` | Baja y reactivación por el admin de Auth (sin persona). Respuesta `{ id, estado }`. |
| `setContratacion(empresaId, producto, input)` | PUT | `/api/v1/admin/empresas/:id/productos/:producto` | Escribe `estado` (`prueba`, `activo`, `suspendido`, `cancelado`) y `hasta` de la contratación. Hasta que exista facturación, así se activa a mano. |
| `listProductos()` | GET | `/api/v1/admin/productos` | Lista los productos: `{ productos: [{ slug, nombre, enabled }] }`. |
| `createProducto(input)` | POST | `/api/v1/admin/productos` | Crea un producto (`{ slug, nombre, enabled? }`, `enabled` por defecto `true`). 201 `{ producto }`; `409 conflict` si el slug existe; `400` si el slug no cumple el formato o es una audiencia de servicio. |
| `updateProducto(slug, input)` | PATCH | `/api/v1/admin/productos/:slug` | Cambia `nombre` o `enabled` (200 `{ producto }`); `404` si no existe; `400` con body vacío. No hay delete: se deshabilita. Un producto deshabilitado cierra el refresh de sus sesiones. |
| `rotateServiceClientSecret(slug)` | POST | `/api/v1/admin/service-clients/:slug/rotate-secret` | Rota secret. One-time. Puede responder `409 service_client_secret_rotation_conflict` (`ADMIN_ERROR_CODES`) si otra rotación concurrente ganó: esa llamada no recibe secret y se puede reintentar. |
| `restoreUser(userId)` | POST | `/api/v1/admin/users/:id/restore` | Restaura usuario eliminado. |
| `republishPendingWebhooks(query?)` | POST | `/api/v1/admin/webhooks/republish-pending` | Republica en QStash las entregas `pending` con más de `older_than_minutes` minutos (default 10, máx. 10080) y como máximo `limit` por llamada (default y tope 100). El query va firmado (`older_than_minutes`, `limit`, en snake_case como `listWebhookDeliveries`). Devuelve `{ republished, hasMore }`; con `hasMore: true` vuelve a llamar. Idempotente. 503 `service_unavailable` si QStash no aceptó el lote (las entregas siguen `pending`). |
| `maintenanceCleanup(query?)` | POST | `/api/v1/admin/maintenance/cleanup` | Limpieza on-demand, sin polling: purga las cuentas `eliminado` cuya ventana de restauración ya venció y borra los `webhook_events` sin entregas vivas que superan la retención. `limit` (1 a 100, default 100) va firmado en el query y acota cada lote. Devuelve `{ usersPurged, eventsDeleted, hasMore }`; con `hasMore: true` vuelve a llamar. |

Todos los métodos retornan `Promise<Result<T>>` con `error: EvaError`. Borrar, deshabilitar o quitarle `esAdmin` al último service client admin habilitado responde `409 last_admin_client` (`ADMIN_ERROR_CODES.last_admin_client`) y no se aplica.

`slug`, `audience` y `userId` se validan y se codifican como un solo segmento de path (mismo helper que los ids del cliente S2S): si no son string, o son vacíos, `.` o `..` (crudo o percent-decodificado), el método devuelve `{ ok: false, error: { kind: 'sdk', reason: 'malformed', status: 0 } }` sin hacer la request; no lanza. El resto pasa por `encodeURIComponent` (`a/b` → `a%2Fb`; un `%` existente se codifica una vez: `a%2Fb` → `a%252Fb`).

> **Advertencia**: solo usar desde backends o herramientas de operador seguras. El secret del service client admin nunca debe exponerse en el cliente/browser.

---

## `@eva_solutions/auth-sdk/s2s`

Para llamadas entre servicios. Un servicio prueba quién es pidiendo un **token de servicio** a Auth (`createServiceTokenProvider`, firmado con HMAC S2S SigV4-style) y lo manda como `Authorization: Bearer` (`createS2SClient`); el servicio receptor lo verifica con `verifyServiceToken` / `serviceTokenAuth`. El HMAC solo queda en el pedido de token y en la superficie `/admin` de Auth.

```typescript
import { createS2SClient, createServiceTokenProvider } from '@eva_solutions/auth-sdk/s2s'

// Un proveedor por (audiencia, scope): guarda el token, lo renueva y deduplica los pedidos simultáneos.
const tokenProvider = createServiceTokenProvider({
  authUrl: 'https://auth.example.com',
  clientId: 'mi-servicio',               // slug del service client
  secretHex: process.env.AUTH_CLIENT_SECRET_HEX!, // hex del secret
  audience: 'auth-api',
  scope: 'users:read',                   // opcional: si falta, se piden todos los concedidos
})

const s2s = createS2SClient({
  baseUrl: 'https://auth.example.com',
  tokenProvider, // Bearer en cada llamada; ante un 401 invalida el token y reintenta UNA vez
})

// Obtener usuario por ID
const user = await s2s.getUser('uuid-del-usuario')
if (user.ok) {
  console.log(user.data.phone) // `data` es el perfil directamente, sin envoltorio `{ user }`
}
// Usuario inexistente o soft-deleted: user.error con code 'user_not_found' (404);
// matchError(user.error, 'user_not_found'). isNotFound también es true para un 404 de ruta.

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
// Si otra rotación concurrente de la misma subscription ganó, rotated.ok es false con
// status 409 y error.code S2S_ERROR_CODES.webhook_secret_rotation_conflict (reintentable): esta llamada
// no recibe clave, así que no hay clave nueva de este caller que guardar. Reintenta.
const deliveries = await s2s.listWebhookDeliveries({ status: 'failed', limit: 20 })
```

`S2S_ERROR_CODES` (con el tipo `S2SErrorCode`) lista los codes propios de usuarios y webhooks, para comparar sin strings sueltos (`result.error.code === S2S_ERROR_CODES.webhook_url_invalid`). El catálogo `ErrorCode` sigue abierto: un code que no esté en la lista no rompe la compilación.

`baseUrl` y `authUrl` pueden llevar un prefijo de path (por ejemplo `https://host/auth`). Todas las rutas del Auth Service llevan además el prefijo `/api/v1`, que el cliente agrega después del de `baseUrl`: `https://host/auth` → `https://host/auth/api/v1/internal/users/u1`. El proveedor de tokens firma el pathname de la URL final del pedido (`/auth/api/v1/internal/token`), que es el que lee el verificador en `request.url`. Si un proxy quita ese prefijo antes de llegar al verificador, la firma falla con `signature_invalid` (ver [migration.md](migration.md), sección 7).

Los ids que recibe el cliente (`getUser`, `getWebhookSubscription`, `updateWebhookSubscription`, `deleteWebhookSubscription`, `rotateWebhookSubscriptionSecret`) se validan y se codifican como un solo segmento de path: un id que no es string, vacío, `.` o `..` (crudo o percent-decodificado) devuelve `{ ok: false, error: { kind: 'sdk', reason: 'malformed' } }` sin hacer fetch, y el resto pasa por `encodeURIComponent` (`a/b` → `a%2Fb`). Los UUID no cambian. El cliente admin aplica la misma regla a `slug` y `userId` (ver [Métodos del AdminClient](#métodos-del-adminclient)).

La entrada de `createWebhookSubscription` y `updateWebhookSubscription` sigue el contrato compartido: `url` con esquema `http` o `https` seguido de `//`, sin espacios ni caracteres de control (`javascript:`, `ftp://` y `https:host/x` se rechazan; el contrato no rechaza el userinfo: lo rechaza el Auth Service al parsear la URL, `https://user:pass@host` y `https://user@host`; un `@` en el path o el query es válido) y `eventCodes` con valores de `EVENT_CODES` (tipo `EventCode[]`), mínimo uno. Los duplicados en `eventCodes` tampoco los rechaza el contrato: los rechaza el Auth Service. El Auth Service devuelve `eventCodes` sin repetidos y ordenados en orden de bytes, no en el orden en que los enviaste, y no admite dos subscriptions del mismo service client con la misma URL normalizada y el mismo conjunto de `eventCodes` (`409 webhook_subscription_duplicate`, también en `updateWebhookSubscription`).

### Token de servicio: `createServiceTokenProvider`

```ts
function createServiceTokenProvider(config: {
  authUrl: string; clientId: string; secretHex: string; audience: string; scope?: string
}): {
  getToken(): Promise<string>
  invalidate(rejectedToken?: string): void
  exchangeToken(input: { subjectToken: string; audience: string; scope?: string }): Promise<Result<{ accessToken: string; scope: string }>>
}
```

- Hace `POST /api/v1/internal/token` con `{ audience, scope? }`, firmado con HMAC S2S. La respuesta es la de RFC 6749 §5.1 (`access_token`, `token_type: 'Bearer'`, `expires_in`, `scope`), sin envoltorio `data`.
- **Vencimiento**: se calcula con `expires_in` desde el momento del pedido, no comparando el `exp` del token con el reloj local. Renueva 30 s antes (`SERVICE_TOKEN_RENEW_MARGIN_MS`).
- **Deduplicación**: N llamadas simultáneas a `getToken()` con el caché vacío o vencido hacen UN pedido (dentro del mismo isolate). Un pedido fallido no se guarda: la siguiente llamada reintenta.
- `invalidate(rejectedToken)` descarta el token guardado **solo si sigue siendo ese** y nunca descarta un pedido en curso. Con N respuestas 401 simultáneas del mismo token, la primera descarta y las demás comparten el pedido de renovación: UN pedido a `/internal/token`, no N (`createS2SClient` pasa el token rechazado). Sin argumento descarta el guardado.
- **Cloudflare Workers**: las requests del mismo isolate comparten el pedido en curso (probado en workerd con miniflare: 3 requests simultáneas → 1 pedido; la request que lo inició cancelada por el cliente → las demás siguen recibiendo el token). Si la request que inició el pedido termina **sin esperarlo** (`getToken()` sin `await` ni `waitUntil`), el runtime cancela su subrequest y la promesa nunca se resuelve: quien se unió espera como máximo la duración de un pedido más 1 s de margen (11 s) y luego hace el suyo. Espera siempre `getToken()` dentro de la request.
- Si Auth rechaza el pedido, `getToken()` rechaza con `ServiceTokenRequestError { code, status }`; `code` es el `error` de RFC 6749/8707: `invalid_client` (401: firma inválida o client deshabilitado), `invalid_target` (400: audiencia desconocida o sin concesión), `invalid_scope` (400), `invalid_request`, `temporarily_unavailable` (503: la caché de replay no responde; la ruta falla cerrado; también el `429` del límite por client, aunque Auth no mande cuerpo RFC: el error trae `retryAfterSeconds` si hubo `Retry-After`). El proveedor valida su configuración al crearse: audiencia del catálogo, permisos de esa audiencia y `secretHex` hex (`TypeError`). `createS2SClient` lo devuelve como `Result` `{ kind: 'api', code, status }`.

### Llamar en nombre de un usuario: `exchangeToken`

`provider.exchangeToken({ subjectToken, audience, scope? })` cambia un token de la persona por un **token delegado** (`typ: dlg-at+jwt`, RFC 8693, 120 s) para que este servicio llame a OTRO servicio en su nombre. Va sobre el mismo proveedor porque usa la identidad del mismo service client.

```ts
// En el backend de Ventas, con el access token de la persona YA verificado por evaAuth
const grant = await tokenProvider.exchangeToken({
  subjectToken: accessToken,   // at+jwt con aud = producto de Ventas, o un token delegado (re-exchange)
  audience: 'whatsapp-api',    // un servicio al que este client tiene una arista; nunca 'auth-api'
  scope: 'messages:send:text', // opcional: si falta, todo lo delegable en esa arista
})
if (!grant.ok) return handle(grant.error) // grant.error.code: 'invalid_grant', 'invalid_target', 'invalid_scope', ...
await fetch(url, { headers: { authorization: `Bearer ${grant.data.accessToken}` } })
```

- **Autenticación propia.** El pedido a `POST /api/v1/internal/token-exchange` va con un token de servicio `aud: auth-api` y permiso `tokens:exchange` que el proveedor obtiene y renueva solo, sea cual sea la audiencia del proveedor. El client necesita esa concesión (`setServiceClientGrant`).
- **Resultado, no excepción.** `invalid_grant` (sesión cerrada, usuario o empresa fuera, producto no contratado, profundidad o ciclo) es una respuesta normal: llega como `{ ok: false, error: { kind: 'api', code, message, status } }` con el `error` RFC en `code`. Una audiencia o permiso que no está en el catálogo delegable (`auth-api`, `admin`, un typo) se rechaza localmente con `reason: 'malformed'`, sin pedido.
- **Caché por isolate.** El token delegado se guarda hasta 30 s antes de su `exp` (90 s útiles de 120). La llave es la audiencia, el scope (sin importar el orden) y una **huella SHA-256 del `subjectToken` completo**. Eso cubre la llave del diseño (`sid`, `sub`, `empresa`, `audience`, `scope`) y el `jti` del token de entrada en un re-exchange: un token de entrada distinto, aunque diga lo mismo, nunca reutiliza una entrada; un token falsificado que repita los claims de otra persona tampoco puede leerla. Los errores no se guardan. El caché está acotado (500 entradas por proveedor).
- **El SDK no verifica el `subjectToken`:** pásalo ya verificado (`verifyAccessToken`, el middleware, `verifyDelegatedToken`). Auth lo verifica de todas formas.

### Verificación de token delegado (`verifyDelegatedToken` / `delegatedTokenAuth`)

El servicio destino (por ejemplo Whatsapp-api cuando lo llama Ventas en nombre de alguien) verifica el Bearer delegado. `verifyDelegatedToken` vive en `@eva_solutions/auth-sdk/s2s` y `delegatedTokenAuth` (Hono) en `@eva_solutions/auth-sdk/hono`.

```ts
import { delegatedTokenAuth, type DelegatedTokenAuthVariables } from '@eva_solutions/auth-sdk/hono'

const app = new Hono<{ Variables: DelegatedTokenAuthVariables }>()
app.use('/v1/on-behalf/*', delegatedTokenAuth({ audience: 'whatsapp-api', requiredScope: 'messages:send:text' }))
app.post('/v1/on-behalf/text', (c) => {
  c.var.userId      // `sub`: la persona
  c.var.empresaId   // `empresa`: obligatoria e inmutable en la cadena
  c.var.producto    // producto de origen
  c.var.sessionId   // `sid`: sesión de origen
  c.var.actorChain  // [{ serviceClientId, serviceClientSlug }, ...] del último actor al primero
  c.var.scopes
})
```

```ts
function verifyDelegatedToken(token: string, opts: DelegatedTokenVerifyOptions): Promise<DelegatedTokenVerifyResult>
function delegatedTokenAuth(opts: DelegatedTokenAuthOptions): MiddlewareHandler
```

Exige `typ: dlg-at+jwt`, `kid` `svc-`, `iss: auth-service`, **una** `aud` (la del receptor; `auth-api` lanza `TypeError`), `sub`, `client_id`, una cadena `act` de 1 a 3 niveles, **`empresa`, `producto` y `sid` obligatorios** (un delegado sin empresa se rechaza con `claims_invalid`), `jti` obligatorio, `client_id` igual al `client_id` de `act`, `exp - iat` ≤ 120 s y el permiso pedido (`requiredScope`, `anyScope` o `scopeCheck: 'deferred'`; `admin` nunca es delegable y lanza `TypeError`). Los motivos de rechazo son los de `verifyServiceToken`; el middleware responde 401 `{ error: { code, message } }` y 403 `insufficient_scope`. `requireScope` no aplica a este middleware (lee los scopes de `s2sAuth` / `serviceTokenAuth`): con `scopeCheck: 'deferred'` revisa `c.var.scopes`.

**Ningún verificador acepta el tipo de otro.** Los tres tokens comparten el JWKS y se separan por `typ` y por prefijo de `kid`: `verifyAccessToken` (`at+jwt`, `usr-`), `verifyServiceToken` (`svc-at+jwt`, `svc-`) y `verifyDelegatedToken` (`dlg-at+jwt`, `svc-`). Un test cruza los tres tipos con los dos prefijos contra los tres verificadores y solo acepta la diagonal.

**El servicio destino no ve los roles del producto:** el producto que actúa es responsable de haber comprobado el permiso de la persona antes de pedir el token. Un token delegado no sirve ante Auth.

### Firma HMAC

El proveedor de tokens (y el cliente admin) generan los headers de autenticación S2S (cuatro, todos obligatorios):

| Header | Descripción |
|--------|-------------|
| `x-eva-client-id` | Slug del service client |
| `x-eva-timestamp` | Unix seconds del request |
| `x-eva-nonce` | 16 bytes aleatorios como 32 hex en minúsculas (`^[0-9a-f]{32}$`). Nuevo en cada request |
| `x-eva-signature` | `sha256=<hmac-sha256-hex>` |

El nonce hace único a cada request aunque dos compartan segundo, método, path y body. El verificador exige el formato canónico exacto: minúsculas, sin normalizar.

### Canonical string

El SDK construye el canonical string de la firma como (siete líneas):

```
METHOD\n
/path\n
canonicalQuery\n
timestamp\n
nonce\n
clientId\n
sha256(bodyBytes)
```

`canonicalQuery` no es el query string tal cual: se parte por `&`, se decodifica cada nombre/valor, se ordena por (nombre, valor), se re-codifica en RFC 3986 y se une de nuevo. Un query vacío da `""`. Fuente: `canonicalizeQuery` en `packages/auth-sdk/src/s2s/sign.ts`.

Para requests sin body, se usa el hash del cuerpo vacío (`EMPTY_BODY_SHA256_HEX`).

### Firmar a mano: `signS2SHeaders` y `generateS2SNonce`

Si llamas a un servicio que todavía verifica con `s2sAuth`, genera los cuatro headers con `signS2SHeaders`. Es el único punto que genera timestamp y nonce y firma; `createServiceTokenProvider` y el cliente admin lo usan por dentro.

```typescript
import { signS2SHeaders } from '@eva_solutions/auth-sdk/s2s'

const bodyBytes = new TextEncoder().encode(JSON.stringify(payload))
const headers = await signS2SHeaders({
  method: 'POST',
  path: '/internal/ping',
  rawQuery: '',          // opcional, default ''
  bodyBytes,             // opcional, default vacío; deben ser los bytes EXACTOS que envías
  clientId: 'mi-servicio',
  secretHex: process.env.S2S_SECRET!,
})
await fetch('https://otro-servicio.example.com/internal/ping', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: bodyBytes,
})
```

`headers` contiene `x-eva-client-id`, `x-eva-timestamp`, `x-eva-nonce` y `x-eva-signature`. No reutilices los mismos headers en otro request: cada llamada necesita un nonce nuevo. `generateS2SNonce()` devuelve un nonce suelto; `signS2SRequest({ parts, secretHex })` lanza si `parts.nonce` no tiene el formato canónico.

### Verificación (`verifyS2SRequest` / `s2sAuth`) y razones de rechazo

Orden de las comprobaciones: headers presentes → formato y ventana del timestamp → formato del nonce → formato de la firma → HMAC → `replayCache`.

| `reason` | Cuándo |
|----------|--------|
| `header_missing` | Falta alguno de los cuatro headers (incluido `x-eva-nonce`) |
| `timestamp_invalid` / `timestamp_expired` | Timestamp no entero / fuera de ±`timestampWindowSeconds` (default 120) |
| `nonce_malformed` | `x-eva-nonce` no cumple `^[0-9a-f]{32}$` (mayúsculas incluidas). Se decide antes de consultar el secreto |
| `signature_malformed` | `x-eva-signature` no es `sha256=<hex64>` |
| `client_unknown` / `signature_invalid` | Cliente desconocido / HMAC no coincide (mismo mensaje: "Authentication failed"). `signature_invalid` también cubre un query con percent-encoding malformado (por ejemplo `?a=%ZZ`), que no se puede canonicalizar |
| `replay_detected` | La clave `${clientId}:${nonce}` ya fue vista (solo con `replayCache`) |

Un query malformado sigue el mismo camino que una firma inválida (consulta `secretStore` y ejecuta el HMAC; no toca `replayCache`) y responde 401, no 500. Del lado firmante, `signS2SRequest` / `buildS2SCanonicalString` lanzan `[eva-auth-sdk] s2s: rawQuery inválido` si el `rawQuery` está malformado.

**`secretStore` mal configurado**: si devuelve un valor no nulo que no es hex (vacío, longitud impar o caracteres no hex), `verifyS2SRequest` lanza un `Error` explícito (con `s2sAuth`, HTTP 500) en vez de responder 401. Es un error de configuración del servidor; el mensaje no incluye el secreto.

**`replayCache`**: `setIfAbsent(key, ttlSeconds)` debe ser atómico (por ejemplo Redis `SET key 1 NX EX ttl`). La clave que arma el SDK es `${clientId}:${nonce}` y el TTL es `2 * timestampWindowSeconds + 1` (241 s con el default): la hora se trunca a segundos y la ventana es inclusiva (±W), así que un request firmado sigue siendo aceptable durante 2W + 1 segundos y la clave debe sobrevivirlo. Compártelo entre todas las instancias que comparten el par clientId/secreto. El chequeo ocurre después de verificar el HMAC.

### Verificación de token de servicio (`verifyServiceToken` / `serviceTokenAuth`)

El servicio receptor (por ejemplo Whatsapp-api) verifica el `Authorization: Bearer` contra el JWKS del Auth Service. `verifyServiceToken` vive en `@eva_solutions/auth-sdk/s2s` y `serviceTokenAuth` (Hono) en `@eva_solutions/auth-sdk/hono`. Reemplaza al `verifyServiceJwt` / `serviceJwtAuth` (`svc+jwt` con `bsha`) de las versiones anteriores; ver [ADR-020](decisions.md#adr-020-identidad-fase-1-tokens-de-servicio-token-de-usuario-por-producto-y-empresas).

```ts
import { Hono } from 'hono'
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
import { serviceTokenAuth, type ServiceTokenAuthVariables } from '@eva_solutions/auth-sdk/hono'

configureEvaAuth({ authUrl: process.env.AUTH_URL! }) // el JWKS sale de aquí; no hace falta `product`

const app = new Hono<{ Variables: ServiceTokenAuthVariables }>()
app.use(
  '/v1/internal/messages/text',
  serviceTokenAuth({ audience: 'whatsapp-api', requiredScope: 'messages:send:text' }),
)
app.post('/v1/internal/messages/text', (c) => {
  const id = c.var.serviceClientId // `sub`: id interno estable, la identidad
  const slug = c.var.serviceClientSlug // `client_id`: dato visible (logs, UI)
  const scopes = c.var.serviceScopes
  return c.json({ id, slug, scopes })
})
```

**Firma exacta:**

```ts
function verifyServiceToken(token: string, opts: ServiceTokenVerifyOptions): Promise<ServiceTokenVerifyResult>
function serviceTokenAuth(opts: ServiceTokenAuthOptions): MiddlewareHandler // = ServiceTokenVerifyOptions
```

**Formato del token** (lo emite el Auth Service):

| Parte | Valor |
|-------|-------|
| Header `alg` | `ES256` (cualquier otro se rechaza) |
| Header `typ` | `svc-at+jwt` (`SERVICE_TOKEN_TYP`). El del access token de usuario es `at+jwt` |
| Header `kid` | Prefijo `svc-` (`SERVICE_KID_PREFIX`). Un `kid` ausente o `usr-` ni llega a una clave |
| `iss` | `auth-service` |
| `aud` | **Una** audiencia de servicio: la del receptor (`whatsapp-api`, `auth-api`). Un `aud` con varias se rechaza |
| `sub` | Id interno estable del service client (uuid). Es la identidad |
| `client_id` | Slug del service client. Informativo |
| `scope` | Permisos separados por espacio |
| `iat`, `exp` | Obligatorios; `exp - iat` ≤ `maxLifetimeSeconds` (default 300; el token que Auth acuña por envío de OTP vive 60 s) |

No hay `bsha` ni replay cache: el token es reutilizable dentro de su vida. El efecto de un token robado lo acota la audiencia, el permiso y los 300 s.

**`ServiceTokenVerifyOptions`:**

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `audience` | `'auth-api' \| 'whatsapp-api'` | Obligatoria, del catálogo de `auth-contracts`. Un slug de producto o cualquier otro valor lanza `TypeError` |
| `requiredScope`, `anyScope` o `scopeCheck: 'deferred'` | `string` / `readonly string[]` / `'deferred'` | Exactamente uno. `'deferred'` autentica sin exigir permiso aquí y deja el permiso por ruta a `requireScope`. Cada permiso debe ser de la audiencia (`admin` en `auth-api` lanza `TypeError`); `anyScope` no puede ser vacío |
| `jwks` | `JWTVerifyGetKey` | Resolutor de claves. Por defecto el JWKS remoto (requiere `configureEvaAuth({ authUrl })`). Inyectable para tests; igual se filtra por el prefijo `svc-` |
| `maxLifetimeSeconds` | `number` | Default `SERVICE_TOKEN_LIFETIME_SECONDS` (300) |
| `clockToleranceSeconds` | `number` | Default `SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS` (5) |
| `messages` | `Partial<Record<ServiceTokenVerifyReason, string>>` | Override de mensajes |

**Resultado:** `{ ok: true, data: { serviceClientId, serviceClientSlug, scopes, jti } }` o `{ ok: false, error: { reason, message } }`.

| `reason` | Cuándo |
|----------|--------|
| `token_missing` | Sin `Authorization: Bearer <jwt>` (lo produce el middleware) |
| `token_malformed` | No es un JWS/JWT bien formado |
| `token_expired` | `exp` pasado más la tolerancia |
| `signature_invalid` | Firma inválida; `kid` ausente, `usr-` o desconocido; `alg` distinto de ES256 |
| `claims_invalid` | `typ`, `iss` o `aud` incorrectos; `sub` o `client_id` ausentes; `iat`/`exp` ausentes o fuera de rango; vida mayor al máximo |
| `scope_insufficient` | `scope` no cubre lo requerido |

**Middleware `serviceTokenAuth`:** en éxito setea `c.var.serviceClientId` (`sub`), `c.var.serviceClientSlug` (`client_id`) y `c.var.serviceScopes`. En fallo responde 401 `{ error: { code: <reason>, message } }`, salvo `scope_insufficient`, que responde 403 con `code: 'insufficient_scope'`. Para exigir un permiso distinto por ruta, monta `serviceTokenAuth({ audience, scopeCheck: 'deferred' })` una vez y `requireScope('permiso')` en cada ruta (`requireScope` lee `serviceScopes` cuando no hay `s2sScopes`), o un `serviceTokenAuth` por ruta. El esquema `Bearer` se compara sin distinguir mayúsculas (RFC 9110 §11.1). `serviceTokenAuth` valida sus opciones al construirse (`TypeError` al arrancar).

**Un access token de usuario no pasa, ni al revés.** El JWKS publica las dos claves, así que la separación la hacen chequeos independientes: el prefijo del `kid` decide qué claves se consideran (un token firmado con la clave de servicio bajo un `kid` `usr-` falla la firma, y viceversa), el `typ` distinto, la `aud` (producto en el de usuario, audiencia de servicio en el de servicio) y el `scope`. `verifyAccessToken` y `verifyServiceToken` rechazan los tokens sin `kid`.

**Errores que no son rechazos:** si falta `authUrl` (`EvaAuthConfigError`) o el JWKS no se puede descargar, `verifyServiceToken` lanza y el middleware responde 500: es infraestructura, no un token inválido, y un 401 haría que el emisor lo tratara como una credencial rechazada.

### Métodos del S2SClient

Los paths llevan el prefijo `/api/v1` del Auth Service (ver [migration.md](migration.md#9-rutas-del-auth-service-bajo-apiv1)).

| Método | HTTP | Path | Descripción |
|--------|------|------|-------------|
| `getUser(userId)` | GET | `/api/v1/internal/users/:id` | Obtiene usuario por ID. |
| `batchUsers(input)` | POST | `/api/v1/internal/users/batch` | Lote de usuarios por IDs. |
| `createWebhookSubscription(input)` | POST | `/api/v1/internal/webhooks/subscriptions` | Crea subscription. `signingKey` one-time. |
| `listWebhookSubscriptions()` | GET | `/api/v1/internal/webhooks/subscriptions` | Lista subscriptions. |
| `getWebhookSubscription(id)` | GET | `/api/v1/internal/webhooks/subscriptions/:id` | Detalle por ID. |
| `updateWebhookSubscription(id, input)` | PATCH | `/api/v1/internal/webhooks/subscriptions/:id` | Actualiza subscription. |
| `deleteWebhookSubscription(id)` | DELETE | `/api/v1/internal/webhooks/subscriptions/:id` | Elimina subscription. 204. |
| `rotateWebhookSubscriptionSecret(id)` | POST | `/api/v1/internal/webhooks/subscriptions/:id/rotate-secret` | Rota signing key. One-time. Puede responder `409 webhook_secret_rotation_conflict` si otra rotación concurrente ganó: esa llamada no recibe clave (no hay clave nueva de ese caller que guardar) y se puede reintentar. |
| `listWebhookDeliveries(query?)` | GET | `/api/v1/internal/webhooks/deliveries` | Lista entregas con filtros. |
| `createEmpresa(input)` | POST | `/api/v1/internal/empresas` | Crea la empresa. La persona de `input.subjectToken` queda **titular** y el producto del actor en `prueba` (el actor necesita `producto`). 201. `409 conflict` si `ruc`, `razonSocial` o `slug` ya existen; límite de altas por persona. `empresas:escribir`. |
| `updateEmpresa(id, input)` | PATCH | `/api/v1/internal/empresas/:id` | Datos maestros, perfil (`perfil: { visible, rubro, ciudad, descripcion }`) y `img`. `ruc` y `slug` son inmutables. Administrador o titular. `empresas:escribir`. |
| `listEmpresas(query?)` | GET | `/api/v1/internal/empresas?q=&cursor=` | Las empresas que contrataron el producto del actor, paginadas: `{ empresas, nextCursor }`. `empresas:leer`. |
| `getEmpresa(id)` | GET | `/api/v1/internal/empresas/:id` | Una empresa. `data.vista === 'completa'` (sucursales, miembros con rol y datos de contacto) para un actor con producto contratado por la empresa; `'recortada'` (`id`, `razonSocial`, `estado`, sucursales sin dirección) para un actor sin producto. `404` si no existe o no contrató el producto del actor. `empresas:leer`. |
| `bajaEmpresa(id)` / `reactivarEmpresa(id)` | POST | `/api/v1/internal/empresas/:id/baja` · `/reactivar` | Solo facturación (`empresas:baja`, sin persona). Una empresa de baja responde `404` a toda mutación salvo `reactivar`. |
| `addEmpresaMember(id, { userId, subjectToken })` | POST | `/api/v1/internal/empresas/:id/miembros` | Agrega un miembro (entra como `miembro`). 201; `409` si ya lo es. Administrador o titular. `empresas:escribir`. |
| `setEmpresaMemberRole(id, userId, { rol, subjectToken })` | PATCH | `/api/v1/internal/empresas/:id/miembros/:userId` | Cambia el rol (`titular`, `administrador`, `miembro`). Solo el titular. Siempre queda al menos un titular. |
| `removeEmpresaMember(id, userId, { subjectToken })` | DELETE | `/api/v1/internal/empresas/:id/miembros/:userId` | Quita un miembro. 204; `404` si no lo es. Con `userId` = la persona del token es salir por cuenta propia (cualquier rol, salvo el último titular). |
| `createSucursal(id, input)` | POST | `/api/v1/internal/empresas/:id/sucursales` | Crea una sucursal (`nombre`, `direccion?`, `subjectToken`). 201. Administrador o titular. |
| `updateSucursal(id, sucursalId, input)` | PATCH | `/api/v1/internal/empresas/:id/sucursales/:sucursalId` | Edita una sucursal. |
| `deactivateSucursal(id, sucursalId, { subjectToken })` | DELETE | `/api/v1/internal/empresas/:id/sucursales/:sucursalId` | Baja lógica (`activa = false`). 204. |
| `requestContratacion(id, { subjectToken })` | POST | `/api/v1/internal/empresas/:id/productos` | El actor pide la contratación de **su propio** producto (`pendiente_pago`). La persona debe ser titular; `404` igual si la empresa no existe o no es titular. Solo si no hay fila o está `cancelado`. Permiso `contrataciones:pedir` (concedible a productos). |
| `cancelContratacion(id, { subjectToken })` | DELETE | `/api/v1/internal/empresas/:id/productos` | Cancela la contratación del propio producto (`cancelado`, desde cualquier estado). Solo titular. 204. `contrataciones:pedir`. |
| `getContratacion(id, producto)` | GET | `/api/v1/internal/empresas/:id/productos/:producto` | `{ contratado }` (`prueba` o `activo` y sin vencer): para servicios compartidos que atienden llamadas de servicio. `contrataciones:leer`. |
| `setContratacion(id, producto, input)` | PUT | `/api/v1/internal/empresas/:id/productos/:producto` | Facturación (actor sin `producto`): `estado` y `hasta`. `contrataciones:escribir`, que solo se concede a facturación, no a productos. |
| `createGrupo(input)` / `renameGrupo(id, input)` | POST / PATCH | `/api/v1/internal/grupos` · `/grupos/:id` | Agrupación de empresas (no da acceso). Solo titular. |
| `addGrupoEmpresa(id, input)` / `removeGrupoEmpresa(id, empresaId, input)` | POST / DELETE | `/api/v1/internal/grupos/:id/empresas[/:empresaId]` | Agrega o quita una empresa de la que la persona es titular. Un grupo vacío se borra solo. |
| `searchDirectorio(query?)` | GET | `/api/v1/directorio?q=&rubro=&ciudad=&cursor=` | Directorio de empresas visibles, para servicios con `directorio:leer`. |
| `createAutorizacion(otorganteId, input)` | POST | `/api/v1/internal/empresas/:id/autorizaciones` | `{ beneficiariaId, permiso, subjectToken }`; el permiso es del catálogo entre empresas. 201; `409` si ya está vigente. `autorizaciones:escribir`. |
| `deleteAutorizacion(empresaId, autorizacionId, { subjectToken })` | DELETE | `/api/v1/internal/empresas/:id/autorizaciones/:autorizacionId` | Revoca (otorgante) o renuncia (beneficiaria). 204. |
| `listAutorizaciones(empresaId, { direccion, subjectToken })` | GET | `/api/v1/internal/empresas/:id/autorizaciones?direccion=` | `otorgadas` o `recibidas`, vigentes. La persona viaja en el header `x-eva-subject-token` (un GET no tiene body). `autorizaciones:leer`. |
| `checkAutorizacion({ otorgante, beneficiaria, permiso })` | GET | `/api/v1/internal/autorizaciones/verificar` | `{ autorizado }`. Solo para actores sin `producto` cuya audiencia es dueña del permiso. Vale si las dos empresas están activas. **Caché de 30 s por cliente** (también las negativas, no los errores): una revocación o una baja tardan como máximo eso en notarse. `autorizaciones:leer`. |

Todos los métodos retornan `Promise<Result<T>>` con `error: EvaError`. Los ids se validan y codifican como un solo segmento de path, igual que los demás.

**Un solo mecanismo para las acciones de una persona sobre una empresa.** El backend del producto manda su token de servicio (`aud: auth-api`, el permiso de la ruta) **más el access token de la persona** como `subjectToken` en el body (`DELETE` incluido; en el único `GET` que necesita a la persona, `listAutorizaciones`, va en el header `x-eva-subject-token`, nunca en la URL). Auth valida firma y vigencia del `subjectToken`, que su `aud` sea el producto del actor, la sesión, el producto habilitado, el usuario activo, el **rol de la persona en la empresa de la ruta** (que Auth lee de la base en cada operación, no viaja en los tokens) y la contratación. La empresa sale de la **ruta**, no de la sesión. **Un fallo del token de la persona responde `403` con `code: subject_token_invalid`** (`SUBJECT_TOKEN_INVALID_CODE`), nunca `401`: un 401 es del Bearer de servicio y es lo único que hace que `createS2SClient` descarte el token de servicio y reintente. **No se usan tokens delegados para hablar con Auth.** Lo reservado a admin o facturación (`bajaEmpresa`, `reactivarEmpresa`, `setContratacion`) no lleva `subjectToken`.

| Acción | titular | administrador | miembro |
|--------|:-------:|:-------------:|:-------:|
| Pedir o cancelar la contratación de un producto, cambiar roles, agrupar | sí | | |
| Agregar o quitar personas (no titulares), editar datos maestros y perfil, sucursales, conceder o revocar autorizaciones | sí | sí | |
| Salir de la empresa por cuenta propia | sí (si queda otro titular) | sí | sí |

Un actor con `producto` solo ve y opera empresas que contrataron su producto (`404` si no, sin distinguir de inexistente). `GET /user/empresas` devuelve el `rol`, el `grupo` y `contratado` de cada empresa.

---

## `@eva_solutions/auth-sdk/contracts`

Contrato compartido del wire del Auth Service: los schemas Zod, las constantes y los descriptores de ruta que la API del Auth Service y este SDK deben acordar, definidos una sola vez. Lo consume la API del Auth Service (`import { loginRequestSchema } from '@eva_solutions/auth-sdk/contracts'`); el SDK lo usa por dentro para sus clientes y tipos.

El código vive en el paquete privado `@eva_solutions/auth-contracts` (`packages/auth-contracts/`), que **nunca se publica**: el build lo inlinea en este entry, así que el consumidor instala solo `@eva_solutions/auth-sdk`. Ver [architecture.md](architecture.md#contrato-compartido) y el [README del contrato](../packages/auth-contracts/README.md).

> **Una sola copia de `zod`.** Los schemas se construyen con el `zod` que resuelve el consumidor. Si el lock del consumidor tiene dos versiones, los schemas de una de ellas no son asignables a `createRoute` de `@hono/zod-openapi` (`TS2322`, o el body queda tipado como `never`). El lock debe resolver exactamente una versión de `zod`.

Cobertura actual (crece por slices; lo demás sigue definido en el SDK y en la API):

| Export | Tipo | Descripción |
|--------|------|-------------|
| `ERROR_CODES` | constante | 12 codes core del wire de errores (cada clave es igual a su valor). El catálogo es abierto |
| `CoreErrorCode` | type | Unión de literales de `ERROR_CODES` |
| `HEADERS` | constante | Nombres de los headers de sesión: `AUTHORIZATION`, `REFRESH_TOKEN`, `NEW_ACCESS_TOKEN`, `NEW_REFRESH_TOKEN` |
| `INTERNAL_HEADERS` | constante | Nombres de los headers S2S: `X_EVA_CLIENT_ID`, `X_EVA_TIMESTAMP`, `X_EVA_NONCE`, `X_EVA_SIGNATURE`, `X_EVA_SERVER_TIME` |
| `API_PREFIX` | constante | `'/api/v1'`: prefijo de todas las rutas del Auth Service salvo JWKS, `/health`, `/ui` y `/doc`. Los clientes del SDK lo anteponen con `apiPath()` |
| `AUTH_ROUTES` | constante | Descriptores `{ method, path }` de `getCode`, `login`, `refresh`, `logout` y `setActiveEmpresa` (`POST /auth/empresa-activa`), con `path` relativo a `API_PREFIX` (la ruta real es `/api/v1` + `path`) |
| `USER_ROUTES`, `SESSION_ROUTES`, `INTERNAL_USER_ROUTES` | constante | Descriptores `{ method, path }` de usuario (`get`, `update`, `deactivate`, `listCompanies`), sesiones (`list`, `deleteOne`, `deleteAll`) y `/api/v1/internal/users` (`get`, `batch`) |
| `ACCOUNT_STATES` | constante | Objeto con los 6 estados de cuenta (clave igual a valor); también se re-exporta desde `@eva_solutions/auth-sdk` |
| `ACTIVITY_STATES`, `PRIVACY_STATES` | constante | Tuplas `as const` de los estados de actividad y de privacidad |
| `USERS_BATCH_MAX_IDS` | constante | `100`: tope de ids de `POST /api/v1/internal/users/batch`. El schema del batch lo lleva como `.max(100)` (`maxItems` en el OpenAPI); el cliente del SDK lo valida antes del fetch y la API puede bajarlo con su env |
| `publicProfileSchema`, `profileResponseSchema`, `companyListResponseSchema` (cada empresa con `rol`, `grupo` y `contratado`; las que la persona es titular sin el producto del token vienen como `contratado: false`, sin contacto ni sucursales), `updateUserRequestSchema` (+ tipos `PublicProfile`, `ProfileResponse`, `CompanyListResponse`, `Company`, `UpdateUserRequest`) | schema + type | Perfil, empresas y body de `PATCH /api/v1/user` (objeto estricto base, sin `.refine`) |
| `sessionListResponseSchema` (+ `SessionListResponse`, `Session`) | schema + type | Listado de sesiones |
| `usersBatchRequestSchema`, `usersBatchResponseSchema` (+ `UsersBatchRequest`, `UsersBatchResponse`) | schema + type | `POST /api/v1/internal/users/batch` |
| `WEBHOOK_ROUTES`, `ADMIN_ROUTES` | constante | Descriptores de las 7 rutas de `/api/v1/internal/webhooks/*` y de las 24 de `/api/v1/admin/*` (6 de service-clients, 3 de concesiones, 3 de delegaciones, 3 de productos, 2 de permisos autorizables, titular, baja, reactivar y contratación de empresas, `restoreUser`, `republishPendingWebhooks` y `maintenanceCleanup`) |
| `INTERNAL_TOKEN_ROUTES`, `INTERNAL_TOKEN_EXCHANGE_ROUTES`, `INTERNAL_EMPRESA_ROUTES`, `INTERNAL_GRUPO_ROUTES`, `INTERNAL_AUTORIZACION_ROUTES`, `DIRECTORIO_ROUTES` | constante | `POST /api/v1/internal/token`, `POST /api/v1/internal/token-exchange`, las 19 rutas de `/api/v1/internal/empresas/*` (datos, miembros, sucursales, contratación, autorizaciones), las 4 de `/internal/grupos`, `GET /internal/autorizaciones/verificar` y `GET /directorio` |
| `EVENT_CODES` (+ type `EventCode`) | constante | Los 27 event codes de los webhooks (clave en mayúsculas, valor `user.created`, ..., `empresa.created`, ..., `empresa.product_changed`, `grupo.*`, `autorizacion.*`). Módulo puro aparte (`event-codes`): no entra al bundle de `react` |
| `IDENTITY_EVENT_PAYLOAD_SCHEMAS` (+ schemas por payload) | constante | `data` de los 12 eventos de la fase 2, por event code. **Solo ids** (y `rol` / `estado` / `permiso`): sin datos de contacto. `empresa.*`, `grupo.*` y `autorizacion.*` se entregan solo a los clients cuyo producto contrató la empresa afectada (o que no tienen producto) |
| `WEBHOOK_HEADERS`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` | constante | Nombres en minúsculas de los headers del webhook (`SIGNATURE`, `ID`, `TIMESTAMP`) y ventana de la marca de tiempo (`300` s) |
| `DELIVERY_STATUSES` | constante | Tupla de estados de entrega |
| `SERVICE_AUDIENCE_SCOPES`, `SERVICE_AUDIENCES` (+ types `ServiceAudience`, `ServiceScope<A>`), `isServiceAudience`, `isScopeOfAudience` | constante + función | Catálogo cerrado de audiencias de servicio y sus permisos: `auth-api` (`users:read`, `webhooks:read`, `webhooks:write`, `empresas:leer`, `empresas:escribir`, `tokens:exchange`, `contrataciones:pedir`, `contrataciones:escribir`, `contrataciones:leer`, `empresas:baja`, `autorizaciones:escribir`, `autorizaciones:leer`, `directorio:leer`; **sin `admin`**) y `whatsapp-api` (`messages:send:text`, `messages:send:media`, `admin`). Un slug de producto nunca coincide con una audiencia (`isServiceAudience`) |
| `DELEGABLE_AUDIENCE_SCOPES`, `DELEGABLE_AUDIENCES`, `DELEGABLE_SCOPES`, `isDelegableAudience`, `isDelegableScope` (+ types) | constante + función | Lo que una arista de delegación puede llevar: hoy `whatsapp-api` con `messages:send:text` y `messages:send:media`. **`auth-api` nunca es destino y `admin` nunca es delegable** (un test lo fija) |
| `INTER_EMPRESA_PERMISSIONS`, `INTER_EMPRESA_PERMISSION_LIST`, `isInterEmpresaPermission`, `interEmpresaPermissionOwner` (+ types) | constante + función | Catálogo **cerrado y separado** de permisos entre empresas ("la empresa B puede X sobre los datos de A"), por servicio dueño de los datos. Arranca mínimo (`whatsapp-api`: `whatsapp:mensajes:leer`) y cada servicio agrega los suyos. Distinto del de audiencias: "el client puede X" no es "la empresa B puede X sobre A" |
| `EMPRESA_ROLES`, `empresaRoleAtLeast`, `EMPRESA_ESTADOS`, `CONTRATACION_ESTADOS`, `CONTRATACION_ESTADOS_VIGENTES`, `CONTRATACION_ESTADOS_FACTURACION`, `isContratacionVigente`, `AUTORIZACION_DIRECCIONES`, `TITULAR_ANTERIOR_DESTINOS` | constante + función | Vocabulario de empresas (módulo puro): roles `titular` > `administrador` > `miembro`, estados de empresa (`activa`, `baja`) y de contratación (`prueba`, `pendiente_pago`, `activo`, `suspendido`, `cancelado`; solo `prueba` y `activo`, sin vencer, cuentan como contratado) |
| `SUBJECT_TOKEN_INVALID_STATUS`, `SUBJECT_TOKEN_INVALID_CODE`, `TOKEN_BEARING_KEYS` | constante | Fallo de la persona (`403 subject_token_invalid`) y claves que transportan tokens (`subjectToken`, `subject_token`, `x-eva-subject-token`, `access_token`): Auth - API las redacta en logs y auditoría |
| `DELEGATED_TOKEN_TYP`, `DELEGATED_TOKEN_LIFETIME_SECONDS`, `DELEGATED_TOKEN_MAX_DEPTH`, `TOKEN_EXCHANGE_GRANT_TYPE`, `ACCESS_TOKEN_TYPE`, `SUBJECT_TOKEN_HEADER`, `TOKEN_EXCHANGE_ERROR_CODES`, `DelegatedActorClaim` | constante + type | Token delegado: `typ: dlg-at+jwt`, vida 120 s, cadena `act` de máximo 3 niveles, identificadores RFC 8693, header `x-eva-subject-token` y códigos de error del exchange |
| `tokenExchangeRequestSchema`, `tokenExchangeResponseSchema`, `tokenExchangeErrorSchema` (+ tipos) | schema + type | `POST /api/v1/internal/token-exchange`. Como el endpoint de tokens: sin envoltorio `data` ni `error: { code, message }`, sigue RFC 8693 |
| `TOKEN_ISSUER`, `RESERVED_SERVICE_CLIENT_SLUGS`, `isReservedServiceClientSlug`, `AUTH_SERVICE_SUB`, `USER_TOKEN_TYP`, `SERVICE_TOKEN_TYP`, `USER_KID_PREFIX`, `SERVICE_KID_PREFIX`, `SERVICE_TOKEN_LIFETIME_SECONDS`, `INTERNAL_SERVICE_TOKEN_LIFETIME_SECONDS`, `SERVICE_TOKEN_ERROR_CODES` | constante + función | Vocabulario de los tokens: emisor (`auth-service`, slug reservado), `typ` (`at+jwt` / `svc-at+jwt`), prefijos de `kid` (`usr-` / `svc-`), vidas (300 s; 60 s para el OTP), id fijo de Auth como `sub` y códigos de error del endpoint de tokens |
| `serviceTokenRequestSchema`, `serviceTokenResponseSchema`, `serviceTokenErrorSchema` (+ tipos) | schema + type | `POST /api/v1/internal/token`. Sin envoltorio `data` ni `error: { code, message }`: sigue RFC 6749 §5.1/§5.2 y RFC 8707 |
| `setServiceClientGrantRequestSchema`, `serviceClientGrantSchema`, `listServiceClientGrantsResponseSchema`, `setServiceClientGrantResponseSchema` (+ tipos) | schema + type | Concesiones. El body es una unión discriminada por `audience`: un permiso de otra audiencia (o `admin` en `auth-api`) lo rechaza el schema |
| `subjectTokenSchema`, `createEmpresaRequestSchema`, `updateEmpresaRequestSchema`, `listEmpresasQuerySchema`, `addEmpresaMemberRequestSchema`, `updateEmpresaMemberRequestSchema`, `removeEmpresaMemberRequestSchema`, `createSucursalRequestSchema`, `updateSucursalRequestSchema`, `deactivateSucursalRequestSchema`, `reassignTitularRequestSchema`, `empresaResponseSchema`, `listEmpresasResponseSchema`, `empresaDetailResponseSchema`, `empresaRecortadaResponseSchema`, `getEmpresaResponseSchema`, `empresaMemberResponseSchema`, `empresaEstadoResponseSchema`, `reassignTitularResponseSchema`, `sucursalResponseSchema`, `sucursalSchema` (+ tipos) | schema + type | API interna de empresas y sucursales: cada body de una persona lleva `subjectToken`; `GET /internal/empresas/{id}` responde `completa` o `recortada` (`data.vista`) |
| `contratacionSchema`, `setContratacionRequestSchema`, `contratacionResponseSchema`, `contratadoResponseSchema` (+ tipos) | schema + type | Contratación de productos (§2 del diseño) |
| `grupoSchema`, `createGrupoRequestSchema`, `renameGrupoRequestSchema`, `addGrupoEmpresaRequestSchema`, `removeGrupoEmpresaRequestSchema`, `grupoResponseSchema` (+ tipos) | schema + type | Grupos de empresas (solo agrupación) |
| `directorioQuerySchema`, `directorioEmpresaSchema`, `directorioResponseSchema` (+ tipos) | schema + type | `GET /api/v1/directorio`: solo campos de perfil público |
| `createAutorizacionRequestSchema`, `deleteAutorizacionRequestSchema`, `listAutorizacionesQuerySchema`, `verificarAutorizacionQuerySchema`, `autorizacionSchema`, `autorizacionResponseSchema`, `listAutorizacionesResponseSchema`, `verificarAutorizacionResponseSchema`, `setProductoPermisosAutorizablesRequestSchema`, `productoPermisosAutorizablesResponseSchema` (+ tipos) | schema + type | Autorizaciones entre empresas y permisos autorizables por producto |
| `setServiceClientDelegationRequestSchema`, `serviceClientDelegationSchema`, `listServiceClientDelegationsResponseSchema`, `setServiceClientDelegationResponseSchema` (+ tipos) | schema + type | Aristas de delegación (`/admin/service-clients/{slug}/delegations`). El body es una unión por audiencia delegable: `auth-api` y `admin` los rechaza el schema |
| `productoSchema`, `createProductoRequestSchema`, `updateProductoRequestSchema` (base estricto, sin `.refine`), `listProductosResponseSchema`, `productoResponseSchema` (+ tipos) | schema + type | Admin de productos (`/api/v1/admin/productos`). Sin DELETE: se deshabilita. El API aplica lo que el contrato no lleva: 400 si el slug es una audiencia de servicio (`isServiceAudience`) o si el body de PATCH viene vacío |
| `productoSlugSchema`, `setActiveEmpresaRequestSchema`, `setActiveEmpresaResponseSchema` | schema | `producto` (obligatorio) y `empresaId` (opcional) del login; `POST /api/v1/auth/empresa-activa` |
| `createSubscriptionRequestSchema`, `updateSubscriptionRequestSchema`, `deliveriesQuerySchema`, `republishPendingQuerySchema`, `republishPendingResponseSchema`, `maintenanceCleanupQuerySchema`, `maintenanceCleanupResponseSchema`, `subscriptionSchema`, `subscriptionWithSecretResponseSchema`, `subscriptionResponseSchema`, `subscriptionListResponseSchema`, `rotateSubscriptionSecretResponseSchema`, `deliverySchema`, `deliveryListResponseSchema` (+ tipos) | schema + type | Webhooks: subscriptions y deliveries |
| `serviceClientSlugSchema`, `createServiceClientRequestSchema` (`esAdmin`, `producto?`, `audiencia?`), `updateServiceClientRequestSchema` (base estricto, sin `.refine`; `producto` y `audiencia` admiten `null`), `serviceClientPublicSchema` (con `esAdmin`, `producto`, `audiencia` y `grants`), `createServiceClientResponseSchema`, `listServiceClientsResponseSchema`, `getServiceClientResponseSchema`, `updateServiceClientResponseSchema`, `rotateServiceClientSecretResponseSchema`, `restoreUserResponseSchema` (+ tipos) | schema + type | Service clients (`/api/v1/admin/service-clients`) y restaurar usuario |
| `HttpMethod`, `RouteDescriptor` | types | Tipos de los descriptores |
| `errorResponseSchema`, `ErrorResponse` | schema + type | Cuerpo de error `{ error: { code, message } }` (id OpenAPI `ErrorBody`) |
| `messageResponseSchema`, `messageWithCountResponseSchema` (+ tipos `MessageResponse`, `MessageWithCountResponse`) | schema + type | Respuestas genéricas con mensaje |
| `getCodeRequestSchema`, `getCodeResponseSchema`, `loginRequestSchema` (con `producto` obligatorio y `empresaId` opcional; `get-code` no los lleva), `loginResponseSchema` | schema | Flujo de login. `/api/v1/login/refresh` responde con `loginResponseSchema` y `/api/v1/login/logout` con `messageResponseSchema` |
| `GetCodeRequest`, `GetCodeResponse`, `LoginRequest`, `LoginResponse` | type | `z.input<>` para requests y `z.output<>` para responses |

Los schemas usan metadata `.meta()` (nunca `.openapi()`) y los de request son objetos planos estrictos, sin `.refine`. `ERROR_CODES` y `HEADERS` también se re-exportan desde `@eva_solutions/auth-sdk`. Los schemas BFF del SDK (`GetCodeSchema`, `LoginSchema`, `UpdateUserSchema`) siguen siendo propios y más laxos: la autoridad de validación es el servidor.

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

// Login en dos pasos: el challengeId de getCode viaja a verify
const res = await login.getCode({ phone })
if (res.ok) {
  const { challengeId } = res.data
  await login.verify({ phone, code, challengeId })
}

// Logout
await logout()
```

Retorna:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isAuthenticated` | `boolean` | Si hay sesión activa |
| `isLoading` | `boolean` | Si hay operación en curso |
| `error` | `string \| null` | Último error |
| `login.getCode` | `({ phone }) => Promise<Result<{ message: string; challengeId: string }>>` | Solicita código OTP; devuelve el `challengeId` que `verify` exige |
| `login.verify` | `({ phone, code, challengeId }) => Promise<Result<{ user: { id: string } }>>` | Verifica código y autentica. El provider no guarda el `challengeId`: conservarlo es responsabilidad del llamador |
| `logout` | `() => Promise` | Cierra sesión |

---

### `useUser()`

Hook para obtener datos del usuario autenticado. Usa `useAuthData` internamente para `GET /me` (ruta del BFF del consumidor, no del Auth Service).

```ts
const { data, isLoading, error } = useUser()
```

---

### `useSessions()`

Hook para obtener sesiones activas. Usa `useAuthData` internamente para `GET /sessions` (ruta del BFF del consumidor, no del Auth Service: no lleva `/api/v1`).

```ts
const { data, isLoading, error } = useSessions()
```

---

### `useEmpresas()`

Hook para obtener empresas del usuario. Usa `useAuthData` internamente para `GET /empresas` (ruta del BFF del consumidor, no del Auth Service).

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
| `getCookieNames` | `constants.ts` | Nombres de las cookies del producto configurado |
| `COOKIE_MAX_AGE` | `constants.ts` | TTL de las cookies |
| `HEADERS` | `constants.ts` | Nombres de headers custom del protocolo |
| `DEFAULT_ERROR_MESSAGES` | `error-messages.ts` | Defaults de mensajes de error |
| `EvaErrorMessages` | `error-messages.ts` | Type de los 17 keys |

---

## Referencias cruzadas

- **ADR-011**: `EvaTokenPayload<TExtra>` y `extraClaimsSchema` — ver [decisions.md](decisions.md#adr-011-generic-evatokenpayload--optional-schema-validation)
- **ADR-012**: Sistema i18n de mensajes de error, `buildAuthHandlers`, entry point `/hono-openapi` — ver [decisions.md](decisions.md#adr-012-sistema-i18n-de-mensajes-de-error)
- **ADR — EvaError discriminated union**: D-02 v3 — ver [decisions.md](decisions.md)
- **ADR — errorWire configurable**: D-13 v2 — ver [decisions.md](decisions.md)
- **Migration 0.x → 1.0.0**: [migration.md](migration.md)
- **Configuración completa**: [configuration.md](configuration.md)

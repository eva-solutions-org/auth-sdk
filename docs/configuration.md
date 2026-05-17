# Configuración

## Extending JWT claims

Por defecto, el SDK solo expone `{ id, sessionId }` en el payload de un token verificado — los claims extra del JWT se descartan (defense-in-depth: el SDK no expone claims que no validó). Para acceder a claims adicionales de forma tipada y con validación runtime, usa `extraClaimsSchema`.

### Cómo funciona

Al crear el middleware o llamar a las funciones de verificación, puedes pasar un `extraClaimsSchema?: ZodType<TExtra>`. El generic `TExtra` es inferido automáticamente del schema — no necesitas pasarlo manualmente.

**Sin schema** (comportamiento predeterminado):
```ts
const auth = evaAuth()
// c.var.evaPayload: EvaTokenPayload = { id: string; sessionId: string }
// Los claims extra del JWT (phone, empresaId, etc.) son descartados.
```

**Con schema**:
```ts
import { z } from 'zod'
import { evaAuth } from '@eva_solutions/auth-sdk/hono'

const myClaims = z.object({
  phone: z.string(),
  empresaId: z.string().uuid(),
})

// evaAuth infiere TExtra = { phone: string; empresaId: string }
const auth = evaAuth({ extraClaimsSchema: myClaims })

app.use('/api/*', auth)

app.get('/api/me', (c) => {
  const payload = c.var.evaPayload
  // payload: EvaTokenPayload<{ phone: string; empresaId: string }>
  // = { id: string; sessionId: string; phone: string; empresaId: string }
  return c.json({ phone: payload.phone, empresa: payload.empresaId })
})
```

Si el JWT no tiene `phone` o `empresaId`, o los tiene con tipos incorrectos, el middleware retorna `401`. Sin cast. Sin silencio.

### Uso en generic entry (`@eva_solutions/auth-sdk/generic`)

```ts
import { z } from 'zod'
import { verifyRequest } from '@eva_solutions/auth-sdk/generic'

const tierSchema = z.object({ tier: z.enum(['free', 'pro']) })

const result = await verifyRequest(request, { extraClaimsSchema: tierSchema })
if (result.ok) {
  // result.data.payload: EvaTokenPayload<{ tier: 'free' | 'pro' }>
  const { tier } = result.data.payload
}
```

### Uso en verify directo (`@eva_solutions/auth-sdk`)

```ts
import { z } from 'zod'
import { verifyAccessToken } from '@eva_solutions/auth-sdk'

const result = await verifyAccessToken(token, {
  extraClaimsSchema: z.object({ role: z.enum(['admin', 'user']) }),
})
if (result.ok) {
  // result.data: EvaTokenPayload<{ role: 'admin' | 'user' }>
}
```

### Multi-tenant

Cada instancia de `evaAuth` es independiente — cero estado global. Puedes tener schemas distintos por ruta:

```ts
const adminSchema = z.object({ role: z.literal('admin'), empresaId: z.string() })
const userSchema = z.object({ phone: z.string() })

app.use('/admin/*', evaAuth({ extraClaimsSchema: adminSchema }))
app.use('/api/*', evaAuth({ extraClaimsSchema: userSchema }))
```

### Modos de validación de schema (Zod)

El SDK aplica el schema de Zod con `safeParseAsync`. El modo de parsing depende de cómo defines el schema:

| Modo | Comportamiento con claims no declarados en schema |
|------|---------------------------------------------------|
| `.strip()` (default) | Se ignoran — solo se exponen los campos del schema |
| `.strict()` | El schema rechaza el JWT si hay claims no declarados (útil para defense-in-depth extra) |
| `.passthrough()` | Los claims extra se incluyen en el payload incluso sin estar en el schema (no recomendado) |

### Claims reservados

Estos claims NUNCA se exponen en `EvaTokenPayload`, aunque estén en el JWT:

`iat`, `exp`, `iss`, `aud`, `jti`, `sub`, `nbf`, `nonce`, `auth_time`, `acr`, `amr`, `azp`

(RFC 7519 §4.1 + OIDC Core 1.0 §2)

Si `extraClaimsSchema` declara alguno de estos claims (o `id`, `sessionId`), el SDK lanza un error inmediato en la primera invocación del middleware/verify (fail-fast).

```ts
// ERROR: exp es un claim reservado
evaAuth({ extraClaimsSchema: z.object({ exp: z.number() }) })
// → Error: extraClaimsSchema declara un claim reservado: "exp". Claims reservados (RFC 7519/8725 + OIDC Core 1.0 §2): iat, exp, ...
```

### Anti-pattern: generic explícito sin schema

```ts
// INCORRECTO — compila pero miente: phone será undefined a runtime
const auth = evaAuth<{ phone: string }>()

// CORRECTO — type safety + validación runtime
const auth = evaAuth({ extraClaimsSchema: z.object({ phone: z.string() }) })
```

Ver [ADR-011](decisions.md#adr-011-generic-evatokenpayload--optional-schema-validation) para el razonamiento de diseño.

---

## configureEvaAuth — Configuración runtime

A partir del change `deployment-flexibility`, el SDK ofrece `configureEvaAuth(opts)` para inyectar configuración en runtime sin necesidad de rebuild. Llamar al **boot**, antes del primer request.

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
// También disponible desde @eva_solutions/auth-sdk/hono, /generic y /react

configureEvaAuth({
  authUrl: process.env.EVA_AUTH_URL,         // Override URL del Auth Service
  cookieDomain: process.env.COOKIE_DOMAIN,   // Domain para cookies (ej: '.miempresa.com')
})
```

### Opciones

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `authUrl` | `string \| undefined` | URL del Auth Service. Override con máxima precedencia. Si se omite, no resetea el valor previo. |
| `cookieDomain` | `string \| undefined` | Atributo `Domain` para `Set-Cookie`. Si se omite, no resetea el valor previo. |
| `errorWire` | `'api' \| 'string' \| undefined` | Shape HTTP que el SDK emite cuando rechaza un request. Default: `'api'`. Ver [sección errorWire](#errorwire) más abajo. |
| `errorMessages` | `Partial<EvaErrorMessages> \| undefined` | Override de mensajes de error. Ver [sección Mensajes de error personalizados](#mensajes-de-error-personalizados). |

### Validaciones

- `authUrl` debe ser una URL válida con protocolo `http:` o `https:`. Si no es válida o usa otro protocolo (`javascript:`, `data:`, `file:`, `ftp:`), la llamada **lanza inmediatamente** con mensaje descriptivo.
- `cookieDomain` no puede contener `;`, `\r` ni `\n` (defensa contra header injection). Si los contiene, **lanza inmediatamente**.

### Idempotencia

Llamadas repetidas sobrescriben los campos provistos. Un campo omitido (`undefined`) preserva el valor previo:

```ts
configureEvaAuth({ authUrl: 'https://auth-a.com', cookieDomain: '.a.com' })
configureEvaAuth({ cookieDomain: '.b.com' })  // authUrl sigue siendo 'https://auth-a.com'
```

### Precedencia de URL del Auth Service

```
configureEvaAuth({ authUrl }) > process.env.EVA_AUTH_URL > __EVA_AUTH_URL__ (build-time)
```

Si `process.env.EVA_AUTH_URL` contiene un valor inválido, el SDK emite `console.warn` y cae al build-time fallback sin lanzar.

### Invalidación de JWKS cache

Al cambiar `authUrl` a un valor distinto, el SDK invalida automáticamente el cache JWKS. El siguiente fetch de public key irá al nuevo host. Si el `authUrl` es idéntico al previo, el cache se preserva.

### Recomendación de cookieDomain para subdominios

Para compartir cookies entre `app.miempresa.com` y `api.miempresa.com`, usar `.miempresa.com` (con punto leading):

```ts
configureEvaAuth({ cookieDomain: '.miempresa.com' })
```

Sin punto leading (`miempresa.com`), el browser puede restringir la cookie al dominio exacto según el navegador.

### Advertencia: Safari + Secure + HTTP (M-5)

> **Warning**: en builds `dev` y `prod` el flag `Secure=true` está activo (ver ADR-007). Safari descarta cookies con `Secure` si la conexión no es HTTPS, incluso en `localhost`. Chrome tiene comportamiento parcialmente similar en ciertas versiones.
>
> **Para desarrollo local sobre HTTP**: usar `pnpm build:local` (que setea `__EVA_ENV__=local` y desactiva `Secure`).
> **Para staging / PR previews**: configurar HTTPS end-to-end (ej: Cloudflare, Vercel, mkcert para local).

### Orden de inicialización — importa

Llamar `configureEvaAuth` **antes del primer request**. Las cookies ya emitidas no se reescriben retroactivamente:

```ts
// boot.ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
configureEvaAuth({ cookieDomain: '.miempresa.com' })  // PRIMERO

// app.ts
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'
app.route('/auth', evaAuthRoutes())   // DESPUÉS
app.use('/api/*', evaAuth())
```

---

## errorWire

**Tipo**: `'api' | 'string'`
**Default**: `'api'`
**Desde**: v1.0.0

Controla el shape HTTP que el SDK emite cuando un middleware o handler rechaza un request.

### 'api' (default)

```json
{ "error": { "code": "unauthorized", "message": "Se requiere autenticación" } }
```

Consistente con el Auth Service API. Recomendado para stacks nuevos.

### 'string' (legacy)

```json
{ "error": "Se requiere autenticación" }
```

Compatible con el shape de 0.x. Para consumers que esperan mensaje plano.

### Configuración

```typescript
import { configureEvaAuth } from '@eva_solutions/auth-sdk'

// Default (se puede omitir):
configureEvaAuth({ errorWire: 'api' })

// Legacy:
configureEvaAuth({ errorWire: 'string' })
```

### Mapping SdkErrorReason → code (cuando errorWire='api')

Cuando el rechazo es un error interno del SDK (no del API), el SDK mapea el reason a un code compatible con `ERROR_CODES`:

| Situación | reason | code emitido |
|-----------|--------|-------------|
| Sin tokens en el request | `auth_required` | `unauthorized` |
| Token inválido/expirado | `token_invalid` | `unauthorized` |
| Refresh sin tokens nuevos | `refresh_no_tokens` | `unauthorized` |
| Fallo de verificación | `verify_failed` | `unauthorized` |
| Error de red | `network` | `service_unavailable` |
| Respuesta malformada | `malformed` | `bad_request` |

> **Nota sobre OpenAPI**: el schema `ErrorResponseSchema` en `@eva_solutions/auth-sdk/hono-openapi` siempre refleja el shape `'api'` independientemente de la configuración `errorWire`. Si usas `errorWire: 'string'`, el wire real difiere del doc OpenAPI. Ver [ADR D-13 v2](decisions.md).

---

## Footgun: cambiar `cookieDomain` entre login y logout

RFC 6265 exige que para borrar una cookie, el `Set-Cookie; Max-Age=0` del logout debe tener exactamente el mismo `domain` y `path` que el `Set-Cookie` original del login.

**Escenario problemático**:

```
1. Deploy con cookieDomain='.miempresa.com'
   → Browser almacena cookie con Domain=.miempresa.com
2. Redeploy con cookieDomain='app.miempresa.com'
   → Logout emite Set-Cookie con Domain=app.miempresa.com; Max-Age=0
   → Browser IGNORA el clear (no coincide el domain)
   → Cookie persiste en el browser del usuario
```

**Mitigación recomendada**: no cambiar `cookieDomain` entre deploys. Si es inevitable, instruir al usuario a borrar cookies manualmente, o cambiar el nombre de la cookie (lo que invalida todos los tokens activos).

---

## Modelo build-time

El SDK **también soporta** configuración horneada en build-time para el caso zero-config. Si `configureEvaAuth()` no se llama, todo el comportamiento previo se preserva.

> **Nota**: antes de `deployment-flexibility`, este era el único modelo. Ahora es el fallback.

---

## Cómo funciona

`tsdown.config.ts` contiene un map interno de URLs por entorno:

```ts
const envUrls = {
  local: 'http://localhost:4000',
  development: 'https://auth-dev.example.com',
  production: 'https://auth.example.com',
}
```

La variable `EVA_BUILD_ENV` controla qué valores se hornean:

```ts
define: {
  __EVA_AUTH_URL__: JSON.stringify(envUrls[env]),
  __EVA_ENV__: JSON.stringify(env),
}
```

Dentro del SDK, `config.ts` expone las constantes ya resueltas — no hay lectura de `process.env` en runtime.

---

## Scripts de build

| Script | Comando | Entorno horneado | URL horneada |
|--------|---------|------------------|--------------|
| `pnpm build:local` | `cross-env EVA_BUILD_ENV=local tsdown` | `local` | `http://localhost:4000` |
| `pnpm build:dev` | `cross-env EVA_BUILD_ENV=development tsdown` | `development` | `https://auth-dev.example.com` |
| `pnpm build:prod` | `cross-env EVA_BUILD_ENV=production tsdown` | `production` | `https://auth.example.com` |
| `pnpm pack:local` | `build:local` + `pnpm pack` | `local` | `http://localhost:4000` |

`pnpm build` (sin sufijo) usa `production` por defecto.

---

## Cómo consume el SDK el usuario final

### Producción

```bash
npm install @eva_solutions/auth-sdk
```

El paquete publicado en npm se construye con `build:prod` — trae las constantes de producción horneadas.

### Desarrollo local

```bash
# En el repo del SDK
pnpm pack:local
# Genera eva-auth-sdk-x.x.x.tgz

# En el proyecto consumidor
npm install ../path/to/eva-auth-sdk-x.x.x.tgz
```

### En código

No hay paso de inicialización obligatorio. El middleware y las rutas funcionan directamente:

```ts
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

app.route('/auth', evaAuthRoutes())
app.use('/api/*', evaAuth())
```

Sin parámetros, sin env vars, sin configuración. Todo viene horneado.

#### Uso avanzado: acceso directo al client

Si necesitás hacer llamadas directas al Auth Service (fuera del middleware), podés obtener el HTTP client:

```ts
import { createEvaAuth } from '@eva_solutions/auth-sdk'

const { client } = createEvaAuth()
const result = await client.refresh({ refreshToken })
```

Esto es opcional — el flujo normal no lo requiere.

---

## Cookies, JWKS Cache y seguridad

→ Ver [security.md](security.md) para configuración completa de cookies (flags, TTLs, Secure por entorno), JWKS cache y modelo de seguridad.

---

## Auth routes prefix

El sub-router se monta con un prefijo fijo. El estándar es `/auth`:

```ts
app.route('/auth', evaAuthRoutes())
```

Todos los endpoints quedan bajo `/auth/*` (ej: `/auth/login`, `/auth/me`, `/auth/sessions`).

---

## Ejemplo: Setup con Hono

```ts
import { Hono } from 'hono'
import { evaAuth, evaAuthRoutes, getEvaPayload } from '@eva_solutions/auth-sdk/hono'

const app = new Hono()

// Montar rutas de auth (login, logout, me, etc.)
app.route('/auth', evaAuthRoutes())

// Proteger rutas de API con el middleware
app.use('/api/*', evaAuth())

app.get('/api/dashboard', (c) => {
  const { id, sessionId } = getEvaPayload(c)
  return c.json({ userId: id })
})

export default app
```

---

## Ejemplo: Setup con React

```tsx
import { EvaAuthProvider } from '@eva_solutions/auth-sdk/react'

function App() {
  return (
    <EvaAuthProvider
      basePath="/auth"
      apiUrl="https://api.your-app.com"
      onAuthChange={(auth) => console.log('Auth:', auth)}
    >
      <MyApp />
    </EvaAuthProvider>
  )
}
```

El `basePath` debe coincidir con el prefijo donde se montó `evaAuthRoutes()` en el backend.

El `apiUrl` es opcional: si se proporciona, se antepone a `basePath`. Útil cuando el frontend se comunica con un backend en otro dominio.

---

## Mensajes de error personalizados

El SDK expone todos los mensajes de error como strings i18n-friendly. Podés sobreescribirlos globalmente (para toda la app) o localmente (por llamada).

### Override global — `configureEvaAuth`

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'

configureEvaAuth({
  errorMessages: {
    authRequired: 'Authentication required',
    tokenExpired: 'Your session has expired — please log in again',
    tokenNotFound: 'No auth token found',
  },
})
```

Cualquier key no provista cae al default en español. El override es `Partial<EvaErrorMessages>`.

### Override local — por llamada

Cada función que puede retornar un error acepta `errorMessages` como opción local. El local pisa al global, que pisa al default.

**Middleware `evaAuth`:**
```ts
import { evaAuth } from '@eva_solutions/auth-sdk/hono'

app.use('/api/*', evaAuth({
  errorMessages: { authRequired: 'Por favor iniciá sesión' },
}))
```

**Rutas `evaAuthRoutes`:**
```ts
import { evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

app.route('/auth', evaAuthRoutes({
  errorMessages: { loginFailed: 'Credenciales incorrectas' },
}))
```

**`verifyRequest` (generic):**
```ts
import { verifyRequest } from '@eva_solutions/auth-sdk/generic'

const result = await verifyRequest(req, {
  errorMessages: { tokenInvalid: 'Token inválido — renovar sesión' },
})
```

### Precedencia

```
local (por llamada) > global (configureEvaAuth) > defaults en español
```

### Todas las keys disponibles

<!-- Defaults sincronizados con src/error-messages.ts. Si modificás los defaults, actualizá esta tabla. -->

| Key | Default (español) |
|-----|-------------------|
| `authRequired` | `Autenticación requerida` |
| `tokenInvalid` | `Tokens no válidos` |
| `tokenExpired` | `Token expirado` |
| `tokenClaimsInvalid` | `Claims del token inválidas` |
| `tokenNotFound` | `Token de acceso no encontrado` |
| `verifyFailedAfterRefresh` | `Verificación fallida tras refresh: {0}` |
| `refreshNoNewTokens` | `El refresco no retornó nuevos tokens` |
| `refreshFailed` | `Falló el refresco de tokens` |
| `loginFailed` | `Teléfono o código inválido` |
| `registrationFailed` | `Registro fallido` |
| `logoutFailed` | `Logout fallido` |
| `invalidJsonBody` | `JSON inválido en el body` |
| `invalidPhone` | `Teléfono inválido` |
| `invalidUpdateBody` | `Cuerpo de actualización vacío` |
| `sessionInvalid` | `ID de sesión inválido` |
| `internalError` | `Error interno` |

El placeholder `{0}` en `verifyFailedAfterRefresh` es reemplazado en runtime con el mensaje del error de verificación.

### Validación Zod

`configureEvaAuth` valida la entrada con Zod antes de almacenarla. Keys desconocidas o valores no-string lanzan inmediatamente con mensaje descriptivo:

```ts
configureEvaAuth({ errorMessages: { unknownKey: 'x' } })
// → Error: [eva-auth-sdk] errorMessages inválido: unknownKey: Unrecognized key(s)
```

Ver [ADR-012](decisions.md#adr-012-sistema-i18n-de-mensajes-de-error) para el razonamiento completo.

---

## Variante OpenAPI

El SDK ofrece una variante de las rutas de auth compatible con **OpenAPI 3.1** a través del entry point `@eva_solutions/auth-sdk/hono-openapi`. Retorna un `OpenAPIHono` con 11 endpoints documentados.

> **Importante**: `evaAuthOpenAPIRoutes()` retorna un `OpenAPIHono`. Para que la documentación se genere correctamente en `/doc`, el app padre también debe ser `OpenAPIHono`. Si se monta sobre un `Hono` plain, los handlers funcionan pero la ruta `/doc` no estará disponible.

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { evaAuthOpenAPIRoutes } from '@eva_solutions/auth-sdk/hono-openapi'

// El padre DEBE ser OpenAPIHono para que /doc funcione
const app = new OpenAPIHono()

app.route('/auth', evaAuthOpenAPIRoutes())

// La doc OpenAPI 3.1 queda disponible en /doc
app.get('/doc', (c) => c.json(app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'API', version: '1' } })))

export default app
```

### Generación del spec JSON

```ts
const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Eva Auth API', version: '1.0.0' },
})
// spec.paths incluye /auth/login, /auth/me, /auth/logout, etc.
```

### `evaAuthOpenAPIRoutes` — opciones

Acepta las mismas opciones que `evaAuthRoutes`:

```ts
app.route('/auth', evaAuthOpenAPIRoutes({
  errorMessages: { loginFailed: 'Credenciales inválidas' },
}))
```

### Instalación de la peer dependency

`@hono/zod-openapi` es una peer dependency opcional. Instalala en tu proyecto:

```bash
npm install @hono/zod-openapi
```

> **Nota pnpm**: si encontrás `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`, usá:
> ```bash
> pnpm add @hono/zod-openapi --prefer-offline
> ```

### Endpoints documentados

| Método | Path | Descripción |
|--------|------|-------------|
| `POST` | `/get-code` | Solicitar código de verificación |
| `POST` | `/login` | Login con teléfono y código |
| `POST` | `/refresh` | Rotar tokens via refresh cookie |
| `POST` | `/logout` | Cerrar sesión actual |
| `GET` | `/me` | Obtener datos del usuario autenticado |
| `PATCH` | `/me` | Actualizar perfil del usuario |
| `DELETE` | `/me` | Eliminar cuenta del usuario |
| `GET` | `/me/empresas` | Obtener empresas del usuario |
| `GET` | `/sessions` | Listar sesiones activas |
| `DELETE` | `/sessions/:sessionId` | Eliminar una sesión específica |
| `DELETE` | `/sessions` | Cerrar todas las sesiones |

Ver [ADR-012(g)](decisions.md#adr-012-sistema-i18n-de-mensajes-de-error) para el razonamiento del entry point separado.

---

## Combinar con middlewares custom

`evaAuth` es un middleware Hono estándar — se puede componer con cualquier otro middleware:

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { evaAuth, getEvaPayload } from '@eva_solutions/auth-sdk/hono'

const app = new Hono()

// Middleware global
app.use('*', logger())
app.use('/api/*', cors({ origin: 'https://app.miempresa.com', credentials: true }))

// evaAuth en rutas protegidas
app.use('/api/*', evaAuth())

// En handlers, acceder al payload via getEvaPayload
app.get('/api/profile', (c) => {
  const payload = getEvaPayload(c)
  return c.json({ userId: payload.id })
})
```

### Orden de middlewares

El orden de `app.use()` importa en Hono. `evaAuth` debe ir **antes** de los handlers que necesiten el payload:

```ts
// CORRECTO: evaAuth primero
app.use('/api/*', cors({ credentials: true }))
app.use('/api/*', evaAuth())
app.get('/api/data', handler)

// INCORRECTO: evaAuth después del handler — handler se ejecuta sin autenticar
app.get('/api/data', handler)
app.use('/api/*', evaAuth())
```

### Con rate limiting

```ts
import { rateLimiter } from 'some-rate-limit-middleware'

// Rate limit antes de auth (para proteger el endpoint de auth también)
app.use('/auth/*', rateLimiter({ limit: 10, windowMs: 60_000 }))
app.route('/auth', evaAuthRoutes())

// Rate limit solo en rutas autenticadas
app.use('/api/*', evaAuth())
app.use('/api/*', rateLimiter({ limit: 100, windowMs: 60_000 }))
```

---

## Mock para tests

Al testear handlers o middlewares que usan el SDK, es preferible mockear los módulos internos del SDK en vez de levantar un Auth Service real.

### Patrón recomendado (Vitest)

```ts
import { vi } from 'vitest'

// 1. Mock de config — evita dependencia de variables de entorno
vi.mock('@eva_solutions/auth-sdk/src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => 'production' as const,
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
  getErrorMessages: vi.fn().mockReturnValue(undefined),
  validateErrorMessagesInput: vi.fn().mockImplementation((x: unknown) => x),
}))

// 2. Mock de cookies — control total sobre qué tokens "existen"
vi.mock('@eva_solutions/auth-sdk/src/cookies', () => ({
  readTokensFromCookies: vi.fn(),
  setTokenCookies: vi.fn().mockReturnValue(['access=tok; Path=/; HttpOnly']),
  clearTokenCookies: vi.fn().mockReturnValue(['access=; Max-Age=0']),
}))

// 3. Mock del HTTP client — simular respuestas del Auth Service
const mockLogin = vi.fn()
vi.mock('@eva_solutions/auth-sdk/src/http-client', () => ({
  createHttpClient: vi.fn().mockReturnValue({ login: mockLogin, /* ... */ }),
}))
```

### Simular tokens presentes/ausentes

```ts
import { readTokensFromCookies } from '@eva_solutions/auth-sdk/src/cookies'

// Token presente
vi.mocked(readTokensFromCookies).mockReturnValue({ accessToken: 'valid-token' } as any)

// Sin tokens (→ 401)
vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

// Solo refresh (→ trigger de refresh automático)
vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'refresh-tok' } as any)
```

### Testear errorMessages override

```ts
const customApp = evaAuthRoutes({ errorMessages: { tokenNotFound: 'No token' } })
const res = await customApp.request('/me')
expect(res.status).toBe(401)
expect(await res.json()).toEqual({ error: 'No token' })
```

Ver los tests en `tests/hono-auth-routes.mock.test.ts` y `tests/generic-verify.mock.test.ts` para ejemplos completos.

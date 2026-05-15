<p align="center">
  <h1 align="center">🔐 @eva/auth-sdk</h1>
  <p align="center">SDK de autenticación end-to-end para el Proyecto Global</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/jose-v6-purple?logo=jsonwebtokens&logoColor=white" alt="jose" />
  <img src="https://img.shields.io/badge/ES256-ECDSA_P--256-green" alt="ES256" />
  <img src="https://img.shields.io/badge/Hono-≥4-orange?logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/React-≥18-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Edge_+_Node.js-ready-brightgreen" alt="Edge + Node.js" />
  <img src="https://img.shields.io/badge/version-1.0.0-informational" alt="version" />
</p>

---

SDK TypeScript que resuelve autenticación **completa** entre frontend (React) y backend (Hono) contra el Auth Service del Proyecto Global. Gestiona login OTP, sesiones, refresh automático de tokens, cookies HttpOnly y verificación JWT — **sin que el consumidor configure nada**.

```
React (browser) ←── cookies HttpOnly ──→ Hono (tu backend + SDK) ←── headers custom ──→ Auth Service
```

---

## 📑 Tabla de contenidos

- [✨ Características](#-características)
- [⚡ Quick Start](#-quick-start)
- [📦 Instalación](#-instalación)
- [🧩 Entry Points](#-entry-points)
- [Breaking changes en 1.0.0](#breaking-changes-en-100)
- [🔍 Error handling](#-error-handling)
- [🏗️ Arquitectura](#️-arquitectura)
- [🔧 Configuración](#-configuración)
- [🖥️ Backend: Hono](#️-backend-hono)
- [🌐 Backend: Generic](#-backend-generic)
- [⚛️ Frontend: React](#️-frontend-react)
- [📚 API Reference](#-api-reference)
- [🛡️ Seguridad](#️-seguridad)
- [📐 Convenciones](#-convenciones)
- [🧪 Testing](#-testing)
- [🔨 Scripts](#-scripts)
- [📝 Decisiones técnicas](#-decisiones-técnicas)
- [🗂️ Estructura del proyecto](#️-estructura-del-proyecto)
- [🤝 Desarrollo local](#-desarrollo-local)
- [📄 Licencia](#-licencia)

---

## ✨ Características

| Feature | Descripción |
|---------|-------------|
| 🔑 **Login OTP** | Flujo completo de autenticación con código OTP por teléfono |
| 🍪 **Cookies HttpOnly** | Tokens almacenados en cookies seguras, nunca expuestos a JavaScript |
| 🔄 **Auto-refresh** | Tokens se renuevan automáticamente cuando expiran, transparente al usuario |
| 🛡️ **JWT ES256** | Verificación local con ECDSA P-256 via `jose` v6 |
| 📡 **JWKS con cache** | Public key cacheada 24h con ETag/304 y hard max TTL de 25h |
| 🚀 **Zero-config o runtime** | URL y entorno horneados en build-time (fallback). Override via `configureEvaAuth()` o `EVA_AUTH_URL` env |
| ⚡ **Edge + Node.js** | Compatible con cualquier runtime (Cloudflare Workers, Vercel Edge, Node.js) |
| 🧩 **8 entry points** | Core, Hono, React, Generic, OpenAPI, Webhooks, Admin, S2S — importá solo lo que necesites |
| 🔒 **Dedup de refresh** | Requests concurrentes con token expirado comparten un solo refresh |
| 📱 **Device info** | Parsing de User-Agent server-side con bowser |
| 🏢 **Gestión completa** | Usuarios, sesiones, empresas — todo resuelto |
| ✅ **Result Pattern** | Errores como valores, nunca excepciones para flujos de negocio |

---

## ⚡ Quick Start

### Backend (Hono) — 3 líneas

```ts
import { Hono } from 'hono'
import { evaAuth, evaAuthRoutes } from '@eva/auth-sdk/hono'

const app = new Hono()

app.route('/auth', evaAuthRoutes())  // Rutas de auth listas
app.use('/api/*', evaAuth())         // Proteger rutas

app.get('/api/saludo', (c) => c.json({ msg: 'Estás autenticado' }))
```

### Backend (Hono) — con claims extra tipados

Si el JWT del Auth Service incluye claims adicionales (`phone`, `empresaId`, `role`, etc.), puedes acceder a ellos de forma tipada con validación runtime:

```ts
import { z } from 'zod'
import { Hono } from 'hono'
import { evaAuth } from '@eva/auth-sdk/hono'

// 1. Definir schema de los claims extra que esperas
const myClaims = z.object({
  phone: z.string(),
  empresaId: z.string().uuid(),
})

// 2. Pasar el schema a evaAuth — TExtra se infiere automáticamente
const auth = evaAuth({ extraClaimsSchema: myClaims })

const app = new Hono()
app.use('/api/*', auth)

app.get('/api/me', (c) => {
  // c.var.evaPayload: EvaTokenPayload<{ phone: string; empresaId: string }>
  const { id, sessionId, phone, empresaId } = c.var.evaPayload
  return c.json({ id, phone, empresaId })
  // Si el JWT no trae phone o empresaId con los tipos correctos → 401 automático
})
```

Sin `extraClaimsSchema`, el payload es solo `{ id, sessionId }` (comportamiento predeterminado — los claims extra del JWT se descartan por seguridad).

### Frontend (React)

```tsx
import { EvaAuthProvider, useAuth, useUser } from '@eva/auth-sdk/react'

function App() {
  return (
    <EvaAuthProvider basePath="/auth">
      <Home />
    </EvaAuthProvider>
  )
}

function Home() {
  const { isAuthenticated, isLoading, login, logout } = useAuth()
  const { data: user } = useUser()

  if (isLoading) return <p>Cargando...</p>
  if (!isAuthenticated) return <button onClick={() => login.getCode('+51999999999')}>Login</button>

  return (
    <div>
      <p>Hola, {user?.name}</p>
      <button onClick={logout}>Cerrar sesión</button>
    </div>
  )
}
```

---

## 📦 Instalación

```bash
pnpm add @eva/auth-sdk
```

Peer dependencies opcionales según lo que uses:

```bash
pnpm add hono    # si usas @eva/auth-sdk/hono
pnpm add react   # si usas @eva/auth-sdk/react
```

---

## 🧩 Entry Points

El SDK expone 8 entry points independientes. Importá solo lo que necesites — el tree-shaking se encarga del resto.

| Import | Contenido | Peer requerido |
|--------|-----------|----------------|
| `@eva/auth-sdk` | Core: client factory, tipos, constantes, JWT, JWKS, error system | — |
| `@eva/auth-sdk/hono` | Middleware `evaAuth()`, rutas `evaAuthRoutes()`, helpers, cookies, headers | `hono >=4` |
| `@eva/auth-sdk/react` | `EvaAuthProvider`, hooks (`useAuth`, `useUser`, etc.), `authFetch`, cookies | `react >=18` |
| `@eva/auth-sdk/generic` | `verifyRequest()`, `setTokenCookies()`, `clearTokenCookies()`, cookies, headers | — |
| `@eva/auth-sdk/hono-openapi` | `evaAuthOpenAPIRoutes()` — variante OpenAPI 3.1 con `/doc` integrado | `hono >=4`, `@hono/zod-openapi >=1.3.0` |
| `@eva/auth-sdk/webhooks` | `verifyWebhookSignature()`, `EVENT_CODES`, tipos de webhook | — |
| `@eva/auth-sdk/admin` | `createAdminClient()` — gestión de service clients y restauración de usuarios | — |
| `@eva/auth-sdk/s2s` | `createS2SClient()` — llamadas internas con firma HMAC S2S automática | — |

---

## Breaking changes en 1.0.0

> Si venís de 0.x, revisá la [Migration Guide completa](docs/migration.md).

Los cambios más impactantes son:

**1. `Result<T>.error` ahora es `EvaError` (no `string`)**

```typescript
// Antes (0.x):
if (!result.ok) return c.text(result.error, result.status)

// Después (1.0.0) — opción mínima:
import { getMessage } from '@eva/auth-sdk'
if (!result.ok) return c.text(getMessage(result.error), result.error.status)

// Después (1.0.0) — con narrowing completo:
if (!result.ok) {
  if (result.error.kind === 'api') {
    // result.error.code disponible — comparar con ERROR_CODES
  } else {
    // result.error.reason disponible — enum cerrado SdkErrorReason
  }
}
```

**2. Wire HTTP del SDK cambia a shape del API (default)**

Los handlers Hono ahora emiten `{ "error": { "code": "...", "message": "..." } }` por defecto.
Para mantener el shape legacy: `configureEvaAuth({ errorWire: 'string' })`.

**3. `EvaAuthError` eliminado**

`EvaAuthError`, `createAuthError`, `isAuthError` no existen en 1.0.0.

---

## 🔍 Error handling

El SDK exporta helpers semánticos para inspeccionar errores **sin conocer los internals**. El consumidor no debe inspeccionar `err.kind` ni comparar contra `ERROR_CODES` directamente — use los helpers exportados.

### Tipos de error

| Tipo | Discriminante | Campos clave |
|------|---------------|--------------|
| `EvaApiError` | `kind: 'api'` | `code: ErrorCode`, `message: string`, `status: number` |
| `EvaSdkError` | `kind: 'sdk'` | `reason: SdkErrorReason`, `message: string`, `status: number` |
| `EvaError` | — | `EvaApiError \| EvaSdkError` (discriminated union) |

### Helpers disponibles

```ts
import {
  // Branch guards
  isApiError, isSdkError,
  // Generic matchers
  matchError, matchSdkReason,
  // API shortcuts (12)
  isNotFound, isUnauthorized, isForbidden, isConflict,
  isValidationError, isRateLimited, isGone, isUnprocessableEntity,
  isBadRequest, isInternalError, isServiceUnavailable, isAccountStateLocked,
  // SDK shortcuts (6)
  isNetworkError, isTokenInvalid, isAuthRequired,
  isRefreshNoTokens, isVerifyFailed, isMalformed,
} from '@eva/auth-sdk'
```

### Uso con shortcut (`isNotFound`)

```ts
import { isNotFound } from '@eva/auth-sdk'

const r = await client.getUser(id)
if (!r.ok && isNotFound(r.error)) {
  // user no existe — soft-delete local
}
```

### Uso con matcher genérico (`matchError`)

Útil para feature-specific codes (como los del módulo admin) que no tienen shortcut propio:

```ts
import { matchError, ERROR_CODES } from '@eva/auth-sdk'

if (!r.ok && matchError(r.error, ERROR_CODES.conflict)) {
  // recurso en conflicto
}

// También funciona con codes feature-specific (ErrorCode es semiabierto)
if (!r.ok && matchError(r.error, 'service_client_already_exists')) {
  // lógica específica del admin
}
```

### Uso con error de red (`isNetworkError`)

```ts
import { isNetworkError } from '@eva/auth-sdk'

if (!r.ok && isNetworkError(r.error)) {
  // fallo transitorio — reintentar con backoff
}
```

> **Nota**: El consumidor NO debe inspeccionar `err.kind` ni comparar contra `ERROR_CODES` directamente. Use los helpers exportados — proveen narrowing TS automático y aíslan al consumidor de los internals del SDK.

---

## 🏗️ Arquitectura

### Modelo de dos capas

El SDK actúa como intermediario entre dos capas de transporte completamente distintas:

```
┌──────────┐     cookies HttpOnly      ┌──────────────────┐    headers custom     ┌──────────────┐
│  React   │ ◄────────────────────────► │  Hono + SDK      │ ◄──────────────────► │ Auth Service │
│ (browser)│   (automático, seguro)     │  (tu backend)    │  x-eva-refresh-token │ (externo)    │
└──────────┘                            └──────────────────┘  authorization: Bearer└──────────────┘
```

**Capa 1 — Frontend ↔ Backend** (cookies HttpOnly):

| Cookie | Contenido | Flags |
|--------|-----------|-------|
| `eva_access_token` | JWT ES256 | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `eva_refresh_token` | `session_id:token` | HttpOnly, Secure, SameSite=Lax, Path=/ |

**Capa 2 — SDK ↔ Auth Service** (headers custom):

| Header | Dirección | Contenido |
|--------|-----------|-----------|
| `Authorization` | → Request | `Bearer {accessToken}` |
| `X-Eva-Refresh-Token` | → Request | `session_id:refreshToken` |
| `x-eva-new-access-token` | ← Response | Nuevo JWT (si rotado) |
| `x-eva-new-refresh-token` | ← Response | Nuevo refresh token (si rotado) |

### Flujo completo de autenticación

```
1. Frontend → POST /auth/login { phone, code }
2. SDK → POST /login al Auth Service (headers custom + device info)
3. Auth Service valida → responde con tokens en headers custom
4. SDK traduce headers → cookies HttpOnly en response al frontend
5. Browser almacena cookies automáticamente

6. Frontend → GET /api/datos (cookies viajan automáticas)
7. Middleware evaAuth() lee cookies → verifica JWT localmente (ES256)
8. JWT válido → inyecta payload en context → next()
9. JWT expirado → SDK usa refresh cookie → POST /login/refresh al Auth Service
10. Auth Service rota tokens → SDK actualiza cookies → next()
11. Frontend recibe response con cookies actualizadas (transparente)
```

### Lo que el consumidor NO hace

- ❌ No configura cookies
- ❌ No parsea tokens
- ❌ No gestiona refresh
- ❌ No configura CORS para tokens
- ❌ No conoce la URL del Auth Service
- ❌ No gestiona la public key
- ❌ No configura variables de entorno

> 📖 Documentación completa: [docs/architecture.md](docs/architecture.md)

---

## 🔧 Configuración

### Quick start con runtime config

El SDK soporta configuración en runtime: un mismo tarball puede apuntar a diferentes entornos sin rebuild.

```ts
// boot.ts — llamar antes del primer request
import { configureEvaAuth } from '@eva/auth-sdk'

configureEvaAuth({
  authUrl: process.env.EVA_AUTH_URL,        // URL del Auth Service (override programático)
  cookieDomain: process.env.COOKIE_DOMAIN, // ej: '.miempresa.com' para subdominios
})
```

Si no se llama `configureEvaAuth()`, el SDK usa las constantes horneadas en build-time (backward compatible).

### Mensajes de error personalizados

Para internacionalizar o adaptar los mensajes de error, pasá `errorMessages` a `configureEvaAuth` (global) o a cualquier función que pueda retornar errores (local):

```ts
// Global — afecta todo el SDK
configureEvaAuth({
  errorMessages: {
    authRequired: 'Authentication required',
    tokenExpired: 'Session expired — please log in again',
    tokenNotFound: 'No auth token provided',
  },
})
```

```ts
// Local — solo esta instancia del middleware
app.use('/api/*', evaAuth({
  errorMessages: { authRequired: 'Por favor iniciá sesión' },
}))

// Local — solo estas rutas
app.route('/auth', evaAuthRoutes({
  errorMessages: { loginFailed: 'Credenciales incorrectas' },
}))
```

Precedencia: **local > global > defaults en español**. Ver [docs/configuration.md](docs/configuration.md#mensajes-de-error-personalizados) para la tabla completa de keys.

### Variante OpenAPI

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { evaAuthOpenAPIRoutes } from '@eva/auth-sdk/hono-openapi'

// El padre DEBE ser OpenAPIHono para que /doc funcione
const app = new OpenAPIHono()
app.route('/auth', evaAuthOpenAPIRoutes())

// Spec OpenAPI 3.1 disponible en /doc
app.get('/doc', (c) => c.json(app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Eva Auth API', version: '1.0.0' },
})))
```

```bash
# Peer dependency requerida
npm install @hono/zod-openapi
```

### Acceso a cookies desde cualquier entry point

`readTokensFromCookies`, `COOKIES`, `COOKIE_MAX_AGE` y `HEADERS` se re-exportan desde los 4 entry points:

```ts
import { readTokensFromCookies, COOKIES, COOKIE_MAX_AGE, HEADERS } from '@eva/auth-sdk/hono'
import { readTokensFromCookies, COOKIES, COOKIE_MAX_AGE, HEADERS } from '@eva/auth-sdk/generic'
import { readTokensFromCookies, COOKIES, COOKIE_MAX_AGE } from '@eva/auth-sdk/react'
import { readTokensFromCookies } from '@eva/auth-sdk'
```

### Deployment con subdominios

Para compartir cookies de auth entre `app.miempresa.com` y `api.miempresa.com`:

```ts
// boot.ts del backend (Hono + SDK)
import { configureEvaAuth, createEvaAuth } from '@eva/auth-sdk'
import { evaAuth, evaAuthRoutes } from '@eva/auth-sdk/hono'
import { Hono } from 'hono'

// 1. Configurar al arrancar, antes de registrar rutas
configureEvaAuth({
  authUrl: process.env.EVA_AUTH_URL ?? 'https://auth.miempresa.com',
  cookieDomain: '.miempresa.com',   // punto leading = todos los subdominios
})

// 2. Montar rutas normalmente
const app = new Hono()
app.route('/auth', evaAuthRoutes())
app.use('/api/*', evaAuth())

export default app
```

Con esto:
- `POST /auth/login` → `Set-Cookie: eva_access_token=...; Domain=.miempresa.com; HttpOnly; ...`
- `POST /auth/logout` → `Set-Cookie: eva_access_token=; Domain=.miempresa.com; Max-Age=0; ...`
- La cookie es accesible desde `app.miempresa.com` y cualquier subdominio.

### Variables de entorno runtime

| Variable | Nivel de precedencia | Descripción |
|----------|----------------------|-------------|
| `configureEvaAuth({ authUrl })` | 1 (máxima) | Override programático — para Cloudflare Workers, tests |
| `process.env.EVA_AUTH_URL` | 2 | Variable de entorno en runtime (con guard para Edge runtimes sin `process`) |
| `__EVA_AUTH_URL__` (build-time) | 3 (fallback) | Constante horneada por tsup `define` |

Si `EVA_AUTH_URL` contiene un valor inválido (protocolo no soportado, URL mal formada), el SDK emite `console.warn` y cae al build-time fallback sin lanzar.

### Modelo build-time (zero-config para el consumidor)

Sigue siendo válido: si el consumidor NO llama `configureEvaAuth()`, el SDK usa las constantes horneadas.

```ts
// tsup.config.ts — map interno de URLs por entorno
const envUrls = {
  local: 'http://localhost:4000',
  development: 'https://auth-dev.example.com',
  production: 'https://auth.example.com',
}
```

| Variable de build | Propósito | Valores |
|-------------------|-----------|---------|
| `EVA_BUILD_ENV` | Selecciona entorno | `local` / `development` / `production` |
| `__EVA_AUTH_URL__` | URL del Auth Service (horneada) | Según `EVA_BUILD_ENV` |
| `__EVA_ENV__` | Entorno actual (horneado) | Según `EVA_BUILD_ENV` |

> 📖 Documentación completa: [docs/configuration.md](docs/configuration.md)

---

## 🖥️ Backend: Hono

### `evaAuth()` — Middleware de protección

Verifica access token → auto-refresh si expiró → inyecta payload en context → actualiza cookies.

```ts
import { evaAuth, getEvaPayload, getSessionId } from '@eva/auth-sdk/hono'

app.use('/api/*', evaAuth())

app.get('/api/profile', (c) => {
  const { id, sessionId } = getEvaPayload(c)
  return c.json({ userId: id, sessionId })
})
```

### `evaAuthRoutes()` — Rutas de auth completas

Sub-router Hono con todos los endpoints de autenticación:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/get-code` | Solicitar código OTP |
| `POST` | `/login` | Verificar código y obtener sesión |
| `POST` | `/refresh` | Refrescar tokens |
| `POST` | `/logout` | Cerrar sesión actual |
| `GET` | `/me` | Obtener usuario autenticado |
| `PATCH` | `/me` | Actualizar datos del usuario |
| `DELETE` | `/me` | Eliminar cuenta |
| `GET` | `/empresas` | Listar empresas del usuario |
| `GET` | `/sessions` | Listar sesiones activas |
| `DELETE` | `/sessions/:id` | Cerrar una sesión específica |
| `DELETE` | `/sessions` | Cerrar todas las sesiones |

```ts
app.route('/auth', evaAuthRoutes())
```

### Helpers

| Función | Retorna | Descripción |
|---------|---------|-------------|
| `getEvaPayload(c)` | `EvaTokenPayload` | Payload JWT del context |
| `getSessionId(c)` | `string` | ID de la sesión actual |
| `parseDeviceInfo(request)` | `DeviceInfo` | Parsea User-Agent (dispositivo, OS, browser) |

---

## 🌐 Backend: Generic

Para frameworks que no son Hono (Express, Fastify, etc.) — usa Web API estándar (`Request`).

### `verifyRequest(request)`

Verifica tokens desde un `Request` estándar. Hace refresh automático si el access token expiró.

```ts
import { verifyRequest } from '@eva/auth-sdk/generic'

const result = await verifyRequest(request)

if (!result.ok) {
  return new Response('No autorizado', { status: 401 })
}

const { payload, newCookies } = result.data
// payload.id, payload.sessionId
// newCookies: string[] | undefined (Set-Cookie headers si hubo refresh)
```

### `setTokenCookies(tokens)` / `clearTokenCookies()`

```ts
import { setTokenCookies, clearTokenCookies } from '@eva/auth-sdk/generic'

// Setear cookies después de un login/refresh exitoso
const setCookieHeaders = setTokenCookies({ accessToken, refreshToken })

// Limpiar cookies en logout
const clearHeaders = clearTokenCookies()
```

---

## ⚛️ Frontend: React

### `EvaAuthProvider`

Context provider que gestiona el estado de autenticación. Ejecuta silent refresh al montar.

```tsx
import { EvaAuthProvider } from '@eva/auth-sdk/react'

<EvaAuthProvider
  basePath="/auth"
  apiUrl="https://api.proyecto-global.com"
  onAuthChange={(auth) => console.log('Auth:', auth)}
>
  <App />
</EvaAuthProvider>
```

| Prop | Tipo | Requerido | Descripción |
|------|------|-----------|-------------|
| `children` | `ReactNode` | Sí | Componentes hijos |
| `basePath` | `string` | No | Prefijo de rutas auth (default: `/auth`) |
| `apiUrl` | `string` | No | URL base del backend (para cross-domain) |
| `onAuthChange` | `(auth) => void` | No | Callback ante cambios de estado |

### Hooks

#### `useAuth()`

```ts
const { isAuthenticated, isLoading, error, login, logout } = useAuth()

// Login OTP en dos pasos
await login.getCode(phone)
await login.verify(phone, code)

// Logout
await logout()
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `isAuthenticated` | `boolean` | Si hay sesión activa |
| `isLoading` | `boolean` | Operación en curso |
| `error` | `string \| null` | Último error |
| `login.getCode` | `(phone) => Promise` | Solicita código OTP |
| `login.verify` | `(phone, code) => Promise` | Verifica código |
| `logout` | `() => Promise` | Cierra sesión |

#### `useUser()` / `useSessions()` / `useEmpresas()`

```ts
const { data, isLoading, error } = useUser()      // EvaUser
const { data, isLoading, error } = useSessions()   // EvaSession[]
const { data, isLoading, error } = useEmpresas()    // EvaEmpresa[]
```

### `authFetch<T>(url, options?)`

Fetch wrapper con `credentials: 'include'`, `Content-Type: application/json` y timeout de 30s.

```ts
import { authFetch } from '@eva/auth-sdk/react'

const result = await authFetch<EvaUser>('/auth/me')
if (result.ok) console.log(result.data)
```

---

## 📚 API Reference

### Core (`@eva/auth-sdk`)

**Funciones:**

| Función | Retorna | Descripción |
|---------|---------|-------------|
| `createEvaAuth()` | `{ client }` | Acceso directo al HTTP client (uso avanzado) |
| `createHttpClient()` | `EvaHttpClient` | Cliente HTTP tipado contra Auth Service |
| `verifyAccessToken(token)` | `Promise<Result<EvaTokenPayload>>` | Verifica JWT localmente |
| `getPublicKey()` | `Promise<CryptoKey>` | Obtiene public key del JWKS (cacheada) |
| `fetchJwks()` | `Promise<void>` | Fuerza fetch del JWKS |
| `clearJwksCache()` | `void` | Limpia cache local del JWKS |
| `getMessage(err)` | `string` | Extrae el mensaje de un `EvaError` |
| `verifyWebhookSignature(params)` | `Promise<boolean>` | Verifica firma HMAC-SHA256 de webhook |
| `createAdminClient(config)` | `AdminClient` | Cliente para endpoints `/admin/*` |
| `createS2SClient(config)` | `S2SClient` | Cliente S2S con firma automática |

**Tipos exportados:**

| Tipo | Descripción |
|------|-------------|
| `EvaUser` | Datos del usuario autenticado |
| `EvaSession` | Sesión activa del usuario |
| `EvaEmpresa` | Empresa asociada al usuario |
| `EvaTokenPayload` | Claims del JWT: `{ id, sessionId }` |
| `Result<T>` | `{ ok: true, data: T } \| { ok: false, error: EvaError }` |
| `EvaApiError` | Error del API: `{ kind: 'api', code, message, status }` |
| `EvaSdkError` | Error del SDK: `{ kind: 'sdk', reason, message, status }` |
| `EvaError` | `EvaApiError \| EvaSdkError` — discriminated union |
| `CoreErrorCode` | Unión cerrada de 12 codes core del API |
| `ErrorCode` | `CoreErrorCode \| (string & {})` — abierto para feature codes |
| `SdkErrorReason` | Enum cerrado de 6 reasons del SDK |
| `TokenPair` | Par de access + refresh token |
| `DeviceInfo` | Info parseada del User-Agent |
| `ActivityState` | `'activo' \| 'ausente' \| 'ocupado' \| 'desconectado'` |
| `PrivacyState` | `'publico' \| 'amigos' \| 'invisible'` |

**Constantes:**

| Constante | Contenido |
|-----------|-----------|
| `HEADERS` | Nombres de headers custom del protocolo Eva |
| `COOKIES` | Nombres de cookies (`eva_access_token`, `eva_refresh_token`) |
| `COOKIE_MAX_AGE` | TTL de cookies (access: 900s, refresh: 2592000s) |
| `JWT_CONFIG` | Configuración de verificación (issuer, audience, algorithms) |
| `ERROR_CODES` | 12 error codes core del Auth Service |
| `SDK_ERROR_REASONS` | 6 reasons internos del SDK |
| `EVENT_CODES` | 11 event codes de webhooks del Auth Service |

> 📖 Referencia completa con ejemplos: [docs/api.md](docs/api.md)

---

## 🛡️ Seguridad

### Cookies

| Cookie | Max-Age | HttpOnly | Secure | SameSite | Path |
|--------|---------|----------|--------|----------|------|
| `eva_access_token` | 900 (15 min) | ✅ | ✅* | Lax | `/` |
| `eva_refresh_token` | 2592000 (30 días) | ✅ | ✅* | Lax | `/` |

> \* `Secure=false` solo en `EVA_BUILD_ENV=local`. En `development` y `production` → `Secure=true`.

### JWT Verification

- **Algoritmo**: ES256 (ECDSA P-256)
- **Claims validados**: `iss=auth-service`, `aud=proyecto-global`, `exp`, `nbf`
- **Verificación**: local con public key del JWKS — sin llamada al Auth Service

### JWKS Cache

| Parámetro | Valor |
|-----------|-------|
| Cache TTL | 24 horas |
| Max TTL (grace period) | 25 horas |
| Revalidación | ETag / HTTP 304 |

Después de 25h sin actualización exitosa → **verificación rechazada**. No se usa key potencialmente revocada.

### Deduplicación de requests

- **Token refresh**: `Map<string, Promise>` keyed por refresh token. Requests concurrentes comparten un solo refresh.
- **JWKS fetch**: variable `pendingFetch` a nivel de módulo. Múltiples verificaciones simultáneas → solo un fetch.

### Timeouts

| Operación | Timeout |
|-----------|---------|
| HTTP Client (Auth Service) | 10 segundos |
| JWKS fetch | 5 segundos |
| `authFetch` (React) | 30 segundos |

### Validación de input

- JSON parsing con error diferenciado antes de validación Zod
- `phone` y `code`: validación de tipo y formato
- User-Agent truncado a 500 caracteres
- Safe status cast con `Set` de status codes HTTP conocidos

> 📖 Documentación completa: [docs/security.md](docs/security.md)

---

## 📐 Convenciones

| Aspecto | Regla |
|---------|-------|
| **Paradigma** | Funcional puro — objetos + funciones, **sin clases** |
| **Errores** | Result Pattern (`Result<T>`). Nunca `throw` para flujos de negocio |
| **Naming exports** | Inglés (`getUser`, `EvaUser`) |
| **Archivos** | kebab-case (`auth-routes.ts`) |
| **Funciones** | camelCase (`verifyAccessToken`) |
| **Types** | PascalCase (`EvaTokenPayload`) |
| **Constantes** | UPPER_SNAKE (`COOKIE_MAX_AGE`) |
| **Imports** | Siempre desde barrel files, nunca archivos internos |
| **Tests** | Un archivo `.mock.test.ts` por módulo |

> 📖 Guía completa: [docs/conventions.md](docs/conventions.md)

---

## 🧪 Testing

```bash
pnpm test           # Vitest en modo watch
pnpm test:run       # Vitest single run
pnpm test:types     # Vitest typecheck (*.test-d.ts)
```

**Estructura de tests:**

```
tests/
├── client.mock.test.ts
├── configure-eva-auth.mock.test.ts
├── cookies.mock.test.ts
├── generic-verify.mock.test.ts
├── hono-auth-routes.mock.test.ts
├── hono-middleware.mock.test.ts
├── jwks.mock.test.ts
├── jwt.mock.test.ts
├── reserved-claims.test.ts    # RFC 7519 + OIDC Core 1.0 compliance
├── types.test-d.ts            # Type tests con expectTypeOf
└── helpers/
    └── fixtures.ts
```

- Runner: **Vitest**
- Mocking: `vi.mock()`
- Type tests: `expect-type` con `vitest typecheck`
- Fixtures compartidas en `tests/helpers/fixtures.ts`

---

## 🔨 Scripts

| Script | Comando | Descripción |
|--------|---------|-------------|
| `pnpm build` | `tsup` | Build producción (default) |
| `pnpm build:local` | `cross-env EVA_BUILD_ENV=local tsup` | Build con URL local |
| `pnpm build:dev` | `cross-env EVA_BUILD_ENV=development tsup` | Build con URL development |
| `pnpm build:prod` | `cross-env EVA_BUILD_ENV=production tsup` | Build con URL producción |
| `pnpm dev` | `tsup --watch` | Build en modo watch |
| `pnpm test` | `vitest` | Tests en modo watch |
| `pnpm test:run` | `vitest run` | Tests single run |
| `pnpm test:types` | `vitest typecheck` | Type tests (`*.test-d.ts`) |
| `pnpm lint` | `oxlint .` | Linting con oxlint |
| `pnpm fmt` | `oxfmt --write src/` | Formateo con oxfmt |
| `pnpm type-check` | `tsc --noEmit` | Verificación de tipos |
| `pnpm pack:local` | `build:local` + `pnpm pack` | Genera `.tgz` para consumo local |

---

## 📝 Decisiones técnicas

| ADR | Decisión | Resumen |
|-----|----------|---------|
| ADR-001 | Error propagation transparente | Errores del Auth Service pasan sin sanitizar al frontend |
| ADR-002 | Cookie Secure en development | `Secure=true` en development (se espera HTTPS). Solo `local` lo desactiva |
| ADR-003 | Paradigma funcional | Funciones + objetos, sin clases. Result Pattern para errores |
| ADR-004 | Auto-refresh con dedup | `Map<string, Promise>` evita race conditions en refresh concurrentes |
| ADR-005 | JWKS cache con hard max TTL | 24h cache + 1h grace. Después de 25h → verificación rechazada |
| ADR-006 | Constantes build-time | URL y entorno horneados via `tsup define`. Fallback final — parcialmente reemplazado por ADR-010 |
| ADR-007 | Cookie Secure por build-time | Flag Secure decidido por `__EVA_ENV__`, no por `process.env` |
| ADR-008 | createEvaAuth() como extensión | Punto de entrada estable para acceso directo al client |
| ADR-009 | Cookie Domain runtime | `configureEvaAuth({ cookieDomain })` inyecta `Domain=` en cookies. Defensa anti-injection incluida |
| ADR-010 | Auth URL runtime override | Precedencia `configureEvaAuth > EVA_AUTH_URL env > build-time`. Whitelist `http/https`, invalidación JWKS |
| ADR-011 | Generic EvaTokenPayload + schema validation | `EvaTokenPayload<TExtra>` con `extraClaimsSchema` inline opcional. Sin schema → solo `{id, sessionId}`. Con schema → tipo TS + validación runtime end-to-end |
| ADR-012 | Sistema i18n de mensajes de error | 16 keys, precedencia local > global > default, `resolveErrorMessages`, Zod validation en config, `buildAuthHandlers` factory, entry point `/hono-openapi` separado, `createRoute` + double assertion para handlers genéricos |
| D-02 v3 | EvaError discriminated union | `Result<T>.error` cambia de `string` a `EvaApiError \| EvaSdkError`. Breaking change → bump 0.1.0 → 1.0.0 |
| D-07 | Catálogo ERROR_CODES — 12 entries | SDK replica el `as const` runtime del API (incluyendo `account_state_locked`) |
| D-08 | Dual type CoreErrorCode/ErrorCode | `ErrorCode = CoreErrorCode \| (string & {})` — autocomplete para 12 cores + apertura para feature-specific codes |
| D-13 v2 | errorWire configurable, default 'api' | SDK emite `{ error: { code, message } }` por default. Override `errorWire: 'string'` para compat 0.x |
| D-09 v2 | Hard delete src/errors.ts | Sin @deprecated. `EvaAuthError`, `createAuthError`, `isAuthError` eliminados directamente |

> 📖 Registro completo con contexto y justificación: [docs/decisions.md](docs/decisions.md)

---

## 🗂️ Estructura del proyecto

```
src/
├── index.ts               # Barrel — core exports
├── client.ts              # createEvaAuth()
├── config.ts              # Runtime config: authUrl, cookieDomain, errorMessages, errorWire
├── error-messages.ts      # EvaErrorMessages, DEFAULT_ERROR_MESSAGES, resolveErrorMessages
├── error-codes.ts         # ERROR_CODES (12), SDK_ERROR_REASONS (6), tipos CoreErrorCode/ErrorCode/SdkErrorReason
├── get-message.ts         # getMessage(err: EvaError): string
├── schemas.ts             # Schemas Zod + parseErrorResponse sync
├── auth-handlers.ts       # buildAuthHandlers() — factory de 11 handlers
├── types.ts               # EvaApiError, EvaSdkError, EvaError, Result<T>, tipos exportados
├── constants.ts           # HEADERS, COOKIES, JWT_CONFIG, COOKIE_MAX_AGE
├── refresh-dedup.ts       # Deduplicación de refresh (Map por refreshToken)
├── jwks-cache.ts          # JWKS cache con ETag/304
├── jwks.ts                # JWKS fetch, getPublicKey, clearJwksCache
├── jwt.ts                 # verifyAccessToken con jose
├── jwt-claims.ts          # assertSchemaNoReservedKeys, RESERVED_JWT_CLAIMS
├── cookies.ts             # Lectura/escritura de cookies HttpOnly
├── http-client.ts         # Cliente HTTP tipado contra Auth Service
│
├── hono/                  # Entry point: @eva/auth-sdk/hono
│   ├── index.ts           # Barrel
│   ├── middleware.ts      # evaAuth() middleware
│   ├── auth-routes.ts     # evaAuthRoutes() — delega a buildAuthHandlers
│   ├── device-info.ts     # parseDeviceInfo con bowser
│   └── helpers.ts         # getEvaPayload, getSessionId
│
├── hono-openapi/          # Entry point: @eva/auth-sdk/hono-openapi
│   └── index.ts           # evaAuthOpenAPIRoutes() — OpenAPIHono con 11 rutas documentadas
│
├── generic/               # Entry point: @eva/auth-sdk/generic
│   ├── index.ts           # Barrel
│   └── verify.ts          # verifyRequest (Web API Request)
│
├── webhooks/              # Entry point: @eva/auth-sdk/webhooks
│   ├── index.ts           # Barrel
│   ├── verify-signature.ts # verifyWebhookSignature (HMAC-SHA256)
│   ├── constants.ts       # WEBHOOK_TIMESTAMP_WINDOW_SECONDS, EVENT_CODES
│   └── types.ts           # WebhookPayload, WebhookSubscription, etc.
│
├── admin/                 # Entry point: @eva/auth-sdk/admin
│   ├── index.ts           # Barrel
│   ├── client.ts          # createAdminClient() factory
│   └── types.ts           # AdminClientConfig, ServiceClientPublic, etc.
│
├── s2s/                   # Entry point: @eva/auth-sdk/s2s
│   ├── index.ts           # Barrel
│   ├── client.ts          # createS2SClient() factory
│   ├── sign.ts            # buildS2SCanonicalString, signS2SRequest
│   ├── constants.ts       # S2S_TIMESTAMP_WINDOW_SECONDS
│   └── types.ts           # S2SClientConfig, S2SCanonicalParts, etc.
│
└── react/                 # Entry point: @eva/auth-sdk/react
    ├── index.ts           # Barrel
    ├── eva-auth-provider.tsx  # Context provider
    ├── use-auth.ts        # useAuth hook
    ├── use-user.ts        # useUser hook
    ├── use-sessions.ts    # useSessions hook
    ├── use-empresas.ts    # useEmpresas hook
    ├── use-auth-data.ts   # Hook base para data fetching
    └── auth-fetch.ts      # authFetch utility
```

---

## 🤝 Desarrollo local

### Setup

```bash
git clone <repo-url>
cd auth-sdk
pnpm install
```

### Workflow

```bash
pnpm dev           # Build en modo watch
pnpm test          # Tests en modo watch
pnpm type-check    # Verificar tipos
pnpm lint          # Linting
```

### Consumir localmente en otro proyecto

```bash
# En el repo del SDK
pnpm pack:local
# Genera eva-auth-sdk-1.0.0.tgz

# En el proyecto consumidor
pnpm add ../path/to/eva-auth-sdk-1.0.0.tgz
```

### Publicación

```bash
pnpm prepublishOnly  # type-check + tests + build:prod
npm publish
```

---

## 📖 Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/api.md](docs/api.md) | Referencia completa de API por entry point |
| [docs/architecture.md](docs/architecture.md) | Modelo de dos capas, flujo completo, estructura de módulos |
| [docs/configuration.md](docs/configuration.md) | Modelo build-time, scripts de build, setup, errorWire |
| [docs/conventions.md](docs/conventions.md) | Paradigma, naming, Result Pattern, barrel files |
| [docs/decisions.md](docs/decisions.md) | Registro de decisiones arquitectónicas (ADRs) |
| [docs/security.md](docs/security.md) | Cookies, JWT, JWKS cache, dedup, validación |
| [docs/migration.md](docs/migration.md) | Guía de migración 0.x → 1.0.0 (breaking changes, before/after) |

---

## 🔗 Stack técnico

| Dependencia | Versión | Propósito |
|-------------|---------|-----------|
| **TypeScript** | 5.8 | Tipado estricto |
| **jose** | 6.x | JWT verification y JWKS (ES256/ECDSA P-256) |
| **zod** | 4.x | Validación de input |
| **bowser** | 2.x | User-Agent parsing |
| **tsup** | 8.x | Build (ESM + CJS, declarations) |
| **vitest** | 3.x | Testing |
| **oxlint** | latest | Linting |
| **hono** | ≥4 (peer, opcional) | Integración backend |
| **react** | ≥18 (peer, opcional) | Integración frontend |

---

## 📄 Licencia

Uso interno — Proyecto Global.

# @eva/auth-sdk

![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)

SDK de autenticación end-to-end para el Proyecto Global. Maneja login OTP, sesiones, refresh automático de tokens, y gestión de cookies HttpOnly — todo listo para conectar frontend (React) con backend (Hono) y el Auth Service.

---

## TL;DR

- **Backend**: monta rutas de auth y middleware en Hono con 2 líneas.
- **Frontend**: envuelve tu app con `<EvaAuthProvider>` y usa hooks (`useAuth`, `useUser`, etc.).
- **Tokens**: el SDK maneja cookies HttpOnly, refresh automático y rotación — tu código nunca toca JWTs directamente.

---

## Instalación

```bash
pnpm add @eva/auth-sdk
```

Peers opcionales según lo que uses:

```bash
pnpm add hono    # si usas el entry point /hono
pnpm add react   # si usas el entry point /react
```

---

## Quick Start

### Backend (Hono)

```ts
import { Hono } from 'hono'
import { evaAuth, evaAuthRoutes } from '@eva/auth-sdk/hono'

const app = new Hono()

// Rutas públicas de auth: /auth/get-code, /auth/login, /auth/logout, etc.
app.route('/auth', evaAuthRoutes())

// Rutas protegidas
app.use('/api/*', evaAuth())

app.get('/api/saludo', (c) => c.json({ msg: 'Estás autenticado' }))

export default app
```

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
  const { user } = useUser()

  if (isLoading) return <p>Cargando...</p>
  if (!isAuthenticated) return <LoginForm login={login} />

  return (
    <div>
      <p>Hola, {user?.name}</p>
      <button onClick={logout}>Cerrar sesión</button>
    </div>
  )
}
```

---

## Arquitectura

El SDK actúa como intermediario entre dos capas de transporte distintas:

```
┌──────────┐     cookies HttpOnly      ┌──────────────────┐    headers custom     ┌──────────────┐
│  React   │ ◄────────────────────────► │  Hono + SDK      │ ◄──────────────────► │ Auth Service │
│ (browser)│   (automático, seguro)     │  (tu backend)    │  x-eva-refresh-token │ (externo)    │
└──────────┘                            └──────────────────┘  authorization: Bearer└──────────────┘
```

- **Frontend → Backend**: cookies HttpOnly (`eva_access_token`, `eva_refresh_token`). El browser las envía automáticamente. Tu código React nunca ve los tokens.
- **Backend → Auth Service**: headers custom (`authorization`, `x-eva-refresh-token`). El SDK los arma internamente.

---

## Entry Points

| Import | Contenido | Peer requerido |
|--------|-----------|----------------|
| `@eva/auth-sdk` | Client factory, tipos, constantes, JWT utils, error helpers | — |
| `@eva/auth-sdk/hono` | Middleware `evaAuth()`, `evaAuthRoutes()`, helpers | `hono >=4` |
| `@eva/auth-sdk/generic` | `verifyRequest()`, `handleTokenRotation()` para cualquier framework | — |
| `@eva/auth-sdk/react` | `EvaAuthProvider`, hooks de auth, `authFetch` | `react >=18` |

---

## Backend: Hono

### `evaAuth()` — Middleware

Verifica el access token de las cookies. Si expiró, intenta refresh automático. Si falla, retorna `401`.

```ts
import { evaAuth, getEvaPayload, getSessionId } from '@eva/auth-sdk/hono'

app.use('/api/*', evaAuth())

app.get('/api/profile', (c) => {
  const { id, sessionId } = getEvaPayload(c)
  return c.json({ userId: id, sessionId })
})
```

### `evaAuthRoutes()` — Rutas de auth

Monta un sub-app Hono con todas las rutas de autenticación:

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
| `getEvaPayload(c)` | `EvaTokenPayload` | Payload JWT del middleware |
| `getSessionId(c)` | `string` | ID de la sesión actual |
| `parseDeviceInfo(request)` | `DeviceInfo` | Parsea User-Agent (dispositivo, OS, browser) |

---

## Backend: Generic

Para frameworks que no son Hono (Express, Fastify, etc.):

### `verifyRequest(request: Request)`

Verifica tokens desde un `Request` estándar. Hace refresh automático si el access token expiró.

```ts
import { verifyRequest } from '@eva/auth-sdk/generic'

// En cualquier framework que te dé un Request
const result = await verifyRequest(request)

if (!result.ok) {
  return new Response('No autorizado', { status: 401 })
}

const { payload, newCookies } = result.data
// payload.id, payload.sessionId

// Si hubo refresh, setear las nuevas cookies
const response = new Response(JSON.stringify({ userId: payload.id }))
if (newCookies) {
  for (const cookie of newCookies) {
    response.headers.append('Set-Cookie', cookie)
  }
}
```

### `handleTokenRotation(tokens)` / `handleLogoutCookies()`

Helpers para generar headers `Set-Cookie`:

```ts
import { handleTokenRotation, handleLogoutCookies } from '@eva/auth-sdk/generic'

// Después de un refresh exitoso
const { setCookieHeaders } = handleTokenRotation(tokens)

// En logout
const { setCookieHeaders } = handleLogoutCookies()
```

---

## Frontend: React

### `<EvaAuthProvider>`

Envuelve tu app. Hace silent refresh al montar para verificar si hay sesión activa.

```tsx
<EvaAuthProvider basePath="/auth" onAuthChange={(auth) => console.log('Auth:', auth)}>
  {children}
</EvaAuthProvider>
```

| Prop | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `basePath` | `string` | `"/auth"` | Prefijo de las rutas de auth en tu backend |
| `onAuthChange` | `(auth: boolean) => void` | — | Callback cuando cambia el estado de autenticación |

### Hooks

#### `useAuth()`

```ts
const { isAuthenticated, isLoading, error, login, logout } = useAuth()

// Solicitar código
await login.getCode({ phone: '+51999999999' })

// Verificar código
const result = await login.verify({ phone: '+51999999999', code: '123456' })

// Cerrar sesión
await logout()
```

#### `useUser()`

```ts
const { user, isLoading, error, refetch } = useUser()
// user: EvaUser | null
```

#### `useSessions()`

```ts
const { sessions, isLoading, closeSession, closeAllOther, refetch } = useSessions()

await closeSession('session-id')
await closeAllOther()
```

#### `useEmpresas()`

```ts
const { empresas, isLoading, error, refetch } = useEmpresas()
// empresas: EvaEmpresa[] | null
```

### `authFetch`

Fetch wrapper que incluye `credentials: 'include'` y parsea la respuesta al tipo `Result<T>`:

```ts
import { authFetch } from '@eva/auth-sdk/react'

const result = await authFetch<{ items: Item[] }>('/api/items')
if (result.ok) console.log(result.data.items)
```

---

## HTTP Client directo (opcional)

Para comunicación directa server-to-server con el Auth Service (sin cookies, usando headers). Esto es **opcional** — el flujo normal usa `evaAuth()` y `evaAuthRoutes()` directamente.

```ts
import { createEvaAuth } from '@eva/auth-sdk'

const { client } = createEvaAuth()

// Todos los métodos del client retornan Result<T>
const result = await client.getUser({ accessToken: 'eyJ...' })
if (result.ok) console.log(result.data) // EvaUser

await client.getCode({ phone: '+51999999999' })
await client.login({ phone: '+51999999999', code: '123456', ...deviceInfo })
await client.refresh({ refreshToken: '...' })
await client.logout({ refreshToken: '...' })
await client.getSessions({ accessToken: '...' })
await client.getUserEmpresas({ accessToken: '...' })
await client.health()
```

---

## Tipos exportados

| Tipo | Descripción |
|------|-------------|
| `EvaUser` | Usuario: `id`, `phone`, `name`, `lastName`, `email`, `dni`, `stateActivity`, `statePrivacy`, `createdAt` |
| `EvaSession` | Sesión: `sessionId`, `deviceType`, `os`, `browser`, `ipAddress`, `createdAt`, `current` |
| `EvaEmpresa` | Empresa: `id`, `ruc`, `razonSocial`, `slug`, `direccion`, `celular`, `email`, `img` |
| `EvaTokenPayload` | Payload JWT: `id`, `sessionId` |
| `TokenPair` | `{ accessToken, refreshToken }` |
| `DeviceInfo` | `{ deviceType, os, browser, userAgent }` |
| `Result<T>` | `{ ok: true, data: T }` \| `{ ok: false, error: string, status: number }` |
| `EvaAuthError` | Error tipado del SDK |
| `ActivityState` | `'activo' \| 'ausente' \| 'ocupado' \| 'desconectado'` |
| `PrivacyState` | `'publico' \| 'amigos' \| 'invisible'` |
| `EvaHttpClient` | Tipo del client retornado por `createHttpClient()` |

---

## Configuración

El SDK **no requiere configuración por parte del consumidor**. Toda la configuración (URL del Auth Service y entorno) se hornea como constantes en el paquete al momento del build. Instalás la versión correcta y listo.

Ver [docs/configuration.md](docs/configuration.md) para detalles del modelo build-time.

### Constantes

```ts
import { HEADERS, COOKIES, COOKIE_MAX_AGE, JWT_CONFIG } from '@eva/auth-sdk'

COOKIES.ACCESS_TOKEN   // "eva_access_token"
COOKIES.REFRESH_TOKEN  // "eva_refresh_token"
COOKIE_MAX_AGE.ACCESS_TOKEN   // 900 (15 min)
COOKIE_MAX_AGE.REFRESH_TOKEN  // 2592000 (30 días)
JWT_CONFIG.ALGORITHM   // "ES256"
JWT_CONFIG.ISSUER      // "auth-service"
JWT_CONFIG.AUDIENCE    // "proyecto-global"
```

---

## Development

```bash
pnpm install        # instalar dependencias
pnpm build          # compilar con tsup
pnpm dev            # build en watch mode
pnpm test           # correr tests con vitest (watch)
pnpm test:run       # correr tests una vez
pnpm lint           # lint con oxlint
```

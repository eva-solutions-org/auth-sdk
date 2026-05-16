# Plan: @eva_solutions/auth-sdk

## TL;DR

SDK TypeScript que resuelve autenticación **end-to-end** para consumidores del EVA Auth Service. Dos capas de transporte:

```
React (frontend) ←── cookies HttpOnly ──→ Hono (backend + SDK) ←── headers custom ──→ Auth Service
```

El backend consumidor (Hono en Edge o Node) instala el SDK, monta el middleware, y su frontend React queda autenticado sin configurar nada. El SDK también provee hooks React opcionales para hacer la integración del lado del cliente trivial.

---

## Decisiones confirmadas

| Decisión | Valor |
|---|---|
| Registry | npm público `@eva_solutions/auth-sdk` |
| Scope | Completo (auth + user + sessions + empresas) |
| Exports | Inglés (`getUser`, `EvaUser`, etc.) |
| Module format | Dual ESM + CJS (primariamente ESM, `type: "module"`) |
| URL Auth service | Dentro del SDK, configurable internamente, NO por el consumidor |
| JWT verification | Local con ES256 via `jose` v6. Public key auto-fetch del JWKS |
| Runtime | Edge + Node.js |
| Stack consumidor típico | Backend: **Hono** (Edge/Node) como BFF. Frontend: **React** |
| Auth routes prefix | Fijo en `/auth` (no configurable) |
| Device info | Server-side parsing via `bowser` (User-Agent + Client Hints) |
| Cookie max-age | Alineado al TTL del token: access=15m, refresh=30d |
| Secure cookie | `Secure=false` solo si `NODE_ENV=local`. En `development` y `production` → `Secure=true` |
| Rate limit proxy | 429 del Auth Service pasa transparente al frontend |
| Versionamiento | Semver estricto. Breaking change en Auth Service = major bump |
| Paradigma | Funcional (objetos + funciones, sin clases) |

---

## Modelo de dos capas

### Capa 1: SDK ↔ Auth Service (headers custom)

Comunicación server-to-server entre el backend consumidor y el Auth service. Usa los headers custom del protocolo Eva:

| Header | Dirección | Contenido |
|---|---|---|
| `Authorization` | → Request | `Bearer {accessToken}` |
| `X-Eva-Refresh-Token` | → Request | `session_id:refreshToken` |
| `x-eva-new-access-token` | ← Response | Nuevo JWT (rotación) |
| `x-eva-new-refresh-token` | ← Response | Nuevo `session_id:token` |

### Capa 2: Frontend ↔ Backend consumidor (cookies HttpOnly)

El SDK gestiona las cookies automáticamente. El frontend no necesita saber nada sobre headers custom, JWKS, ni tokens — solo recibe/envía cookies transparentes.

| Cookie | Tipo | Propósito |
|---|---|---|
| `eva_access_token` | HttpOnly, Secure, SameSite=Lax, Path=/ | JWT ES256 (access token) |
| `eva_refresh_token` | HttpOnly, Secure, SameSite=Lax, Path=/ | `session_id:refreshToken` |

**Flujo completo:**

```
1. Frontend hace POST /login al backend consumidor
2. Backend (SDK client) → POST /login al Auth Service (headers custom)
3. Auth Service responde con tokens en headers custom
4. SDK traduce headers → cookies HttpOnly en la response al frontend
5. Frontend recibe cookies automáticamente (browser las gestiona)

6. Frontend hace GET /api/datos (cookies van automáticas)
7. SDK middleware lee cookies → verifica JWT localmente
8. JWT válido → inyecta user en contexto → next()
9. JWT expirado → SDK usa refresh cookie → POST /login/refresh al Auth Service
10. Auth Service rota tokens → SDK actualiza cookies en response → next()
11. Frontend recibe response + cookies actualizadas (transparente)
```

### Lo que el consumidor NO hace

- NO configura cookies
- NO parsea tokens
- NO gestiona refresh
- NO configura CORS para tokens (las cookies van automáticas)
- NO conoce la URL del Auth Service
- NO gestiona la public key

---

## JWT — Tipos exactos del Auth Service

```ts
// Payload verificado (lo que el SDK extrae y expone)
type TokenPayload = {
  id: string        // sub (userId)
  sessionId: string // UUID de la sesión
}

// Claims completos en el JWT:
// sub = userId, sessionId = UUID, jti = UUID único
// iss = "auth-service", aud = "proyecto-global"
// iat, exp, nbf (= iat)
// kid en header = JWK Thumbprint RFC 7638
// Algoritmo: ES256 (ECDSA P-256)
// Default TTL: 15m access, 30d refresh
```

### Verificación (jose v6)

```ts
jwtVerify(token, publicKey, {
  issuer: 'auth-service',
  audience: 'proyecto-global',
})
```

### JWKS

```
GET /.well-known/jwks.json
Content-Type: application/jwk-set+json
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "<kid>"  → soporta If-None-Match → 304

{ keys: [{ kty: "EC", crv: "P-256", x, y, kid, alg: "ES256", use: "sig" }] }
```

---

## Tipos exportados

```ts
// Enums
type ActivityState = 'activo' | 'ausente' | 'ocupado' | 'desconectado'
type PrivacyState = 'publico' | 'amigos' | 'invisible'

// User profile (GET /user response shape)
type EvaUser = {
  id: string
  phone: string
  name: string | null
  lastName: string | null
  email: string | null
  dni: string | null
  stateActivity: ActivityState
  statePrivacy: PrivacyState
  createdAt: string
}

// Session (GET /sessions response shape)
type EvaSession = {
  sessionId: string
  deviceType: string
  os: string
  browser: string
  ipAddress: string
  createdAt: string
  current: boolean
}

// Empresa (GET /user/empresas response shape)
type EvaEmpresa = {
  id: string
  ruc: string
  razonSocial: string
  slug: string
  direccion: string | null
  celular: string | null
  email: string | null
  img: string | null
}

// JWT payload decodificado
type EvaTokenPayload = {
  id: string        // userId (sub claim)
  sessionId: string // UUID sesión
}

// Error del Auth Service
type EvaAuthError = {
  error: string
  status: number
}

// Result pattern
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number }
```

---

## Response schemas por endpoint (verificados en código fuente)

| Endpoint | Response body | Tokens |
|---|---|---|
| `POST /login/get-code` | `{ data: { message } }` | — |
| `POST /login` | `{ data: { user: { id } } }` | Headers response |
| `POST /login/refresh` | `{ data: { user: { id } } }` | Headers response |
| `POST /login/logout` | `{ data: { message } }` | — |
| `GET /user` | `{ data: EvaUser }` | — |
| `PATCH /user` | `{ data: EvaUser }` | — |
| `DELETE /user` | `{ data: { message } }` | — |
| `GET /user/empresas` | `{ data: EvaEmpresa[] }` | — |
| `GET /sessions` | `{ data: EvaSession[] }` | — |
| `DELETE /sessions/{id}` | `{ data: { message } }` | — |
| `DELETE /sessions` | `{ data: { message, count } }` | — |
| `GET /health` | `{ status: 'ok' }` | — |
| `GET /.well-known/jwks.json` | `{ keys: [JWK] }` | — |

### Errores (formato siempre `{ error: string }`)

```
401: "Autenticación requerida"
401: "Token de refresco inválido o expirado"
401: "Credenciales inválidas, código incorrecto o expirado"
401: "Sesión revocada"
403: "Cuenta no activa"
404: "Sesión no encontrada"
409: "El email o DNI ya está en uso"
429: "Demasiadas solicitudes"
500: "Error interno del servidor"
```

---

## Estructura del SDK

```
Auth - SDK/
├── src/
│   ├── index.ts                    # Re-exports públicos del entry point principal
│   ├── client.ts                   # createEvaAuth() → instancia con client + cookie helpers
│   ├── types.ts                    # EvaUser, EvaSession, EvaEmpresa, EvaTokenPayload, enums, Result
│   ├── errors.ts                   # EvaAuthError
│   ├── constants.ts                # HEADERS, COOKIES, AUTH_SERVICE_URL, JWT issuer/audience
│   ├── jwks.ts                     # fetchJwks() con cache/ETag/304, getPublicKey()
│   ├── jwt.ts                      # verifyAccessToken(token) → EvaTokenPayload | error
│   ├── cookies.ts                  # readTokensFromCookies(), setTokenCookies(), clearTokenCookies()
│   ├── http-client.ts              # Llamadas tipadas al Auth Service (headers custom)
│   ├── hono/
│   │   ├── index.ts                # Re-exports del módulo Hono
│   │   ├── middleware.ts           # evaAuth() → middleware (cookies → JWT verify → auto-refresh → cookies)
│   │   ├── auth-routes.ts          # evaAuthRoutes() → sub-router completo (auth + user + sessions + empresas)
│   │   ├── device-info.ts          # parseDeviceInfo(request) → { deviceType, os, browser, userAgent }
│   │   └── helpers.ts              # getEvaUser(c), getEvaPayload(c), getSessionId(c)
│   ├── generic/
│   │   ├── index.ts                # Re-exports del módulo genérico
│   │   ├── verify.ts               # verifyRequest(request) → { payload, cookies? }
│   │   └── token-rotation.ts       # handleTokenRotation(response, newTokens) → response con cookies
│   └── react/
│       ├── index.ts                # Re-exports del módulo React
│       ├── eva-auth-provider.tsx   # Context provider con estado de auth
│       ├── use-auth.ts             # useAuth() → { login, logout, isAuthenticated, isLoading }
│       └── use-user.ts             # useUser() → { user, isLoading, error, refetch }
├── tests/
│   ├── setup.ts
│   ├── jwt.mock.test.ts
│   ├── jwks.mock.test.ts
│   ├── cookies.mock.test.ts
│   ├── client.mock.test.ts
│   ├── hono-middleware.mock.test.ts
│   ├── hono-auth-routes.mock.test.ts
│   └── helpers/
│       └── fixtures.ts             # Fixture factories
├── .oxlintrc.json
├── .oxfmtrc.jsonc
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── plan.md
└── README.md
```

---

## Entry points y exports map

| Entry point | Contenido | Ejemplo de import |
|---|---|---|
| `@eva_solutions/auth-sdk` | Client factory, types, errors, constantes | `import { createEvaAuth, type EvaUser } from '@eva_solutions/auth-sdk'` |
| `@eva_solutions/auth-sdk/hono` | Middleware + auth routes + helpers | `import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'` |
| `@eva_solutions/auth-sdk/react` | Provider + hooks para React | `import { EvaAuthProvider, useAuth } from '@eva_solutions/auth-sdk/react'` |
| `@eva_solutions/auth-sdk/generic` | Funciones para cualquier framework | `import { verifyRequest } from '@eva_solutions/auth-sdk/generic'` |

```jsonc
// package.json (parcial)
{
  "name": "@eva_solutions/auth-sdk",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./hono": {
      "import": "./dist/hono/index.js",
      "require": "./dist/hono/index.cjs",
      "types": "./dist/hono/index.d.ts"
    },
    "./generic": {
      "import": "./dist/generic/index.js",
      "require": "./dist/generic/index.cjs",
      "types": "./dist/generic/index.d.ts"
    },
    "./react": {
      "import": "./dist/react/index.js",
      "require": "./dist/react/index.cjs",
      "types": "./dist/react/index.d.ts"
    }
  },
  "peerDependencies": {
    "hono": ">=4.0.0",
    "react": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "hono": { "optional": true },
    "react": { "optional": true }
  },
  "dependencies": {
    "jose": "^6.0.0",
    "bowser": "^2.14.0"
  },
  "devDependencies": {
    "hono": "^4.12.0",
    "tsup": "^8.0.0",
    "typescript": "^6.0.0",
    "vitest": "^4.0.0",
    "oxlint": "latest",
    "oxfmt": "latest"
  }
}
```

---

## Módulo clave: cookies.ts

Gestiona la traducción entre las dos capas de transporte.

```ts
// Nombres de cookies (internos, no configurables por el consumidor)
const COOKIES = {
  ACCESS_TOKEN: 'eva_access_token',
  REFRESH_TOKEN: 'eva_refresh_token',
} as const

// Opciones de cookie (seguridad máxima por defecto)
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'local', // false solo en NODE_ENV=local
  sameSite: 'lax',    // Protección CSRF + permite navegación normal
  path: '/',
} as const

// Max-age alineado al TTL del token correspondiente
const COOKIE_MAX_AGE = {
  ACCESS_TOKEN: 15 * 60,          // 15 minutos (en segundos)
  REFRESH_TOKEN: 30 * 24 * 60 * 60, // 30 días (en segundos)
} as const

// readTokensFromCookies(request) → { accessToken?, refreshToken? }
// setTokenCookies(response, { accessToken, refreshToken }) → response con Set-Cookie
// clearTokenCookies(response) → response con cookies expiradas (logout)
```

---

## Middleware evaAuth() — flujo completo

```
Request del frontend llega al backend consumidor (cookies automáticas)
  │
  ├─ Lee cookie eva_access_token
  │   ├─ Verifica firma ES256 con public key (cacheada del JWKS)
  │   ├─ Valida iss="auth-service", aud="proyecto-global"
  │   ├─ JWT válido → extrae { id, sessionId } → c.set('evaUser', payload) → next()
  │   └─ JWT inválido/expirado → intenta refresh ↓
  │
  ├─ Lee cookie eva_refresh_token
  │   ├─ Llama POST /login/refresh al Auth Service con header X-Eva-Refresh-Token
  │   ├─ Auth Service valida y rota tokens
  │   ├─ SDK recibe nuevos tokens en headers de response del Auth Service
  │   ├─ SDK inyecta nuevas cookies en la response al frontend (Set-Cookie)
  │   ├─ Extrae payload del nuevo JWT → c.set('evaUser', payload) → next()
  │   └─ Refresh inválido → limpia cookies → 401
  │
  └─ Sin cookies → 401 { error: "Autenticación requerida" }
```

**Nota**: El SDK NO verifica sesión en DB. Solo verifica firma JWT localmente. La validación de sesión la hace el Auth Service cuando se llama a refresh.

---

## Auth routes pre-armadas: evaAuthRoutes()

El SDK provee un sub-router Hono listo para montar que resuelve los endpoints de auth que el frontend necesita. El backend consumidor solo hace:

```ts
import { evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

app.route('/auth', evaAuthRoutes())
```

Y el frontend obtiene automáticamente:

| Endpoint del consumidor | Qué hace el SDK por detrás | Response al frontend |
|---|---|---|
| `POST /auth/get-code` | Proxy → `POST /login/get-code` al Auth Service | `{ data: { message } }` |
| `POST /auth/login` | Proxy → `POST /login` al Auth Service → setea cookies | `{ data: { user: { id } } }` (cookies en Set-Cookie) |
| `POST /auth/refresh` | Lee refresh cookie → `POST /login/refresh` → rota cookies | `{ data: { user: { id } } }` (nuevas cookies) |
| `POST /auth/logout` | Lee refresh cookie → `POST /login/logout` → limpia cookies | `{ data: { message } }` (cookies borradas) |
| `GET /auth/me` | Lee access cookie → `GET /user` al Auth Service | `{ data: EvaUser }` |
| `PATCH /auth/me` | Lee access cookie → `PATCH /user` al Auth Service | `{ data: EvaUser }` |
| `DELETE /auth/me` | Lee tokens → `DELETE /user` al Auth Service → limpia cookies | `{ data: { message } }` |
| `GET /auth/empresas` | Lee access cookie → `GET /user/empresas` al Auth Service | `{ data: EvaEmpresa[] }` |
| `GET /auth/sessions` | Lee access cookie → `GET /sessions` al Auth Service | `{ data: EvaSession[] }` |
| `DELETE /auth/sessions/:id` | Lee access cookie → `DELETE /sessions/:id` al Auth Service | `{ data: { message } }` |
| `DELETE /auth/sessions` | Lee refresh cookie → `DELETE /sessions` al Auth Service → limpia cookies | `{ data: { message, count } }` |

**El frontend solo necesita hacer fetch a estos endpoints. Las cookies se gestionan solas.**

### Device info automático en login

El frontend solo envía `{ phone, code }`. La auth route `POST /auth/login` extrae device info automáticamente:

1. Lee `User-Agent` header de la request (siempre disponible)
2. Lee Client Hints si existen (`Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Mobile`)
3. Parsea con `bowser` (~4.8 kB, MIT, 0 deps, edge-compatible)
4. Mapea a los campos del Auth Service:

| Campo Auth Service | Fuente |
|---|---|
| `userAgent` | Raw `User-Agent` header (pass-through) |
| `browser` | `bowser.getBrowser().name` → "Chrome", "Firefox", etc. |
| `os` | `bowser.getOS().name` → "Windows", "macOS", "Android", etc. |
| `deviceType` | `bowser.getPlatform().type` → "desktop", "mobile", "tablet" |

Esto sigue el patrón de Auth0, Clerk y Firebase: server-side User-Agent parsing, zero client-side work.

### Ejemplo completo del consumidor

```ts
import { Hono } from 'hono'
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'
import { getEvaUser } from '@eva_solutions/auth-sdk/hono'

const app = new Hono()

// Auth routes para el frontend (login, logout, refresh, get-code)
app.route('/auth', evaAuthRoutes())

// Rutas protegidas — requieren usuario autenticado
app.use('/api/*', evaAuth())

app.get('/api/profile', (c) => {
  const user = getEvaUser(c) // { id, sessionId }
  return c.json({ userId: user.id })
})

export default app
```

**Zero config. 5 líneas para auth completo.**

---

## Módulo React: hooks para el frontend

El entry point `@eva_solutions/auth-sdk/react` exporta un provider y hooks que resuelven la integración del frontend con las auth routes del backend. Las cookies HttpOnly son invisibles para JS — los hooks gestionan el estado derivado de las respuestas del servidor.

### EvaAuthProvider

Wrappea la app y gestiona el estado global de autenticación.

```tsx
import { EvaAuthProvider } from '@eva_solutions/auth-sdk/react'

function App() {
  return (
    <EvaAuthProvider basePath="/auth">
      <Router />
    </EvaAuthProvider>
  )
}
```

**Props:**

| Prop | Tipo | Default | Descripción |
|---|---|---|---|
| `basePath` | `string` | `'/auth'` | Prefijo de las auth routes en el backend |
| `onAuthChange` | `(authenticated: boolean) => void` | — | Callback cuando cambia el estado de auth |

### useAuth()

Control del flujo de autenticación.

```tsx
const { login, logout, isAuthenticated, isLoading, error } = useAuth()

// Login con código OTP
await login.getCode({ phone: '+51999999999' })
await login.verify({ phone, code }) // deviceInfo se extrae server-side
// → cookies se setean automáticamente via Set-Cookie del backend

// Logout
await logout()
// → cookies se borran automáticamente
```

**Retorna:**

| Campo | Tipo | Descripción |
|---|---|---|
| `isAuthenticated` | `boolean` | Si hay sesión activa |
| `isLoading` | `boolean` | Estado de carga inicial (check de sesión) |
| `error` | `EvaAuthError \| null` | Error si el Auth Service está caído (después de retries) |
| `login.getCode` | `(params) => Promise<Result>` | Solicitar código OTP |
| `login.verify` | `(params) => Promise<Result>` | Verificar código y autenticar |
| `logout` | `() => Promise<Result>` | Cerrar sesión |

**Detección de sesión al mount:**
1. `useAuth` hace `POST /auth/refresh` silencioso al cargar la app
2. Si falla por error de red o Auth Service caído → retry (hasta 3 intentos con backoff exponencial)
3. Si después de retries sigue fallando → `isAuthenticated: false`, `error` con info del fallo ("servicio no disponible")
4. Si falla por 401 (refresh inválido) → `isAuthenticated: false`, sin error (sesión simplemente no existe)

### useUser()

Acceso al perfil del usuario autenticado.

```tsx
const { user, isLoading, error, refetch } = useUser()

if (isLoading) return <Skeleton />
if (!user) return <LoginScreen />

return <span>Hola, {user.name}</span>
```

**Retorna:**

| Campo | Tipo | Descripción |
|---|---|---|
| `user` | `EvaUser \| null` | Perfil del usuario o null |
| `isLoading` | `boolean` | Cargando perfil |
| `error` | `EvaAuthError \| null` | Error si falló |
| `refetch` | `() => Promise<void>` | Re-fetch manual del perfil |

### Ejemplo completo: React + Hono

**Backend (Hono):**
```ts
import { Hono } from 'hono'
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

const app = new Hono()
app.route('/auth', evaAuthRoutes())
app.use('/api/*', evaAuth())
```

**Frontend (React):**
```tsx
import { EvaAuthProvider, useAuth, useUser } from '@eva_solutions/auth-sdk/react'

function App() {
  return (
    <EvaAuthProvider>
      <AuthGate />
    </EvaAuthProvider>
  )
}

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <Loading />
  return isAuthenticated ? <Dashboard /> : <LoginPage />
}

function Dashboard() {
  const { user } = useUser()
  return <h1>Bienvenido, {user?.name}</h1>
}

function LoginPage() {
  const { login } = useAuth()
  const [step, setStep] = useState<'phone' | 'code'>('phone')

  const handleGetCode = async (phone: string) => {
    const result = await login.getCode({ phone })
    if (result.ok) setStep('code')
  }

  const handleVerify = async (phone: string, code: string) => {
    await login.verify({ phone, code })
    // deviceInfo se extrae server-side del User-Agent
  }

  // ... render
}
```

**Zero config en ambos lados. El SDK conecta backend y frontend automáticamente.**

### useSessions()

Gestión de sesiones activas del usuario.

```tsx
const { sessions, isLoading, error, refetch, closeSession, closeAllOther } = useSessions()
```

**Retorna:**

| Campo | Tipo | Descripción |
|---|---|---|
| `sessions` | `EvaSession[] \| null` | Lista de sesiones activas |
| `isLoading` | `boolean` | Cargando sesiones |
| `error` | `EvaAuthError \| null` | Error si falló |
| `refetch` | `() => Promise<void>` | Re-fetch manual |
| `closeSession` | `(sessionId: string) => Promise<Result>` | Cerrar una sesión específica |
| `closeAllOther` | `() => Promise<Result>` | Cerrar todas las sesiones excepto la actual |

### useEmpresas()

Acceso a las empresas del usuario autenticado.

```tsx
const { empresas, isLoading, error, refetch } = useEmpresas()
```

**Retorna:**

| Campo | Tipo | Descripción |
|---|---|---|
| `empresas` | `EvaEmpresa[] \| null` | Lista de empresas del usuario |
| `isLoading` | `boolean` | Cargando empresas |
| `error` | `EvaAuthError \| null` | Error si falló |
| `refetch` | `() => Promise<void>` | Re-fetch manual |

### Notas de implementación del módulo React

- **Sin dependencias extra**: solo `react` como peer dependency. Fetch nativo del browser
- **Cookies invisibles**: los hooks NO leen cookies (son HttpOnly). Derivan estado de las respuestas HTTP
- **Auto-refresh transparente**: si un request del backend rota tokens, las nuevas cookies llegan al browser automáticamente
- **`useAuth` detecta sesión al mount**: `POST /auth/refresh` silencioso → retry con backoff si falla → error visible si el servicio está caído
- **Todos los hooks de data** (`useUser`, `useSessions`, `useEmpresas`) dependen de `isAuthenticated` — no hacen fetch si no hay sesión

---

## HTTP Client tipado (para uso directo server-to-server)

Para casos donde el backend necesita llamar al Auth Service directamente (ej: background jobs, admin tasks):

```ts
import { createEvaAuth } from '@eva_solutions/auth-sdk'

const eva = createEvaAuth()

// Endpoints — cada uno retorna Result<T>
eva.client.getCode({ phone })
eva.client.login({ phone, code, deviceType, os, browser, userAgent })
eva.client.refresh({ refreshToken })
eva.client.logout({ refreshToken })
eva.client.getUser({ accessToken })
eva.client.updateUser({ accessToken, data })
eva.client.deleteUser({ accessToken })
eva.client.getUserEmpresas({ accessToken })
eva.client.getSessions({ accessToken })
eva.client.deleteSession({ accessToken, sessionId })
eva.client.deleteAllSessions({ refreshToken })
eva.client.health()
```

---

## Convenciones aplicadas

### De Obsidian (reglas personales)
- SOLID funcional sin clases, solo objetos y funciones
- Result Pattern: `{ ok: true, data }` | `{ ok: false, error, status }` con `as const`
- Error format: `{ error: "descripción" }` SIEMPRE, NUNCA `{ message }` top-level
- Tipos derivados de Zod (internamente). Exports como plain types
- NUNCA `any` → `unknown` + narrowing
- TypeScript `strict: true`

### Naming
- Archivos: `kebab-case`
- Exports: inglés (`getUser`, `EvaUser`, `evaAuth`)
- Descripciones de test: español

### Testing
- Vitest
- Fixture factories (funciones, no constantes)
- `.mock.test.ts`
- Imports explícitos: `describe`, `it`, `expect`, `vi`, `beforeEach`

### Linting/Formato
- oxlint + oxfmt
- Sin punto y coma, comillas simples, 80 chars
- Scripts: `fmt`, `lint`, `check`

### Seguridad
- Cookies: HttpOnly, Secure, SameSite=Lax
- NUNCA loguear tokens ni datos sensibles
- `Secure=false` **solo** si `NODE_ENV=local`. En `development` y `production` → `Secure=true`
- JWKS cacheado con ETag para minimizar requests al Auth Service
- Rate limit 429 del Auth Service pasa transparente al frontend

---

## Decisiones resueltas (anteriormente pendientes)

- [x] **Auth routes completas**: `GET/PATCH/DELETE /auth/me`, `GET/DELETE /auth/sessions`, `GET /auth/empresas` — necesarias para los hooks React
- [x] **Cookie max-age**: alineado al TTL — access=15m, refresh=30d
- [x] **Secure cookie**: `Secure=false` solo si `NODE_ENV=local`
- [x] **Device info**: server-side via `bowser` (User-Agent + Client Hints). Frontend solo envía `{ phone, code }`
- [x] **Rate limit**: 429 del Auth Service pasa transparente
- [x] **Versionamiento**: semver estricto
- [x] **Auth routes prefix**: fijo en `/auth`
- [x] **React hooks**: suite completa (useAuth, useUser, useSessions, useEmpresas)
- [x] **Retry en session check**: hasta 3 intentos con backoff exponencial antes de mostrar error

---

## Componente React: EvaLoginForm

Componente de login pre-armado, personalizable con Tailwind, exportado desde `@eva_solutions/auth-sdk/react`. Resuelve el flujo completo de phone → OTP sin que el consumidor escriba una línea de lógica de auth.

### Import y uso básico

```tsx
import { EvaLoginForm } from '@eva_solutions/auth-sdk/react'

function LoginPage() {
  return <EvaLoginForm />
}
```

**Zero config.** Usa `useAuth()` internamente, detecta `basePath` del `EvaAuthProvider` padre.

### Props

```ts
type EvaLoginFormProps = {
  // --- Personalización visual (Tailwind classes) ---
  classNames?: {
    container?: string     // Wrapper principal del form
    title?: string         // Título "Iniciar sesión" / custom
    subtitle?: string      // Subtítulo / descripción
    phoneInput?: string    // Input del número telefónico
    countrySelect?: string // Select/dropdown de código de país
    otpInput?: string      // Cada slot del input OTP
    otpContainer?: string  // Wrapper del grupo de slots OTP
    submitButton?: string  // Botón de enviar (ambos pasos)
    backButton?: string    // Botón volver (paso OTP)
    timer?: string         // Texto/número del countdown
    resendButton?: string  // Botón "Reenviar código"
    errorMessage?: string  // Mensajes de error
    infoBox?: string       // Caja informativa
  }

  // --- Contenido ---
  title?: string           // Default: "Iniciar sesión"
  subtitle?: string        // Default: "Ingresa tu número de celular"
  otpTitle?: string        // Default: "Verificar código"
  otpSubtitle?: string     // Default: "Ingresa el código de 6 dígitos"
  submitLabel?: string     // Default: "Enviar código"
  verifyLabel?: string     // Default: "Verificar"
  resendLabel?: string     // Default: "¿No recibiste el código? Reenviar"
  backLabel?: string       // Default: "Volver"

  // --- Comportamiento ---
  defaultCountry?: string  // Código ISO del país inicial (default: "PE")
  otpLength?: number       // Cantidad de dígitos OTP (default: 6)
  resendCooldown?: number  // Segundos antes de permitir reenvío (default: 60)
  onSuccess?: () => void   // Callback post-login exitoso (ej: router.push)
  onError?: (error: EvaAuthError) => void // Callback de error

  // --- Render personalizado (escape hatches) ---
  renderPhoneInput?: (props: PhoneInputRenderProps) => ReactNode
  renderOtpInput?: (props: OtpInputRenderProps) => ReactNode
  renderSubmitButton?: (props: SubmitButtonRenderProps) => ReactNode
  renderTimer?: (props: TimerRenderProps) => ReactNode
}
```

### Render Props (escape hatches)

Para personalización total sin perder la lógica interna:

```ts
type PhoneInputRenderProps = {
  phone: string
  country: string
  onPhoneChange: (value: string) => void
  onCountryChange: (code: string) => void
  disabled: boolean
}

type OtpInputRenderProps = {
  otp: string
  length: number
  onOtpChange: (value: string) => void
  disabled: boolean
  autoFocus: boolean
}

type SubmitButtonRenderProps = {
  onClick: () => void
  disabled: boolean
  isLoading: boolean
  label: string
  step: 'phone' | 'otp'
}

type TimerRenderProps = {
  remainingSeconds: number
  isActive: boolean
  onResend: () => void
  canResend: boolean
}
```

### Estructura interna del componente

```
<EvaLoginForm>
├── Paso 1: PhoneStep (step === 'phone')
│   ├── Título + Subtítulo
│   ├── CountryCodeSelect (dropdown de banderas + código)
│   │   └── Búsqueda de país integrada
│   ├── PhoneNumberInput (input numérico)
│   ├── InfoBox (texto explicativo)
│   └── SubmitButton → llama useAuth().login.getCode()
│
└── Paso 2: OtpStep (step === 'otp')
    ├── Título + Subtítulo
    ├── Número enviado (muestra +{country}{phone} con máscara parcial)
    ├── OtpSlots (N inputs individuales, autoFocus + auto-advance)
    ├── CountdownTimer (resendCooldown segundos)
    ├── ResendButton (habilitado cuando timer = 0)
    ├── BackButton → vuelve a paso 1
    └── SubmitButton → llama useAuth().login.verify()
```

### Flujo interno

```
1. Usuario selecciona país (default: PE) e ingresa número
2. Click "Enviar código" → login.getCode({ phone: `+${countryCode}${number}` })
3. Si ok → transición animada a paso OTP
4. Usuario ingresa código de 6 dígitos (auto-advance entre slots)
5. Click "Verificar" → login.verify({ phone, code })
6. Si ok → llama onSuccess() callback
7. Si error → muestra mensaje + permite reintentar
```

### CountryCodeSelect — datos integrados

El componente incluye una lista estática de países con:

```ts
type CountryOption = {
  code: string      // "PE", "AR", "MX", "CO", etc.
  dialCode: string  // "+51", "+54", "+52", "+57"
  name: string      // "Perú", "Argentina", "México"
  flag: string      // Emoji bandera: "🇵🇪", "🇦🇷", "🇲🇽"
}
```

- **Sin dependencias externas** para los datos de países (lista embebida, ~5KB)
- Búsqueda por nombre o código
- Scroll virtual si hay muchos países (nativo `<select>` o listbox accesible)
- País por defecto configurable via `defaultCountry` prop

### OTP Slots — implementación

- N inputs individuales (controlados) con `inputMode="numeric"` y `pattern="[0-9]"`
- Auto-advance: al escribir un dígito, foco pasa al siguiente slot
- Auto-backspace: al borrar en slot vacío, foco regresa al anterior
- Paste support: pegar código completo distribuye dígitos en todos los slots
- Accesible: `aria-label="Dígito {n} de {total}"`

### Estilos por defecto (Tailwind v4)

El componente viene con clases Tailwind v4 sensatas que se **fusionan** (no reemplazan) con las de `classNames`. Usa `tailwind-merge` internamente para resolver conflictos:

```ts
// Defaults internos (fusionables)
const defaults = {
  container: 'flex flex-col gap-6 w-full max-w-sm mx-auto',
  title: 'text-2xl font-bold text-foreground',
  subtitle: 'text-sm text-muted-foreground',
  phoneInput: 'h-12 rounded-xl border bg-background px-4 text-base font-medium focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all',
  countrySelect: 'h-12 rounded-xl border bg-background px-3 text-base focus:ring-2 focus:ring-primary/50',
  otpInput: 'w-12 h-14 text-xl font-bold rounded-xl border bg-background text-center focus:ring-2 focus:ring-primary/50',
  otpContainer: 'flex gap-3 justify-center',
  submitButton: 'h-12 w-full rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50',
  backButton: 'text-sm text-muted-foreground hover:text-foreground transition-colors',
  timer: 'text-2xl font-bold tabular-nums text-foreground',
  resendButton: 'text-sm text-primary hover:text-primary/80 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed',
  errorMessage: 'text-sm text-destructive',
  infoBox: 'rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground',
}
```

**Filosofía de styling:**
- Colores usan CSS variables semánticas (`text-foreground`, `bg-primary`, `text-destructive`) → alineados con el enfoque CSS-first de Tailwind v4 (`@theme` + custom properties)
- Compatibles con cualquier tema que defina esas variables (shadcn/ui, DaisyUI, custom `@theme`)
- `tailwind-merge` v3 como única dependencia de styling (2KB gzip, tree-shakeable, compatible Tailwind v4)
- El consumidor puede sobreescribir cualquier slot via `classNames`
- Para personalización total: usar render props y proveer su propio markup

### Ejemplo: personalización con classNames

```tsx
<EvaLoginForm
  defaultCountry="AR"
  title="Bienvenido"
  subtitle="Ingresa tu celular para continuar"
  classNames={{
    container: 'bg-slate-950 p-8 rounded-3xl shadow-2xl',
    phoneInput: 'bg-white/5 border-slate-800 text-white',
    otpInput: 'bg-white/5 border-slate-800 text-white',
    submitButton: 'bg-emerald-500 hover:bg-emerald-600',
    infoBox: 'bg-emerald-500/10 border-emerald-500/20',
  }}
  onSuccess={() => router.push('/dashboard')}
/>
```

### Ejemplo: render props para control total

```tsx
<EvaLoginForm
  renderPhoneInput={({ phone, onPhoneChange, country, onCountryChange }) => (
    <div className="flex gap-2">
      <MyCustomCountryPicker value={country} onChange={onCountryChange} />
      <MyCustomInput value={phone} onChange={onPhoneChange} />
    </div>
  )}
  renderTimer={({ remainingSeconds, canResend, onResend }) => (
    <div className="text-center">
      {canResend ? (
        <button onClick={onResend}>Reenviar</button>
      ) : (
        <span>{remainingSeconds}s</span>
      )}
    </div>
  )}
/>
```

### Estructura de archivos nuevos

```
src/react/
├── index.ts                       # + export EvaLoginForm, tipos
├── eva-login-form.tsx             # Componente raíz (orquesta steps)
├── phone-step.tsx                 # Paso 1: input teléfono + country
├── otp-step.tsx                   # Paso 2: input OTP + timer
├── country-data.ts                # Lista estática de países (code, dialCode, name, flag)
└── login-form-types.ts            # EvaLoginFormProps, render props types
```

### Entry point actualizado

```ts
// src/react/index.ts
export { EvaAuthProvider } from './eva-auth-provider'
export { useAuth } from './use-auth'
export { useUser } from './use-user'
export { useSessions } from './use-sessions'
export { useEmpresas } from './use-empresas'
export { EvaLoginForm } from './eva-login-form'
export type {
  EvaLoginFormProps,
  PhoneInputRenderProps,
  OtpInputRenderProps,
  SubmitButtonRenderProps,
  TimerRenderProps,
} from './login-form-types'
```

### Dependencias adicionales

| Dependencia | Propósito | Tamaño | Tipo |
|---|---|---|---|
| `tailwind-merge` | Fusión inteligente de clases Tailwind | ~2KB gzip | dependency |
| `tailwindcss` | Estilos (ya la tiene el consumidor) | — | peerDependency |

```jsonc
// package.json (adiciones)
{
  "dependencies": {
    "tailwind-merge": "^3.0.0"
  },
  "peerDependencies": {
    "tailwindcss": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "tailwindcss": { "optional": true }
  }
}
```

**Nota:** `tailwindcss` es peer opcional porque el componente funciona con clases Tailwind raw (el consumidor ya las tiene). `tailwind-merge` v3 es dependency directa porque se necesita en runtime para fusionar classes y soporta Tailwind v4.

**Colores semánticos — el consumidor los define en su CSS con `@theme`:**

```css
@import 'tailwindcss';

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.6 0.25 160);
  --color-primary-foreground: oklch(1 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
}
```

El componente NO incluye estos valores — solo consume las variables. Esto lo hace agnóstico al tema del proyecto.

### Accesibilidad

- `role="form"` con `aria-label` en el form
- Labels asociados a inputs (`htmlFor` + `id`)
- Focus management: auto-focus al primer slot OTP al transicionar
- `aria-live="polite"` en mensajes de error y timer
- `inputMode="numeric"` + `pattern` en OTP para teclado numérico en mobile
- Enter submits en ambos pasos
- Escape en OTP → vuelve a paso phone

# Referencia de API

## `@eva/auth-sdk`

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

#### `verifyAccessToken(token: string)`

Verifica un JWT localmente usando la public key del JWKS.

```ts
const result = await verifyAccessToken(token)
if (result.ok) {
  console.log(result.data) // EvaTokenPayload
}
```

Retorna `Promise<Result<EvaTokenPayload>>`.

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
| `EvaTokenPayload` | Claims del JWT decodificado |
| `Result<T>` | `{ ok: true, data: T } \| { ok: false, error: string, status: number }` |
| `DeviceInfo` | Información parseada del User-Agent |
| `TokenPair` | Par de access + refresh token |
| `ActivityState` | Estado de actividad |
| `PrivacyState` | Estado de privacidad |
| `EvaAuthError` | Error tipado del SDK |

### Error utilities

#### `createAuthError(error, status)`

Crea un objeto `EvaAuthError` tipado.

```ts
import { createAuthError } from '@eva/auth-sdk'

const err = createAuthError('Token expirado', 401)
// { error: 'Token expirado', status: 401 }
```

Retorna `EvaAuthError`.

---

#### `isAuthError(value)`

Type guard que verifica si un valor es un `EvaAuthError`.

```ts
import { isAuthError } from '@eva/auth-sdk'

const result = await someOperation()
if (!result.ok && isAuthError(result)) {
  console.log(result.error, result.status) // type-safe
}
```

Retorna `value is EvaAuthError`.

---

### Constantes

| Constante | Descripción |
|-----------|-------------|
| `HEADERS` | Nombres de headers custom (`Authorization`, `X-Eva-Refresh-Token`, etc.) |
| `COOKIES` | Nombres de cookies (`eva_access_token`, `eva_refresh_token`) |
| `COOKIE_MAX_AGE` | TTL de cookies (access: 900s, refresh: 2592000s) |
| `JWT_CONFIG` | Configuración de verificación JWT (issuer, audience, algorithms) |

---

## `@eva/auth-sdk/hono`

Integración con Hono. Middleware, rutas y helpers.

### `evaAuth()`

Middleware que protege rutas. Lee cookies, verifica JWT, auto-refresh si expirado, inyecta payload en context, actualiza cookies.

```ts
import { evaAuth } from '@eva/auth-sdk/hono'

app.use('/api/*', evaAuth())
```

Retorna `MiddlewareHandler`.

---

### `evaAuthRoutes()`

Sub-router con todos los endpoints de auth. Se monta como ruta en Hono.

```ts
import { evaAuthRoutes } from '@eva/auth-sdk/hono'

app.route('/auth', evaAuthRoutes())
```

Retorna `Hono`.

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

### `getEvaPayload(c)`

Extrae el payload del JWT desde el context de Hono. Requiere que `evaAuth()` esté aplicado.

```ts
app.get('/api/profile', (c) => {
  const payload = getEvaPayload(c)
  return c.json({ userId: payload.id })
})
```

Retorna `EvaTokenPayload`. Lanza error si el middleware no está aplicado.

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

## `@eva/auth-sdk/generic`

Funciones framework-agnostic usando Web API estándar (`Request`).

### `verifyRequest(request: Request)`

Verifica una Web API Request. Lee cookies, valida JWT, ejecuta auto-refresh si necesario.

```ts
const result = await verifyRequest(request)
if (result.ok) {
  const { payload, newCookies } = result.data
  // payload: EvaTokenPayload
  // newCookies: string[] | undefined (headers Set-Cookie si hubo refresh)
}
```

Retorna `Promise<Result<{ payload, newCookies? }>>`.

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

## `@eva/auth-sdk/react`

Componentes y hooks para React.

### `EvaAuthProvider`

Context provider que gestiona el estado de autenticación. Ejecuta silent refresh al montar.

```tsx
import { EvaAuthProvider } from '@eva/auth-sdk/react'

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

# Migration Guide — @eva_solutions/auth-sdk 2.x → 3.0.0

La versión 3.0.0 mueve la URL del Auth Service de build-time a runtime. Hay **un solo paquete** para todos los entornos: ya no se instala un tarball por entorno. Razonamiento: [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre).

## Ruta rápida

1. Instala desde npm: `npm install @eva_solutions/auth-sdk@^3.0.0` (reemplaza cualquier dependencia `file:` a un tarball).
2. Llama `configureEvaAuth({ authUrl })` al arrancar, antes del primer request.
3. Borra todo uso de `getEvaEnv` y del tipo `EvaEnv`.
4. Si desarrollas en local, sirve tu app por https (las cookies ahora son siempre `Secure`).
5. Si firmas requests S2S a mano (sin `createS2SClient`), cambia a `signS2SHeaders` (sección 7). Si verificas S2S, cada request entrante debe traer `x-eva-nonce`.
6. Verifica: arranca tu app y haz una request autenticada; debe responder 200. Si la primera request que necesita el Auth Service responde 500, falta el paso 2.

## Resumen de breaking changes

| # | Área | Cambio |
|---|------|--------|
| 1 | `configureEvaAuth` | Vuelve `authUrl` (obligatoria antes del primer uso que la necesite) |
| 2 | `getAuthUrl()` | Lanza un error de configuración si `authUrl` no fue configurada |
| 3 | Errores de configuración | `verifyAccessToken`, `verifyRequest`, `authFetch` y las rutas/middleware propagan el error: el consumidor responde **500**, nunca 401 |
| 4 | Cookies | `Secure` siempre, en cualquier entorno |
| 5 | `getEvaEnv` / `EvaEnv` | Eliminados |
| 6 | Build | Una sola variante: ya no existen `build:local`, `build:dev`, `build:prod` ni `pack:local` |
| 7 | `authUrl` | Inmutable: un segundo valor distinto lanza |
| 8 | S2S | Nuevo header obligatorio `x-eva-nonce`; canonical de 7 líneas; razón `nonce_malformed`; clave y TTL del `replayCache` cambian |

---

## 1. `authUrl` en runtime

### Antes (2.x)

La URL venía horneada en el paquete (`EVA_BUILD_ENV` al compilar el SDK). No había nada que configurar en el consumidor, y `configureEvaAuth({ authUrl })` no existía.

### Después (3.0.0)

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'

// Al boot, antes de registrar rutas o middleware:
configureEvaAuth({ authUrl: process.env.AUTH_URL })
```

Formas aceptadas y rechazadas:

| Entrada | Resultado |
|---------|-----------|
| `https://auth.miempresa.com` | Aceptada |
| `https://auth.miempresa.com/auth` (con path) | Aceptada |
| `http://localhost:4000`, `http://127.0.0.1:4000`, `http://[::1]:4000` | Aceptada (http solo en loopback) |
| `http://auth.miempresa.com` (http remoto) | Lanza |
| URL malformada, no-string, o esquema distinto de http/https (`ftp:`, `mailto:`, ...) | Lanza |
| Con credenciales (`https://user:pass@host`) | Lanza |
| Con query o fragmento (`?a=1`, `#x`, incluso un `?` o `#` solitario) | Lanza |

- Los mensajes de error **no repiten** el valor recibido (podría contener credenciales).
- La URL se normaliza (host en minúsculas, sin `/` final). `getAuthUrl()` devuelve la forma normalizada.
- Es **inmutable**: repetir la llamada con el mismo valor normalizado es no-op; con otro valor lanza `authUrl ya fue configurada y no puede cambiar en runtime`.
- `configureEvaAuth` es atómica: si algún campo es inválido, no se aplica ninguno.
- Importar el SDK o crear `evaAuth()` no lee la configuración ni lanza.
- `createS2SClient` y `createAdminClient` no cambian: siguen recibiendo `baseUrl` como argumento.

Detalle de opciones: [configuration.md](configuration.md).

### Estado por formato de módulo (ESM y CJS)

Los builds ESM y CJS del paquete mantienen cada uno su propio estado de configuración. Si tu proceso carga ambos formatos, llama `configureEvaAuth` en el formato que atiende las requests; si no, `getAuthUrl()` lanza el error de configuración. Un consumidor solo-ESM o solo-CJS no se ve afectado.

---

## 2. Error de configuración: 500, no 401

Si `authUrl` no fue configurada, `getAuthUrl()` lanza un `Error` con `name === 'EvaAuthConfigError'` y el mensaje `[eva-auth-sdk] authUrl no configurada: llama configureEvaAuth({ authUrl }) al arrancar`.

| Llamada | Comportamiento sin `authUrl` |
|---------|------------------------------|
| `evaAuth()` con access token, o con solo refresh token | Lanza → tu handler de errores responde 500; no se emiten `Set-Cookie` |
| `evaAuthRoutes()` (por ejemplo `logout`) | Lanza → 500; **no** se limpian las cookies |
| `verifyAccessToken(token)` | Lanza (antes devolvía `token_invalid` 401) |
| `verifyRequest(request)` con algún token | Lanza |
| Request **sin** tokens | Sigue devolviendo `auth_required` (401): no lee la configuración |

El SDK no exporta el predicado del error. Si necesitas distinguirlo, compara `err.name === 'EvaAuthConfigError'`. En Hono basta con dejar que llegue al `app.onError` (o al manejador por defecto, que responde 500).

---

## 3. Cookies `Secure` siempre

Las cookies `eva_access_token` y `eva_refresh_token` llevan `Secure` al emitirse y al limpiarse, también con `authUrl` en `http://localhost`. Antes `Secure=false` solo ocurría con el build `local`.

Consecuencia: **Safari no guarda cookies `Secure` sobre `http://localhost`**. En desarrollo local sirve tu app por https (por ejemplo con un certificado local) o prueba con un navegador que acepte el caso.

---

## 4. `getEvaEnv` y `EvaEnv` eliminados

Ya no hay entorno horneado. Borra los usos:

```ts
// Antes (2.x)
import { getEvaEnv } from '@eva_solutions/auth-sdk'
if (getEvaEnv() === 'local') { /* ... */ }

// Después (3.0.0): decide con tu propia configuración (NODE_ENV, variable de entorno, etc.)
```

Si mockeabas el módulo de config en tus tests (ver [configuration.md](configuration.md#mock-para-tests)), quita la clave `getEvaEnv`.

---

## 5. Build único

Si construías el SDK desde el repo para tus entornos: ya no existen `build:local`, `build:dev`, `build:prod` ni `pack:local`; usa `pnpm run build`. No hay variable `EVA_BUILD_ENV`. Para consumir el SDK basta `npm install` desde el registro; un build propio solo hace falta para probar cambios locales del SDK.

---

## 6. Tests de tu aplicación

`authUrl` es inmutable y el SDK no exporta un reset. Para cambiar de URL entre tests, reinicia el módulo:

```ts
import { beforeEach, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })

it('...', async () => {
  const { configureEvaAuth } = await import('@eva_solutions/auth-sdk')
  configureEvaAuth({ authUrl: 'http://localhost:4000' })
  // ...
})
```

---

## 7. S2S requiere `x-eva-nonce`

Las firmas S2S ahora incluyen un nonce por request. No hay modo de compatibilidad: un request sin `x-eva-nonce` se rechaza con `header_missing`, y uno con nonce mal formado (no son 32 hex en minúsculas) con `nonce_malformed`.

**Si usas `createS2SClient`**: no hagas nada, ya envía el nonce.

**Si firmas a mano** con `signS2SRequest` y armas los headers tú:

```ts
// Antes (2.x)
const timestamp = String(Math.floor(Date.now() / 1000))
const signature = await signS2SRequest({
  parts: { method, path, rawQuery, timestamp, clientId, bodyBytes },
  secretHex,
})
const headers = { 'x-eva-client-id': clientId, 'x-eva-timestamp': timestamp, 'x-eva-signature': signature }

// Después (3.0.0)
import { signS2SHeaders } from '@eva_solutions/auth-sdk/s2s'
const headers = await signS2SHeaders({ method, path, rawQuery, bodyBytes, clientId, secretHex })
```

`signS2SHeaders` genera timestamp, nonce (`generateS2SNonce()`) y firma, y devuelve los cuatro headers. Si sigues usando `signS2SRequest` directamente, `S2SCanonicalParts` ahora exige `nonce` (32 hex en minúsculas) y la función lanza si no lo cumple.

**Si verificas S2S** (`verifyS2SRequest` / `s2sAuth`):

- El canonical string pasa de 6 a 7 líneas (el nonce va entre timestamp y clientId). Cualquier implementación propia del verificador debe actualizarse.
- `S2SVerifyReason` gana `nonce_malformed`. Si tienes un `switch` exhaustivo sobre las razones o un mapeo de mensajes, agrégala.
- `replayCache.setIfAbsent` recibe ahora la clave `${clientId}:${nonce}` (antes `${clientId}:${timestamp}:${signatureHex}`) y un TTL de `2 * timestampWindowSeconds + 1` (241 s por defecto; antes 120). Si tu implementación derivaba algo de la forma de la clave, ajústala; las claves antiguas no coinciden con las nuevas.
- Durante un despliegue por etapas, un verificador 3.0.0 rechaza a los firmantes 2.x y un firmante 3.0.0 es rechazado por un verificador 2.x (firma inválida). Actualiza ambos lados juntos.

Razonamiento: [ADR-018](decisions.md#adr-018-nonce-obligatorio-en-las-firmas-s2s-x-eva-nonce).

---

## Versiones anteriores

Las secciones siguientes corresponden a la migración 0.x → 1.0.0 y se conservan como referencia.

---

# Migration Guide — @eva_solutions/auth-sdk 0.x → 1.0.0

> **Package scope rename (public release)**: The SDK was developed internally under a private name that was never published to npm. The public package is `@eva_solutions/auth-sdk`. If you were using a local tarball under the old internal name, update your `package.json` dependency to `@eva_solutions/auth-sdk`. See [ADR-014](adr-014-package-scope.md) for details.

## Resumen de breaking changes

| # | Área | Cambio |
|---|------|--------|
| 1 | `Result<T>.error` | Cambia de `string` a `EvaError` (discriminated union) |
| 2 | `result.status` | Desaparece del branch `ok: false` — ahora es `result.error.status` |
| 3 | `EvaAuthError` | Eliminado sin reemplazo (`src/errors.ts` hard-deleted) |
| 4 | Wire HTTP del SDK | Cambia de `{ error: string }` a `{ error: { code, message } }` (default configurable) |
| 5 | Nuevos entry points | `@eva_solutions/auth-sdk/webhooks`, `@eva_solutions/auth-sdk/admin`, `@eva_solutions/auth-sdk/s2s` |
| 6 | `ERROR_CODES` | Ahora tiene 12 entries (antes 11 — se agregó `account_state_locked`) |

---

## 1. `Result<T>.error` — string → EvaError

### Antes (0.x)

```typescript
const result = await verifyRequest(req)
if (!result.ok) {
  return c.text(result.error, result.status)
  //           ^^^^^^^^^^^   ^^^^^^^^^^^^
  //           string        number (en el Result top-level)
}
```

### Después (1.0.0) — opción mínima (helper)

```typescript
import { getMessage } from '@eva_solutions/auth-sdk'

if (!result.ok) {
  return c.text(getMessage(result.error), result.error.status)
  //            ^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^
  //            equivale a result.error.message  status ahora en .error
}
```

### Después (1.0.0) — narrowing completo

```typescript
import { ERROR_CODES } from '@eva_solutions/auth-sdk'

if (!result.ok) {
  if (result.error.kind === 'api') {
    // Error del Auth Service — .code disponible
    if (result.error.code === ERROR_CODES.rate_limited) {
      return c.json({ error: 'Demasiadas solicitudes' }, 429)
    }
  } else {
    // Error interno del SDK — .reason disponible
    if (result.error.reason === 'network') {
      return c.json({ error: 'Error de red' }, 503)
    }
  }
  return c.json({ error: result.error.message }, result.error.status || 500)
}
```

### Búsqueda para migración

```bash
# Callsites que acceden a result.error como string
grep -rn "result\.error[^.]" src/
grep -rn "\.error," src/     # error pasado como primer arg a string operations
# Callsites de result.status en el branch error
grep -rn "result\.status" src/
```

---

## 2. `result.status` → `result.error.status`

`Result<T>` en el branch `ok: false` ya no expone `status` en el nivel top. El status ahora vive en `result.error.status`.

### Tabla de mapping

| Reason / Situación | `result.error.status` |
|--------------------|-----------------------|
| No hay tokens (`auth_required`) | 401 |
| Token inválido/expirado (`token_invalid`) | 401 |
| Refresh sin tokens nuevos (`refresh_no_tokens`) | 401 |
| Fallo de verificación (`verify_failed`) | 500 |
| Error de red (`network`) | 0 |
| Respuesta malformada (`malformed`) | 0 ó HTTP status |
| Error del API (`kind: 'api'`) | HTTP status del API |

---

## 3. `EvaAuthError` — eliminado sin reemplazo

`EvaAuthError`, `createAuthError` e `isAuthError` existían en `src/errors.ts` (0.x). En 1.0.0 ese archivo fue **hard-deleted**. No existen en el paquete.

### Antes

```typescript
import { EvaAuthError, createAuthError, isAuthError } from '@eva_solutions/auth-sdk'

const err = createAuthError('Token expirado', 401)
// { error: 'Token expirado', status: 401 }

if (isAuthError(result)) {
  console.log(result.error, result.status)
}
```

### Después — usar EvaError directamente

```typescript
// No hay helper equivalente a createAuthError.
// Los errores se construyen como literales si es necesario:
const sdkErr: EvaSdkError = {
  kind: 'sdk',
  reason: 'token_invalid',
  message: 'Token expirado',
  status: 401,
}

// Para checkear si un Result tiene error — usar !result.ok:
if (!result.ok) {
  const err = result.error  // EvaError — type-safe
  console.log(err.message, err.status)
}
```

---

## 4. Wire HTTP del SDK — shape de error HTTP

### Antes (0.x)

Cuando `evaAuth()` o `evaAuthRoutes()` rechazaban un request, emitían:

```json
{ "error": "Se requiere autenticación" }
```

### Después (1.0.0, default `errorWire: 'api'`)

```json
{ "error": { "code": "unauthorized", "message": "Se requiere autenticación" } }
```

### Para mantener el shape 0.x — `errorWire: 'string'`

Si tenés consumers que esperan el shape plano de 0.x:

```typescript
import { configureEvaAuth } from '@eva_solutions/auth-sdk'

// Al boot, antes de registrar rutas:
configureEvaAuth({ errorWire: 'string' })
```

Ver [docs/configuration.md#errorwire](configuration.md#errorwire) para detalles completos.

---

## 5. Nuevos entry points

En 1.0.0 se agregan tres entry points de paquete:

```typescript
// Webhooks — verificar firmas de webhooks entrantes
import { verifyWebhookSignature, EVENT_CODES } from '@eva_solutions/auth-sdk/webhooks'

// Admin — gestión de service clients y restauración de usuarios
import { createAdminClient } from '@eva_solutions/auth-sdk/admin'

// S2S — llamadas internas con firma HMAC automática
import { createS2SClient } from '@eva_solutions/auth-sdk/s2s'
```

Ver [docs/api.md](api.md) para referencia completa de cada módulo.

---

## 6. `ERROR_CODES` — 12 entries (antes 11)

Se agregó `account_state_locked` al catálogo. Si tenías comparaciones exhaustivas sobre los codes, agregar el nuevo case.

---

## Tabla de mapping completo de reasons (0.x → 1.0.0)

En 0.x los errores eran strings. Esta tabla ayuda a mapear qué reason/code corresponde a cada mensaje legacy:

| Mensaje 0.x (aproximado) | `kind` | `reason` / `code` | `status` |
|--------------------------|--------|-------------------|----------|
| `'Autenticación requerida'` | `'sdk'` | `auth_required` | 401 |
| `'Tokens no válidos'` | `'sdk'` | `token_invalid` | 401 |
| `'Token expirado'` | `'sdk'` | `token_invalid` | 401 |
| `'El refresco no retornó nuevos tokens'` | `'sdk'` | `refresh_no_tokens` | 401 |
| `'Verificación fallida tras refresh: ...'` | `'sdk'` | `verify_failed` | 500 |
| `'Error de red'` / network | `'sdk'` | `network` | 0 |
| Respuesta no parseable | `'sdk'` | `malformed` | HTTP status |
| Cualquier error del API | `'api'` | `.code` del API | HTTP status del API |

---

## Compatibilidad de runtime

Requiere Node.js >= 18 (Web Crypto API — `crypto.subtle`). Cloudflare Workers y otros Edge runtimes con Web Crypto son compatibles.

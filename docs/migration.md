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

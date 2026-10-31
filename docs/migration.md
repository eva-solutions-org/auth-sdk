# Migration Guide — @eva_solutions/auth-sdk 2.x → 3.0.0 (y siguiente major)

> **Identidad fase 1 (siguiente major).** Si ya estás en 3.x, ve directo a la [sección 13](#13-identidad-fase-1-producto-token-de-servicio-y-empresas): producto en el login, tokens de servicio en lugar de HMAC por llamada y empresas.

La versión 3.0.0 mueve la URL del Auth Service de build-time a runtime. Hay **un solo paquete** para todos los entornos: ya no se instala un tarball por entorno. Razonamiento: [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre).

## Ruta rápida

1. Instala desde npm: `npm install @eva_solutions/auth-sdk@^3.0.0` (reemplaza cualquier dependencia `file:` a un tarball).
2. Llama `configureEvaAuth({ authUrl })` al arrancar, antes del primer request.
3. Borra todo uso de `getEvaEnv` y del tipo `EvaEnv`.
4. Si desarrollas en local, sirve tu app por https (las cookies ahora son siempre `Secure`).
5. Si firmas requests S2S a mano (sin `createS2SClient`), cambia a `signS2SHeaders` (sección 7). Si verificas S2S, cada request entrante debe traer `x-eva-nonce`.
6. Si tu frontend hace el login OTP (`login.getCode` / `login.verify` o `POST /get-code` + `POST /login`), conserva el `challengeId` que devuelve `get-code` y envíalo con el código (sección 8).
7. Si llamas al Auth Service sin el SDK (fetch directo, proxy, gateway por path), todas sus rutas viven ahora bajo `/api/v1`. `AUTH_URL` no cambia (sección 9).
8. Si usas `createAdminClient`, cambia `adminPassword` por `clientId` y `secretHex` de un service client con scope `admin` (sección 12).
9. Verifica: arranca tu app y haz una request autenticada; debe responder 200. Si la primera request que necesita el Auth Service responde 500, falta el paso 2.

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
| 9 | Login OTP | `get-code` devuelve `challengeId` y `/login` (`LoginSchema`, `http-client.login`, `login.verify`) lo exige |
| 10 | Rutas del Auth Service | Todas bajo `/api/v1` (login, user, sessions, `/internal/*`, `/admin/*`, webhooks); JWKS y `/health` siguen en la raíz; `AUTH_URL` no cambia |
| 11 | `S2SGetUserResult` (solo tipos) | Es `ProfileResponse['data']`: el perfil va directo en `result.data`, sin `{ user }`. En runtime ya era así |
| 13 | `createAdminClient` | `adminPassword` eliminado: firma HMAC S2S con `clientId` + `secretHex` de un client con scope `admin`; nuevo scope `admin` y método `republishPendingWebhooks` (sección 12) |
| 12 | Cliente admin y entrada de webhooks (endurecimiento) | `slug`/`userId` del admin se validan y codifican (error `malformed` en un `Result`, sin lanzar); los ids S2S rechazan también valores no string; `url` de webhooks solo `http(s)://`, sin espacios ni caracteres de control (el userinfo lo rechaza la API) y `eventCodes: EventCode[]` (secciones 7 y 11) |

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

**Cambios de `createS2SClient` que sí pueden afectarte:**

- **Prefijo de `baseUrl` en la firma.** El cliente firma el pathname de la URL final, incluido el prefijo de `baseUrl` (por ejemplo `/auth/api/v1/internal/users/...`). Si entre el cliente y el verificador hay un proxy o gateway que **quita** ese prefijo, el verificador verá `/api/v1/internal/users/...`, la firma no coincidirá y responderá `signature_invalid`. Opciones: que el proxy conserve el prefijo, o usar un `baseUrl` sin prefijo y enrutar por host.
- **Ids validados y codificados.** `getUser`, `getWebhookSubscription`, `updateWebhookSubscription`, `deleteWebhookSubscription` y `rotateWebhookSubscriptionSecret` devuelven `{ ok: false, error: { kind: 'sdk', reason: 'malformed' } }`, sin hacer fetch, si el id no es un string, es vacío, `.` o `..` (crudo o percent-decodificado, `%2e` en cualquier caso). Cualquier otro id pasa por `encodeURIComponent`: `a/b` viaja como `a%2Fb`, `a?b` como `a%3Fb`. Los UUID no cambian. Rechazar valores que no son string (por ejemplo `undefined` o un número que llega de un `any`) es un endurecimiento: el helper es el mismo que usa el cliente admin (sección 11).
- **Entrada de webhooks más estricta.** `createWebhookSubscription` y `updateWebhookSubscription` usan el contrato compartido: `url` solo `http` o `https` seguido de `//`, sin espacios ni caracteres de control (`javascript:`, `ftp://` y `https:host/x` se rechazan; el contrato no rechaza el userinfo: la API parsea la URL y rechaza `https://user:pass@host` y `https://user@host`; un `@` en el path o el query sigue siendo válido). Si pasabas otro esquema, una `url` sin `//` o con caracteres de control, ahora falla la validación y `eventCodes` solo con valores de `EVENT_CODES`, mínimo uno. En tipos, `eventCodes` es `EventCode[]` (antes aceptaba cualquier string): si guardabas los códigos en un `string[]`, tipéalos como `EventCode[]`. El userinfo y los duplicados no los rechaza el contrato sino el Auth Service.

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

## 8. Login OTP requiere `challengeId`

`POST /get-code` ahora responde `{ data: { message, challengeId } }` y `POST /login` **exige** ese `challengeId` en el body. Sin él, el SDK responde 400 `malformed` sin llegar al Auth Service. El `challengeId` es opaco y vive lo mismo que el código: cada `get-code` nuevo invalida el anterior. No hay modo de compatibilidad: un cliente 2.x (que solo envía `{ phone, code }`) no puede iniciar sesión contra un Auth Service que exige el desafío.

**Si usas `evaAuthRoutes()` / `evaAuthOpenAPIRoutes()` con tu propio frontend** (fetch directo):

```ts
// Antes (2.x)
await fetch('/auth/get-code', { method: 'POST', body: JSON.stringify({ phone }) })
await fetch('/auth/login', { method: 'POST', body: JSON.stringify({ phone, code }) })

// Después (3.0.0)
const res = await fetch('/auth/get-code', { method: 'POST', body: JSON.stringify({ phone }) })
const { data: { challengeId } } = await res.json()   // guárdalo en memoria
await fetch('/auth/login', { method: 'POST', body: JSON.stringify({ phone, code, challengeId }) })
```

**Si usas el provider de React:**

```tsx
// Antes (2.x)
await login.getCode({ phone })
await login.verify({ phone, code })

// Después (3.0.0)
const res = await login.getCode({ phone })
if (res.ok) await login.verify({ phone, code, challengeId: res.data.challengeId })
```

**Si usas `createHttpClient` (cliente HTTP exportado):** `getCode` devuelve `Result<{ message: string; challengeId: string }>` y `login` recibe `{ phone, code, challengeId, ...DeviceInfo }`.

Reglas:

- Guarda el `challengeId` **solo en memoria** (estado del componente o variable): no uses cookie ni `localStorage`. El provider de React no lo guarda; es tu responsabilidad conservarlo entre los dos pasos.
- Si el usuario pide un código nuevo, reemplaza el `challengeId` guardado: el anterior deja de servir (con varias pestañas gana el último `get-code`).
- Un `challengeId` ausente da 400; uno distinto al vigente, o ya consumido, da 401 `Credenciales inválidas`, igual que un código incorrecto pero sin gastar intentos.
- Actualiza el SDK y el Auth Service juntos: un Auth Service anterior no emite `challengeId` (el login del frontend no tendría qué enviar) y uno nuevo rechaza el login sin él.

---

## 9. Rutas del Auth Service bajo `/api/v1`

El Auth Service sirve todas sus rutas HTTP bajo `/api/v1`: login, user, sessions, `/internal/*`, `/admin/*` y webhooks. En la raíz quedan solo `/.well-known/jwks.json`, `/health`, `/ui` y `/doc`. Una ruta sin prefijo (por ejemplo `POST /login`) responde 404 `not_found`, sin redirección. El SDK 3.0.0 antepone el prefijo en todos sus clientes (`createHttpClient`, `createS2SClient`, `createAdminClient`), así que solo funciona contra un Auth Service que sirva `/api/v1`: actualiza ambos juntos.

| Ruta del Auth Service | 2.x | 3.0.0 |
|-----------------------|-----|-------|
| Login OTP | `POST /login/get-code` | `POST /api/v1/login/get-code` |
| Perfil | `GET /user` | `GET /api/v1/user` |
| S2S usuarios | `GET /internal/users/{id}` | `GET /api/v1/internal/users/{id}` |
| Admin | `POST /admin/service-clients` | `POST /api/v1/admin/service-clients` |
| JWKS | `GET /.well-known/jwks.json` | sin cambio |
| Health | `GET /health` | sin cambio |

**`AUTH_URL` no cambia.** El prefijo no va en `authUrl`: el SDK lo agrega dentro de cada path (`apiPath()` devuelve `API_PREFIX + path`). Si lo pusieras en `authUrl`, el JWKS se buscaría en `<authUrl>/.well-known/jwks.json` = `/api/v1/.well-known/jwks.json`, que responde 404, y la verificación de tokens dejaría de funcionar.

**`baseUrl` con path** (`createS2SClient`, `createAdminClient`): el prefijo del path se conserva y `/api/v1` se agrega después. El cliente firma el pathname final.

```ts
const s2s = createS2SClient({ baseUrl: 'https://auth.test/auth', /* ... */ })
await s2s.getUser('u1')
// GET https://auth.test/auth/api/v1/internal/users/u1
// pathname firmado: /auth/api/v1/internal/users/u1
```

**Qué revisar:**

- Un proxy o gateway que enruta o filtra por path debe dejar pasar `/api/v1/*`.
- Un verificador S2S propio recibe y verifica el pathname `/api/v1/internal/...`.
- Si llamas al Auth Service sin el SDK, cambia tus paths a `/api/v1/...`.
- Las rutas de **tu** backend no cambian: lo que montas con `evaAuthRoutes()` (por ejemplo `/auth/login`, `/auth/me`) y lo que consumen los hooks de React (`useAuthData('/sessions')`) son rutas del BFF del consumidor, no del Auth Service, y no se prefijan.

---

## 10. `getUser`: el perfil va en `result.data`

`S2SGetUserResult` pasa de `{ user: perfil }` a `perfil` (`ProfileResponse['data']`). El tipo anterior no coincidía con el runtime: `getUser` ya entregaba el perfil directo, así que el código que leía `result.data.user` no tipaba contra la realidad. Cambia `result.data.user.x` por `result.data.x`. Un usuario inexistente o soft-deleted llega como error con `code: 'user_not_found'` (404); `isNotFound` también es true para un 404 de ruta (`not_found`), así que para detectar un usuario ausente usa `matchError(err, 'user_not_found')`.

---

## 11. Cliente admin: `slug` y `userId` validados y codificados

`getServiceClient`, `updateServiceClient`, `deleteServiceClient`, `rotateServiceClientSecret` (parámetro `slug`) y `restoreUser` (parámetro `userId`) tratan el valor como un solo segmento de path, igual que los ids del cliente S2S (sección 7). Si no es un string, es vacío, `.` o `..` (crudo o percent-decodificado), devuelven `{ ok: false, error: { kind: 'sdk', reason: 'malformed', status: 0 } }` sin hacer fetch: **no lanzan** ni rechazan la promesa. Cualquier otro valor pasa por `encodeURIComponent` (`a/b` viaja como `a%2Fb`, `a%2Fb` como `a%252Fb`). Los slugs válidos del contrato (`^[a-z][a-z0-9-]{2,63}$`) y los UUID no cambian.

**Qué hacer:** nada si manejas `result.ok === false`. Si pasabas slugs con caracteres especiales esperando que viajaran sin codificar, ahora el Auth Service los recibe codificados.

---

## 12. `createAdminClient`: firma HMAC en lugar de `adminPassword`

El Auth Service ya no acepta `x-admin-password`: `/api/v1/admin/*` exige la firma S2S de un service client con scope `admin`. `AdminClientConfig` pasa de `{ adminPassword, baseUrl }` a `{ clientId, secretHex, baseUrl }`.

```ts
// Antes
createAdminClient({ adminPassword: process.env.EVA_ADMIN_PASSWORD!, baseUrl })
// Ahora
createAdminClient({ clientId: process.env.AUTH_ADMIN_SLUG!, secretHex: process.env.AUTH_ADMIN_SECRET!, baseUrl })
```

Además: `SERVICE_CLIENT_SCOPES` y `S2S_SCOPES` suman `admin` (ya se puede crear un client con ese scope por la API), `ADMIN_ERROR_CODES` suma `last_admin_client` (409), y hay un método nuevo, `republishPendingWebhooks`. Despliega este SDK junto con el Auth Service que exige la firma.

**Qué hacer:** crea un client admin (bootstrap del Auth Service), guarda su secret en tu gestor de secretos y reemplaza `adminPassword`. Si comparabas códigos con un `switch` exhaustivo sobre `AdminErrorCode`, agrega `last_admin_client`.

---

## 13. Identidad fase 1: producto, token de servicio y empresas

Cambios incompatibles de la siguiente versión mayor (ADR-020). Requiere un Auth Service con el mismo diseño (`identidad-fase1`).

**Usuarios (BFF, cookies y verificación):**

| Antes | Ahora |
|-------|-------|
| `aud: 'proyecto-global'` | `aud` = tu producto: `configureEvaAuth({ product: 'whatsapp-panel' })`. Obligatorio para login, cookies y `verifyAccessToken`; sin él lanzan `EvaAuthConfigError` (500) |
| `COOKIES.ACCESS_TOKEN` (`eva_access_token`) | `getCookieNames().ACCESS_TOKEN` (`eva_<producto>_access_token`). **Las cookies viejas dejan de leerse**: las sesiones activas se reinician (aceptable sin producción) |
| `JWT_CONFIG.AUDIENCE` | Eliminado. `JWT_CONFIG` queda con `ISSUER` y `ALGORITHM` |
| `verifyAccessToken` → `{ id, sessionId }` | `{ id, sessionId, clientId, empresaId? }`. Exige `typ: at+jwt`, `kid` `usr-` y el claim `client_id`; un token sin `kid` se rechaza |
| Login sin producto | `POST /login` lleva `producto` (el SDK lo pone; no lo mandes desde el navegador) y `empresaId` opcional. `get-code` no cambia |
| JWKS en caché 24 h | 10 min |

**Servicios (llamadas entre servicios):**

```ts
// Antes
const s2s = createS2SClient({ clientId, secretHex, baseUrl })
// Ahora
const tokenProvider = createServiceTokenProvider({ authUrl, clientId, secretHex, audience: 'auth-api' })
const s2s = createS2SClient({ baseUrl: authUrl, tokenProvider })
```

- `createS2SClient` ya no firma cada llamada: manda `Authorization: Bearer` con el token del proveedor y, ante un 401, invalida y reintenta una vez. `S2SClientConfig` es `{ baseUrl, tokenProvider }`. La firma HMAC (`signS2SHeaders`, `verifyS2SRequest`, `s2sAuth`) sigue disponible: solo la usan `POST /internal/token` y `/admin`.
- Quien recibe llamadas de otro servicio: `verifyServiceJwt` / `serviceJwtAuth` (`svc+jwt`, `bsha`, `replayCache`) se eliminan. Usa `verifyServiceToken(token, { audience, requiredScope | anyScope })` o el middleware `serviceTokenAuth` (deja `serviceClientId` = `sub`, `serviceClientSlug` = `client_id` y `serviceScopes`). No hay `replayCache`.
- `S2S_SCOPES` pierde `ADMIN` y suma `EMPRESAS_LEER` y `EMPRESAS_ESCRIBIR`. `SERVICE_CLIENT_SCOPES` (contrato) se reemplaza por `SERVICE_AUDIENCE_SCOPES`.

**Admin:**

- `createServiceClient` / `updateServiceClient` pierden `scopes` y ganan `esAdmin`; `ServiceClientPublic` y el resultado de creación traen `esAdmin` (y `grants` en el primero) en lugar de `scopes`. El cliente que firma `/admin` debe tener `esAdmin`.
- Métodos nuevos: `listServiceClientGrants`, `setServiceClientGrant`, `deleteServiceClientGrant`.
- El slug `auth-service` está reservado.

**Empresas:** `S2SClient` suma `createEmpresa`, `getEmpresa`, `addEmpresaMember`, `removeEmpresaMember` y `createSucursal`; `EvaEmpresa` (lista del usuario) trae `sucursales`; el cliente HTTP suma `setActiveEmpresa`. `EVENT_CODES` pasa de 11 a 15 (`empresa.*`).

**Qué hacer:** configura `product` en los consumidores de usuario; reemplaza `COOKIES` por `getCookieNames()`; crea un `createServiceTokenProvider` por (audiencia, scope) en los servicios que llaman a otros; migra a `serviceTokenAuth` los receptores de `svc+jwt`; pide al admin de Auth las concesiones (`setServiceClientGrant`) que cada service client necesita.

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

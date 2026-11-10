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

El SDK expone `configureEvaAuth(opts)` para inyectar configuración en runtime. Llamar al **boot**, antes del primer request.

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
// También disponible desde @eva_solutions/auth-sdk/hono y /generic (servidor).
// El entry /react (navegador) tiene la suya, sin `serviceCredentials`.

configureEvaAuth({
  authUrl: process.env.AUTH_URL,             // URL del Auth Service (https, o http en loopback)
  product: 'whatsapp-panel',                 // producto de este consumidor (login, cookies, verifyAccessToken)
  cookieDomain: process.env.COOKIE_DOMAIN,   // Domain para cookies (ej: '.miempresa.com')
  serviceCredentials: {                      // OBLIGATORIO en servidor: tu credencial de service client
    clientId: process.env.AUTH_CLIENT_ID,
    secretHex: process.env.AUTH_CLIENT_SECRET_HEX,
  },
  // getClientIp: fuera de Cloudflare Workers también es obligatorio (ver Reenvío de la IP del cliente)
})
```

En Cloudflare Workers eso es todo el cableado (fuera de Workers hace falta además `getClientIp`): con `serviceCredentials` el SDK reenvía la IP real del usuario a Auth en todas las rutas, en `evaAuth` y en `verifyRequest` (ver [Reenvío de la IP del cliente](#reenvío-de-la-ip-del-cliente)). Sin backend (solo local), pasa `serviceCredentials: null`.

### Opciones

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `authUrl` | `string \| undefined` | URL base del Auth Service. Obligatoria antes del primer uso que la necesite; inmutable. Ver [URL del Auth Service](#url-del-auth-service). |
| `product` | `string \| undefined` | Slug del producto (`^[a-z][a-z0-9-]{2,63}$`, por ejemplo `whatsapp-panel`). **Obligatorio solo** si usas las rutas de login, las cookies de sesión o `verifyAccessToken`: da el nombre de las cookies (`eva_<producto>_access_token` / `eva_<producto>_refresh_token`), la audiencia (`aud`) que exige `verifyAccessToken` y el `producto` que viaja en el login. Un servicio que solo verifica tokens de servicio no lo necesita. Inmutable, como `authUrl`; sin él, esos usos lanzan `EvaAuthConfigError` (500). Auth valida que el producto exista, esté habilitado y no coincida con una audiencia de servicio. |
| `serviceCredentials` | `{ clientId: string; secretHex: string } \| null` | **Obligatorio en los entry de servidor** (raíz, `/hono`, `/generic`); no existe en `/react`. La credencial del service client de este backend; el permiso `login:client-ip` es implícito en Auth, no hay nada que conceder. `null` es el descarte explícito (solo local o sin backend); `undefined` lanza al configurar, sin valores sensibles en el mensaje. Reconfigurar con la misma credencial conserva el objeto de reenvío y su backoff. |
| `getClientIp` | `(context: Context \| Request) => string \| null \| undefined` | De dónde sale la IP del usuario. **Obligatorio con `serviceCredentials` fuera de Cloudflare Workers** (lanza al configurar); en Workers es opcional y por defecto lee solo `cf-connecting-ip`. Ver [Reenvío de la IP del cliente](#reenvío-de-la-ip-del-cliente). |
| `onClientIpForwardingError` | `(info: { code; status? }) => void` | Opcional, servidor. Aviso de un fallo del reenvío, sin token ni IP. Por defecto `console.warn` con `code` y `status`. |
| `cookieDomain` | `string \| undefined` | Atributo `Domain` para `Set-Cookie`. Si se omite, no resetea el valor previo. |
| `errorWire` | `'api' \| 'string' \| undefined` | Shape HTTP que el SDK emite cuando rechaza un request. Default: `'api'`. Ver [sección errorWire](#errorwire) más abajo. |
| `errorMessages` | `Partial<EvaErrorMessages> \| undefined` | Override de mensajes de error. Ver [sección Mensajes de error personalizados](#mensajes-de-error-personalizados). |

### Reenvío de la IP del cliente

Auth limita `get-code` y `login` por IP y por persona, y guarda la IP de la sesión. Detrás de un backend, Auth vería la IP del backend: por eso el backend entrega su credencial **una vez** y el SDK reenvía la IP real, sin cablear nada.

**Cloudflare Workers** (la IP la fija el borde en `cf-connecting-ip`; es el default y solo existe aquí, detectado con `navigator.userAgent === 'Cloudflare-Workers'`):

```ts
configureEvaAuth({
  authUrl: env.AUTH_URL,
  product: 'whatsapp-panel',
  serviceCredentials: { clientId: env.AUTH_CLIENT_ID, secretHex: env.AUTH_CLIENT_SECRET_HEX },
})
```

**Node, Bun o cualquier servidor fuera de Workers**: `getClientIp` es **obligatorio** con `serviceCredentials` (si falta, `configureEvaAuth` lanza al configurar; con `serviceCredentials: null` no aplica). En otro servidor `cf-connecting-ip` lo escribe el cliente, así que el SDK no lo usa por defecto. Lee el header que SOLO tu proxy fija, y asegúrate de que el proxy lo sobrescribe siempre (nunca `x-forwarded-for` tal cual: lo escribe el cliente).

```ts
import { configureEvaAuth, readRequestHeader } from '@eva_solutions/auth-sdk'

configureEvaAuth({
  authUrl: process.env.AUTH_URL,
  product: 'whatsapp-panel',
  serviceCredentials: { clientId: process.env.AUTH_CLIENT_ID, secretHex: process.env.AUTH_CLIENT_SECRET_HEX },
  getClientIp: (context) => readRequestHeader(context, 'x-real-ip'), // lo fija nginx con `proxy_set_header X-Real-IP $remote_addr;`
  onClientIpForwardingError: ({ code, status }) => logger.warn({ code, status }, 'client ip forwarding'),
})
```

Quien llama directo a `createHttpClient` obtiene los headers con `getConfiguredClientIpForwarder()` (el mismo objeto, con el mismo backoff, que usan las rutas): `createHttpClient().getUser({ accessToken }, await getConfiguredClientIpForwarder()(request))`. Una opción `clientIpForwarding` explícita en `evaAuthRoutes`, `evaAuth` o `verifyRequest` tiene prioridad sobre la configurada. El detalle (headers, fallos, backoff) está en [api.md](api.md#reenvío-de-la-ip-del-cliente) y las reglas de seguridad en [security.md](security.md#reenvío-de-la-ip-del-cliente).

### Validaciones

- `authUrl` debe cumplir las reglas de la tabla de [URL del Auth Service](#url-del-auth-service); si no, **lanza inmediatamente**.
- `product` debe ser un slug (`^[a-z][a-z0-9-]{2,63}$`); si no, **lanza inmediatamente**.
- `serviceCredentials` es obligatorio en los entry de servidor: `undefined` lanza, con credencial y sin `getClientIp` fuera de Cloudflare Workers también, y una credencial mal formada (`clientId` vacío o `secretHex` que no sea hex) también; ningún mensaje incluye el valor.
- `cookieDomain` no puede contener `;`, `\r` ni `\n` (defensa contra header injection). Si los contiene, **lanza inmediatamente**.

### Reconfiguración

`authUrl` y `product` son **inmutables** (ver [URL del Auth Service](#url-del-auth-service)): reconfigurar el mismo valor es no-op y uno distinto lanza. Los demás campos provistos sobrescriben el valor previo; un campo omitido (`undefined`) preserva el valor previo:

```ts
configureEvaAuth({ cookieDomain: '.a.com' })
configureEvaAuth({ cookieDomain: '.b.com' })  // sobrescribe .a.com
```

La llamada es **atómica**: valida todos los campos y recién entonces los aplica. Si uno falla (incluido un `authUrl` distinto del ya configurado), no cambia ninguno.

### URL del Auth Service

`authUrl` es la URL base del Auth Service. Se configura en runtime con `configureEvaAuth({ authUrl })`, **antes del primer uso que la necesite** (JWKS, `authFetch`, rutas de auth). Un único paquete sirve a todos los entornos; cada consumidor pasa su propia URL. Razonamiento: [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre).

```ts
configureEvaAuth({ authUrl: process.env.AUTH_URL })
```

| Entrada | Resultado |
|---------|-----------|
| `https://auth.miempresa.com` | Aceptada |
| `https://auth.miempresa.com/auth` (con path) | Aceptada; el JWKS se lee de `https://auth.miempresa.com/auth/.well-known/jwks.json` |
| `http://localhost:4000`, `http://127.0.0.1:4000`, `http://[::1]:4000` | Aceptada (http solo en loopback) |
| `http://auth.miempresa.com` (http remoto) | Lanza |
| Malformada, no-string o esquema distinto de http/https (`ftp:`, `mailto:`, ...) | Lanza |
| Con credenciales (`https://user:pass@host`) | Lanza |
| Con query o fragmento (`?a=1`, `#x`, incluso un `?` o `#` solitario) | Lanza |

- **Sin `/api/v1`**: `authUrl` no lleva el prefijo de versión. El SDK lo agrega a cada ruta del Auth Service (`/api/v1/...`); el JWKS y `/health` se piden en la raíz de `authUrl`. Ver [migration.md](migration.md#9-rutas-del-auth-service-bajo-apiv1).
- **Normalización**: host en minúsculas y sin `/` final. `getAuthUrl()` devuelve la forma normalizada.
- **Sin eco**: los mensajes de error no repiten el valor recibido (podría traer credenciales). El rechazo de http remoto muestra solo el href normalizado.
- **Inmutable**: repetir la llamada con el mismo valor normalizado es no-op; con otro valor lanza `authUrl ya fue configurada y no puede cambiar en runtime`.
- **Estado por módulo**: la configuración vive en una variable del módulo. Cada proceso (o isolate, en Workers) debe llamar `configureEvaAuth` al arrancar.
- **ESM y CJS no comparten estado**: los builds ESM y CJS del paquete mantienen cada uno su propia configuración. Si un proceso carga ambos formatos, configura el formato que atiende las requests; de lo contrario `getAuthUrl()` lanza el error de configuración.
- **Importar no lanza**: importar el SDK o crear `evaAuth()` no lee la configuración.

#### Si falta `authUrl`

`getAuthUrl()` lanza un `Error` con `name === 'EvaAuthConfigError'` y el mensaje `[eva-auth-sdk] authUrl no configurada: llama configureEvaAuth({ authUrl }) al arrancar`. `authFetch` y `verifyAccessToken` lo propagan en vez de convertirlo en error de red o en token inválido; por eso `evaAuth()`, `evaAuthRoutes()` y `verifyRequest` lanzan y tu aplicación responde **500, nunca 401**, sin emitir ni limpiar cookies. Una request sin tokens sigue respondiendo 401 sin leer la configuración.

> **Migración desde 2.x**: ver [migration.md](migration.md).

### Validación HTTPS en S2S, Admin y proveedor de tokens

`createS2SClient`, `createAdminClient` (`baseUrl`) y `createServiceTokenProvider` (`authUrl`) validan que la URL use `https:` (o `http:` con host loopback: `localhost`, `127.0.0.0/8`, `::1`/`[::1]`). Si no cumple, lanzan sincrónicamente antes de retornar el cliente.

```ts
// Válido — https
createS2SClient({ baseUrl: 'https://auth.example.com', tokenProvider })

// Válido — loopback para tests
createS2SClient({ baseUrl: 'http://localhost:4000', tokenProvider })

// Lanza — http no-loopback (CWE-319)
createS2SClient({ baseUrl: 'http://auth.example.com', tokenProvider })
// Error: S2SClientConfig.baseUrl inválida: se requiere https (o loopback http): http://auth.example.com
```

### Recomendación de cookieDomain para subdominios

Para compartir cookies entre `app.miempresa.com` y `api.miempresa.com`, usar `.miempresa.com` (con punto leading):

```ts
configureEvaAuth({ cookieDomain: '.miempresa.com' })
```

Sin punto leading (`miempresa.com`), el browser puede restringir la cookie al dominio exacto según el navegador.

### Advertencia: Safari + Secure + HTTP (M-5)

> **Warning**: las cookies de sesión llevan `Secure` siempre, en todos los entornos (ver [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre)). Safari descarta cookies `Secure` sobre `http://localhost`. Chrome tiene comportamiento parcialmente similar en ciertas versiones.
>
> **Para desarrollo local**: sirve tu aplicación por https (por ejemplo con `mkcert`). Una `authUrl` en `http://localhost` sigue siendo válida, pero no cambia el flag `Secure` de las cookies.
> **Para staging / PR previews**: configura https de extremo a extremo (ej: Cloudflare, Vercel).

### Orden de inicialización — importa

Llamar `configureEvaAuth` **antes del primer request**. Las cookies ya emitidas no se reescriben retroactivamente:

```ts
// boot.ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
configureEvaAuth({ authUrl: process.env.AUTH_URL, cookieDomain: '.miempresa.com', serviceCredentials })  // PRIMERO

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

## Build y distribución

El SDK se compila **una sola vez** (`pnpm run build`, tsdown; formatos ESM y CJS) y no hay variantes por entorno ni variables de build: la URL del Auth Service no forma parte del artefacto. El paquete publicado en npm es el mismo para todos los entornos.

| Script | Uso |
|--------|-----|
| `pnpm run build` | Compila `dist/` con la guarda de mapas (`packages/auth-sdk/scripts/build-with-maps.mjs`) |
| `pnpm run dev` | Compila en modo watch (`tsdown --watch`), sin pasar por la guarda |

### Guarda de mapas de declaraciones

El build de tsdown 0.22.0 / rolldown-plugin-dts 0.25.1 no es determinista: a veces fusiona un chunk `.d.ts` en el index y omite los mapas de declaraciones. Por eso `pnpm run build` no invoca tsdown directamente, sino `packages/auth-sdk/scripts/build-with-maps.mjs`:

- Corre tsdown y verifica que existan `dist/index.d.ts.map` y `dist/index.d.cts.map`.
- Si falta alguno, limpia `dist/` y reintenta, hasta 10 intentos en total.
- Si tras los 10 intentos no obtiene los mapas, falla (exit 1) con un mensaje claro; basta con volver a correr el build.
- Si tsdown mismo falla, el script termina de inmediato con su código de salida, sin reintentar.
- `pnpm run dev` (`tsdown --watch`) no pasa por la guarda, así que en watch esos mapas pueden faltar.

Con la guarda, el `dist/` que sale de `pnpm run build` siempre trae los mapas, y por tanto el `pnpm pack` posterior es reproducible. Ejecuta `pnpm run build` antes de `pnpm pack`.

---

## Cómo consume el SDK el usuario final

### Instalación

```bash
npm install @eva_solutions/auth-sdk
```

### Probar cambios locales del SDK en un consumidor

```bash
# En el repo del SDK
pnpm run build
cd packages/auth-sdk
pnpm pack
# Genera eva_solutions-auth-sdk-<version>.tgz en packages/auth-sdk/ (*.tgz está en .gitignore)

# En el proyecto consumidor
npm install ../path/to/eva_solutions-auth-sdk-<version>.tgz
```

### En código

Configura `authUrl` una vez al arrancar, antes de montar rutas o middleware:

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk'
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono'

configureEvaAuth({ authUrl: process.env.AUTH_URL, serviceCredentials })   // PRIMERO

app.route('/auth', evaAuthRoutes())
app.use('/api/*', evaAuth())
```

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

→ Ver [security.md](security.md) para configuración completa de cookies (flags, TTLs, `Secure` siempre), JWKS cache y modelo de seguridad.

---

## Auth routes prefix

El sub-router se monta con un prefijo fijo. El estándar es `/auth`:

```ts
app.route('/auth', evaAuthRoutes())
```

Todos los endpoints quedan bajo `/auth/*` (ej: `/auth/login`, `/auth/me`, `/auth/sessions`). Son rutas del BFF de tu backend, no del Auth Service: no llevan `/api/v1`.

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

<!-- Defaults sincronizados con packages/auth-sdk/src/error-messages.ts. Si modificás los defaults, actualizá esta tabla. -->

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
| `originNotAllowed` | `Origen no permitido` |
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

El SDK ofrece una variante de las rutas de auth compatible con **OpenAPI 3.1** a través del entry point `@eva_solutions/auth-sdk/hono-openapi`. Retorna un `OpenAPIHono` con 12 endpoints documentados.

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
| `POST` | `/get-code` | Solicitar código de verificación; responde `{ data: { message, challengeId } }` |
| `POST` | `/login` | Login con teléfono, código y el `challengeId` de `/get-code` (obligatorio; sin él, 400) |
| `POST` | `/refresh` | Rotar tokens via refresh cookie |
| `POST` | `/logout` | Cerrar sesión actual |
| `GET` | `/me` | Obtener datos del usuario autenticado |
| `PATCH` | `/me` | Actualizar perfil del usuario |
| `DELETE` | `/me` | Eliminar cuenta del usuario |
| `GET` | `/me/empresas` | Obtener empresas del usuario |
| `POST` | `/empresa-activa` | Cambiar la empresa activa (`{ empresaId \| null }`); reescribe solo la cookie de access |
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

// 1. Mock de config — evita llamar configureEvaAuth({ authUrl }) en cada test
vi.mock('@eva_solutions/auth-sdk/src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
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

Ver los tests en `packages/auth-sdk/tests/hono-auth-routes.mock.test.ts` y `packages/auth-sdk/tests/generic-verify.mock.test.ts` para ejemplos completos.

# Configuración

## Modelo build-time

El SDK **no lee variables de entorno en runtime**. Toda la configuración (URL del Auth Service y entorno) se hornea como constantes en el paquete al momento del build vía `tsup define`.

El consumidor **no configura nada**. Instala la versión correcta del SDK y listo.

---

## Cómo funciona

`tsup.config.ts` contiene un map interno de URLs por entorno:

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
| `pnpm build:local` | `cross-env EVA_BUILD_ENV=local tsup` | `local` | `http://localhost:4000` |
| `pnpm build:dev` | `cross-env EVA_BUILD_ENV=development tsup` | `development` | `https://auth-dev.example.com` |
| `pnpm build:prod` | `cross-env EVA_BUILD_ENV=production tsup` | `production` | `https://auth.example.com` |
| `pnpm pack:local` | `build:local` + `pnpm pack` | `local` | `http://localhost:4000` |

`pnpm build` (sin sufijo) usa `production` por defecto.

---

## Cómo consume el SDK el usuario final

### Producción

```bash
npm install @eva/auth-sdk
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
import { evaAuth, evaAuthRoutes } from '@eva/auth-sdk/hono'

app.route('/auth', evaAuthRoutes())
app.use('/api/*', evaAuth())
```

Sin parámetros, sin env vars, sin configuración. Todo viene horneado.

#### Uso avanzado: acceso directo al client

Si necesitás hacer llamadas directas al Auth Service (fuera del middleware), podés obtener el HTTP client:

```ts
import { createEvaAuth } from '@eva/auth-sdk'

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
import { evaAuth, evaAuthRoutes, getEvaPayload } from '@eva/auth-sdk/hono'

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
import { EvaAuthProvider } from '@eva/auth-sdk/react'

function App() {
  return (
    <EvaAuthProvider
      basePath="/auth"
      apiUrl="https://api.proyecto-global.com"
      onAuthChange={(auth) => console.log('Auth:', auth)}
    >
      <MyApp />
    </EvaAuthProvider>
  )
}
```

El `basePath` debe coincidir con el prefijo donde se montó `evaAuthRoutes()` en el backend.

El `apiUrl` es opcional: si se proporciona, se antepone a `basePath`. Útil cuando el frontend se comunica con un backend en otro dominio.

# Configuración

## Variables de entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `EVA_AUTH_URL` | **Sí** | URL base del Auth Service. Sin trailing slash. Ej: `https://auth.proyecto-global.com` |
| `NODE_ENV` | No | Afecta el flag `Secure` de cookies. Solo `local` desactiva Secure. |

### Comportamiento de `NODE_ENV`

| Valor | Cookie Secure |
|-------|---------------|
| `local` | `false` |
| `development` | `true` |
| `production` | `true` |
| (cualquier otro) | `true` |

---

## Cookies

| Cookie | Max-Age | HttpOnly | Secure | SameSite | Path |
|--------|---------|----------|--------|----------|------|
| `eva_access_token` | 900 (15 min) | Sí | Sí* | Lax | `/` |
| `eva_refresh_token` | 2592000 (30 días) | Sí | Sí* | Lax | `/` |

\* `Secure=false` solo cuando `NODE_ENV=local`.

---

## JWKS Cache

| Parámetro | Valor |
|-----------|-------|
| TTL normal | 24 horas |
| Max TTL (si fetch falla) | 25 horas |
| Método de revalidación | ETag / HTTP 304 |

Si el cache supera las 25 horas sin actualización exitosa, la verificación de JWT se rechaza.

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
    <EvaAuthProvider basePath="/auth" onAuthChange={(auth) => console.log('Auth:', auth)}>
      <MyApp />
    </EvaAuthProvider>
  )
}
```

El `basePath` debe coincidir con el prefijo donde se montó `evaAuthRoutes()` en el backend.

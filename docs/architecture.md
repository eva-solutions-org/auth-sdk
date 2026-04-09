# Arquitectura del SDK

## TL;DR

SDK TypeScript que resuelve autenticación end-to-end para consumidores del Auth Service del Proyecto Global. El consumidor monta el SDK y obtiene login, logout, verificación JWT, auto-refresh y gestión de sesiones sin configurar nada manualmente.

---

## Modelo de dos capas

El SDK opera como intermediario entre dos comunicaciones distintas:

### Capa 1: SDK ↔ Auth Service (server-to-server)

Comunicación interna con headers custom:

| Dirección | Header | Valor |
|-----------|--------|-------|
| Request | `Authorization` | `Bearer {accessToken}` |
| Request | `X-Eva-Refresh-Token` | `session_id:refreshToken` |
| Response | `x-eva-new-access-token` | Nuevo access token (si rotado) |
| Response | `x-eva-new-refresh-token` | Nuevo refresh token (si rotado) |

### Capa 2: Frontend ↔ Backend consumidor (cookies HttpOnly)

Comunicación con el navegador del usuario:

| Cookie | Contenido | Flags |
|--------|-----------|-------|
| `eva_access_token` | JWT ES256 | HttpOnly, Secure, SameSite=Lax, Path=/ |
| `eva_refresh_token` | `session_id:token` | HttpOnly, Secure, SameSite=Lax, Path=/ |

→ TTLs y detalles de flags: [security.md](security.md)

---

## Flujo completo

1. Frontend envía `POST /auth/login` con `{ phone, code }`
2. SDK reenvía al Auth Service con device info
3. Auth Service valida y responde con tokens
4. SDK setea cookies HttpOnly en la response al frontend
5. Frontend hace request a `/api/*` (cookies viajan automáticamente)
6. Middleware `evaAuth()` lee cookies de la request
7. Middleware verifica JWT localmente con la public key (JWKS)
8. Si el JWT expiró, middleware usa el refresh token contra el Auth Service
9. Auth Service responde con nuevos tokens
10. Middleware inyecta el payload en el context de Hono
11. Middleware actualiza las cookies en la response con los nuevos tokens

---

## Lo que el consumidor NO hace

- No configura cookies
- No parsea tokens
- No gestiona refresh
- No configura CORS para tokens
- No conoce la URL del Auth Service (viene horneada en el SDK)
- No configura variables de entorno
- No gestiona la public key

---

## Estructura de módulos

```
src/
├── client.ts          # createEvaAuth(), inicialización del SDK (sin parámetros)
├── config.ts          # Constantes build-time: AUTH_URL y ENV (horneadas por tsup define)
├── types.ts           # Todos los tipos exportados
├── errors.ts          # EvaAuthError
├── constants.ts       # HEADERS, COOKIES, JWT_CONFIG, COOKIE_MAX_AGE
├── jwks.ts            # JWKS fetch, cache, ETag/304, dedup con pendingFetch
├── jwt.ts             # verifyAccessToken con jose
├── cookies.ts         # Lectura/escritura de cookies (decodeURIComponent en parsing)
├── http-client.ts     # Cliente HTTP tipado contra Auth Service (timeout 10s)
├── index.ts           # Barrel file del root
│
├── hono/
│   ├── middleware.ts   # evaAuth() middleware (dedup refresh con Map por refreshToken)
│   ├── auth-routes.ts  # evaAuthRoutes() sub-router (safe status cast con Set)
│   ├── device-info.ts  # parseDeviceInfo con bowser
│   ├── helpers.ts      # getEvaPayload, getEvaUser (@deprecated), getSessionId
│   └── index.ts        # Barrel file
│
├── generic/
│   ├── verify.ts       # verifyRequest (Web API Request, dedup refresh con Map)
│   └── index.ts        # Barrel file (re-exporta setTokenCookies, clearTokenCookies desde cookies.ts)
│
└── react/
    ├── eva-auth-provider.tsx  # EvaAuthProvider context
    ├── use-auth.ts            # useAuth hook
    ├── use-user.ts            # useUser hook
    ├── use-sessions.ts        # useSessions hook
    ├── use-empresas.ts        # useEmpresas hook
    ├── use-auth-data.ts       # Hook base para data fetching
    ├── auth-fetch.ts          # authFetch utility
    └── index.ts               # Barrel file
```

---

## Entry points

| Import | Contenido |
|--------|-----------|
| `@eva/auth-sdk` | Core: client, types, errors, constantes, JWT, JWKS |
| `@eva/auth-sdk/hono` | Middleware, auth routes, helpers, device-info |
| `@eva/auth-sdk/react` | Provider, hooks, authFetch |
| `@eva/auth-sdk/generic` | verify, cookies (setTokenCookies, clearTokenCookies) — framework-agnostic |

---

## Stack técnico

- **TypeScript** — Tipado estricto
- **jose v6** — JWT verification y JWKS (ES256/ECDSA P-256)
- **bowser** — User-Agent parsing
- **Peer dependencies**: hono >=4, react >=18 (ambos opcionales)

---

## Runtime y build

- **Runtime**: Edge + Node.js (cero dependencias de Node.js)
- **Build**: tsup (ESM + CJS), target ES2022, declarations `.d.ts`
- **Build-time config**: → Ver [configuration.md](configuration.md)

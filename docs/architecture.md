# Arquitectura del SDK

## TL;DR

SDK TypeScript que resuelve autenticación end-to-end para consumidores del EVA Auth Service. El consumidor monta el SDK y obtiene login, logout, verificación JWT, auto-refresh y gestión de sesiones sin configurar nada manualmente.

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
- No depende de variables de entorno propias del SDK (el SDK no lee `process.env`); solo pasa `authUrl` a `configureEvaAuth` al arrancar
- No gestiona la public key

---

## Estructura de módulos

```
packages/auth-sdk/src/
├── client.ts          # createEvaAuth(), punto de entrada público del SDK → ADR-008
├── config.ts          # Config runtime: configureEvaAuth, getAuthUrl (authUrl inmutable), validación y errores de configuración → ADR-017
├── types.ts           # Todos los tipos exportados
├── errors.ts          # EvaAuthError, createAuthError, isAuthError
├── constants.ts       # HEADERS, COOKIES, JWT_CONFIG, COOKIE_MAX_AGE
├── refresh-dedup.ts   # Deduplicación de refresh compartida (Map por refreshToken)
├── jwks.ts            # JWKS remoto lazy (jose createRemoteJWKSet): cache 24h, cooldown 30s, timeout 5s
├── jwt.ts             # verifyAccessToken con jose
├── cookies.ts         # Lectura/escritura de cookies (decodeURIComponent en parsing)
├── http-client.ts     # Cliente HTTP tipado contra Auth Service (timeout 10s, validación de IDs)
├── index.ts           # Barrel file del root
│
├── hono/
│   ├── middleware.ts   # evaAuth() middleware (usa refresh-dedup)
│   ├── auth-routes.ts  # evaAuthRoutes() sub-router (safe status cast con Set, usa refresh-dedup)
│   ├── device-info.ts  # parseDeviceInfo con bowser
│   ├── helpers.ts      # getEvaPayload, getSessionId
│   └── index.ts        # Barrel file
│
├── generic/
│   ├── verify.ts       # verifyRequest (Web API Request, usa refresh-dedup)
│   └── index.ts        # Barrel file (re-exporta setTokenCookies, clearTokenCookies desde cookies.ts)
│
└── react/
    ├── eva-auth-provider.tsx  # EvaAuthProvider context
    ├── use-auth.ts            # useAuth hook
    ├── use-user.ts            # useUser hook
    ├── use-sessions.ts        # useSessions hook
    ├── use-empresas.ts        # useEmpresas hook
    ├── use-auth-data.ts       # Hook base para data fetching
    ├── auth-fetch.ts          # authFetch utility (timeout 30s, errores diferenciados)
    └── index.ts               # Barrel file
```

---

## Entry points

| Import | Contenido |
|--------|-----------|
| `@eva_solutions/auth-sdk` | Core: client, types, errors, constantes, JWT, JWKS |
| `@eva_solutions/auth-sdk/hono` | Middleware, auth routes, helpers, device-info |
| `@eva_solutions/auth-sdk/react` | Provider, hooks, authFetch |
| `@eva_solutions/auth-sdk/generic` | verify, cookies (setTokenCookies, clearTokenCookies) — framework-agnostic |

---

## Stack técnico

- **TypeScript** — Tipado estricto
- **jose v6** — JWT verification y JWKS (ES256/ECDSA P-256)
- **zod v4** — Validación de schemas
- **bowser** — User-Agent parsing
- **Peer dependencies** (los tres opcionales): `hono >=4.12.19`, `react >=19.2.6`, `@hono/zod-openapi >=1.4.0` (solo para `/hono-openapi`)
- **tsdown** — Build (ESM + CJS)
- **Vitest** — Tests
- **oxlint / oxfmt** — Lint y formato
- **Changesets** — Versionado y changelog
- **TypeDoc** — Documentación de API generada
- **Node.js** `>=20`, gestor `pnpm`

---

## Runtime y build

- **Runtime**: Edge + Node.js (cero dependencias de Node.js)
- **Build**: tsdown (ESM + CJS), target ES2022, declarations `.d.ts`
- **Configuración**: la URL del Auth Service se fija en runtime → Ver [configuration.md](configuration.md#url-del-auth-service)

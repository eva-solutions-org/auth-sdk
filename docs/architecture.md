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

El Auth Service sirve todas sus rutas bajo `/api/v1`, salvo el JWKS (`/.well-known/jwks.json`) y `/health`, que siguen en la raíz. El SDK antepone el prefijo; `authUrl` no lo lleva.

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
├── constants.ts       # HEADERS (re-export del contrato), COOKIES, JWT_CONFIG, COOKIE_MAX_AGE
├── api-path.ts        # apiPath(): construye la ruta de un descriptor del contrato (rellena {param} y antepone API_PREFIX = /api/v1)
├── parse-error-response.ts  # parseErrorResponse (módulo puro: sin zod, solo `import type`)
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
├── contracts/
│   └── index.ts        # export * from '@eva_solutions/auth-contracts' (se inlinea en el build)
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
| `@eva_solutions/auth-sdk/contracts` | Contrato compartido del wire (schemas, constantes, descriptores de ruta) — ver [Contrato compartido](#contrato-compartido) |

---

## Contrato compartido

El repo es un workspace pnpm con dos paquetes: `packages/auth-sdk` (el SDK publicado) y `packages/auth-contracts` (`@eva_solutions/auth-contracts`, **privado**, nunca se publica). El contrato define una sola vez los schemas, constantes y descriptores de ruta del wire que la API del Auth Service y el SDK deben acordar. Cobertura y exports: [api.md](api.md#eva_solutionsauth-sdkcontracts) y el [README del contrato](../packages/auth-contracts/README.md).

### Cómo llega al consumidor

- El SDK depende del contrato como `devDependency` (`workspace:*`) y lo **inlinea** en el build (`deps.alwaysBundle` en `packages/auth-sdk/tsdown.config.ts`, tanto el JS como los `.d.ts`). Se expone como el subpath `@eva_solutions/auth-sdk/contracts` (ESM y CJS). El tarball del SDK es autocontenido: nada en `dist/` referencia `@eva_solutions/auth-contracts`, y lo vigila CI.
- El SDK consume el contrato desde su `dist` construido, no desde las fuentes: los scripts raíz `type-check` y `test:run` corren antes `build:contracts`. Un `pnpm -r type-check` pelado en un árbol limpio falla con "cannot find module".
- El contrato se compila con `unbundle: true` (un archivo `dist` por módulo fuente) y `"sideEffects": false`, para que el bundler del SDK descarte los módulos del contrato que un entry no usa.
- `zod` es peer del contrato (`^4.6.7`) y dependency del SDK (`^4.6.7`). Los schemas inlineados importan `zod` desde la resolución del consumidor, por lo que el consumidor debe tener **una sola copia** en su lock.

### Prefijo `/api/v1`

`API_PREFIX` (`'/api/v1'`) vive en el módulo PURE `routes.ts`, y los `path` de los descriptores son relativos a él. `apiPath()` (`src/api-path.ts`) devuelve `API_PREFIX + path` con los `{param}` rellenados; `http-client.ts`, `s2s/client.ts` y `admin/client.ts` arman todas sus rutas ahí, así que el prefijo vive en un solo lugar. Quedan fuera de `apiPath()`, en la raíz del Auth Service, `/.well-known/jwks.json` (`jwks.ts`) y `/health` (`http-client.ts`). El prefijo va dentro de los paths y no en `authUrl`: si estuviera en `authUrl`, el JWKS se pediría bajo `/api/v1` y devolvería 404. Las requests a `/internal/*` firman el pathname final, ya con el prefijo. Guía de migración: [migration.md](migration.md#9-rutas-del-auth-service-bajo-apiv1).

### Módulos PURE y SCHEMA

Cada módulo del contrato es de uno de dos tipos:

| Tipo | Módulos | Qué pueden importar | Qué los distingue |
|------|---------|---------------------|-------------------|
| **PURE** | `constants.ts` (códigos de error, nombres de headers, estados de cuenta/actividad/privacidad/entrega, `USERS_BATCH_MAX_IDS`, `EVENT_CODES`, `WEBHOOK_HEADERS`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS`, `SERVICE_CLIENT_SCOPES` y toda constante futura), `routes.ts` | Nada de `zod` ni de módulos SCHEMA; solo datos `as const` y tipos | Importarlos no tiene efectos al cargar |
| **SCHEMA** | `errors.ts`, `common.ts`, `auth.ts`, `users.ts`, `sessions.ts`, `internal-users.ts`, `webhooks.ts`, `service-clients.ts` | `zod` y módulos PURE | Al cargarse ejecutan `.meta()`, que escribe en el registro global de zod: no es tree-shakeable |

### Regla de imports de `react`

El entry `react` tiene un tope de tamaño. Por eso **todo módulo del SDK alcanzable desde `src/react/index.ts` importa del contrato solo valores de módulos PURE o `import type`**, nunca un valor de un módulo SCHEMA. Ejemplos vigentes: `constants.ts` re-exporta `HEADERS`; `error-codes.ts` re-exporta el valor `ERROR_CODES` y toma `CoreErrorCode` con `import type`; `api-path.ts` solo usa `import type`. Los schemas del contrato los alcanzan `contracts` y los módulos de los handlers Hono (`schemas.ts` re-exporta `errorResponseSchema` y las respuestas de login como alias, y solo lo importan `auth-handlers.ts` y `hono-openapi`), no `react`; `react` no debe importar `schemas.ts`.

Los tipos de usuarios y sesiones del SDK son alias `import type` del contrato, sin definición local: `EvaUser` = `PublicProfile`, `EvaSession` = `Session`, `EvaEmpresa` = `Company`, `ActivityState`/`PrivacyState` derivados de `ACTIVITY_STATES`/`PRIVACY_STATES`, y en `s2s/types.ts` `S2SBatchUsersInput` = `UsersBatchRequest`, `S2SBatchUsersResult` = `UsersBatchResponse['data']` y `S2SGetUserResult` = `ProfileResponse['data']`. Los valores son reexports del barrel, solo de módulos PURE: `ACCOUNT_STATES` sale de `account-states.ts` y `USERS_BATCH_MAX_IDS` de `s2s/constants.ts`; las rutas de `http-client.ts` y `s2s/client.ts` se arman con `apiPath(USER_ROUTES.*)`, `SESSION_ROUTES.*` e `INTERNAL_USER_ROUTES.*`. Los tipos de webhooks y de admin también son alias `import type` del contrato cuando el wire y el tipo del SDK coinciden: `WebhookDelivery` = `Delivery`, `RotateWebhookSecretResult` = `RotateSubscriptionSecretResponse['data']`, `ServiceClientPublic`, `CreateServiceClientResult`, `UpdateServiceClientResult` y `RotateSecretResult` (admin), y `CreateWebhookSubscriptionInput`/`UpdateWebhookSubscriptionInput` (s2s). Los valores `EVENT_CODES`, `WEBHOOK_HEADERS` y `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` son reexports del contrato, y las rutas de `admin/client.ts` y `s2s/client.ts` se arman con `apiPath(ADMIN_ROUTES.*)` y `apiPath(WEBHOOK_ROUTES.*)`.

**Tipos propios del SDK (D-28).** Seis tipos se quedan escritos a mano porque son más ergonómicos que el wire y un alias los degradaría: `WebhookSubscription` y `WebhookSubscriptionWithSecret` (`eventCodes: EventCode[]`, el wire es `string[]`), `ListWebhookDeliveriesQuery` (`limit`/`offset` numéricos, el input de `z.coerce` es `unknown`), `CreateServiceClientInput` y `UpdateServiceClientInput` (`scopes: string[]`, el contrato es la tupla del catálogo) y `RestoreUserResult` (`stateAccount: AccountState`, el wire es un literal). `tests/types.test-d.ts` los documenta con `.not.toEqualTypeOf`.

**`S2S_SCOPES` (D-27).** Sigue siendo del SDK (`s2s/constants.ts`) y se fija contra el catálogo con `satisfies Record<string, ServiceClientScope>`: un scope que el contrato no publica deja de compilar.

El chunk `constants` del bundle `react` crece con cada constante PURA nueva (el módulo se conserva entero): al agregar más, vigila el margen del gate de cierre. Tras S3 el cierre mide 11 054 B ESM (tope 11 272, margen 218 B) y 12 099 B CJS (tope 12 380, margen 281 B); S3 sumó unos 620 B en cada formato, casi todo del chunk `constants`. Si un cambio posterior cae sobre el tope, el fallback previsto (D-IF-4) es partir `constants`/`routes` por área sin crear un subpath nuevo; hoy no se aplica porque el gate pasa. Ojo con `api-path.ts`: hoy solo lo importa `http-client.ts` (no `react`), pero si `react` llegara a alcanzarlo con un import por valor del contrato, el chunk PURO `routes` (ahora con `WEBHOOK_ROUTES` y `ADMIN_ROUTES`) entraría al cierre.

Consecuencia: `parseErrorResponse` vive en su propio módulo puro, `src/parse-error-response.ts` (sin `zod`, solo `import type`), y no en `schemas.ts`; `react/auth-fetch.ts`, `http-client.ts`, `admin/client.ts` y `s2s/client.ts` lo importan de ahí.

La regla se hace cumplir en dos puntos: un test del contrato que falla si `constants.ts` o `routes.ts` importan `zod` o un módulo SCHEMA, y el gate `react-closure-size.mjs` (CI y `prepack`; mide el cierre ESM y el CJS por separado) con `--max`, `--max-cjs` y `--forbid '\.meta\('` (cómo leer un fallo: [CONTRIBUTING.md](../CONTRIBUTING.md#react-entry-closure-gate)).

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

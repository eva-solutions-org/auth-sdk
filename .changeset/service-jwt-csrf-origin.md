---
'@eva_solutions/auth-sdk': minor
---

CSRF por `Origin` en las rutas con cookies, verificador de JWT de servicio y zod 4.6.7.

- `evaAuthRoutes` y `evaAuthOpenAPIRoutes` verifican `Origin` en las mutaciones (`POST`, `PATCH`, `PUT`, `DELETE`): un origen ajeno responde 403 `forbidden` sin llegar al handler. Por defecto pasa el mismo host que la request (el esquema no cuenta, por los proxies que terminan TLS); la opción nueva `allowedOrigins` agrega orígenes (coincidencia exacta; `'*'` lanza). Sin `Origin` pasa (clientes que no son navegador). Un front en otro origen, incluido otro puerto de `localhost`, debe listarse en `allowedOrigins`. Nueva key de mensajes `originNotAllowed` (`Origen no permitido`).
- Nuevo `verifyServiceJwt` en `@eva_solutions/auth-sdk/s2s` y middleware `serviceJwtAuth` en `@eva_solutions/auth-sdk/hono` (más `SERVICE_JWT_TYP`, `SERVICE_JWT_MAX_LIFETIME_SECONDS`, `SERVICE_JWT_CLOCK_TOLERANCE_SECONDS`): verifican las llamadas que el Auth Service firma con un JWT ES256 (`typ: 'svc+jwt'`, `iss: 'auth-service'`, `aud` del receptor, `scope`, `jti` con `replayCache` obligatorio y `bsha`, el SHA-256 base64url del body crudo) contra el JWKS remoto. Un access token de usuario no pasa. `verifyS2SRequest` no cambia. Contrato en `docs/api.md` y ADR-019.
- Los arrays de los request del contrato ya no son ilimitados: `ids` del batch de usuarios acepta hasta `USERS_BATCH_MAX_IDS` (100, y el OpenAPI publica `maxItems`), `scopes` de los service clients hasta 16 y `eventCodes` de las subscriptions hasta 32 (repetidos incluidos). Más allá responde 400.
- `zod` sube a `^4.6.7` (GHSA-mrhx-c7xc-m3w5); el `zod` de los consumidores debe cumplir ese rango.

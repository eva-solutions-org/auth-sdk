# Modelo de seguridad

## Cookies

| Cookie | Max-Age | HttpOnly | Secure | SameSite | Path |
|--------|---------|----------|--------|----------|------|
| `eva_access_token` | 900 (15 min) | Sí | Sí* | Lax | `/` |
| `eva_refresh_token` | 2592000 (30 días) | Sí | Sí* | Lax | `/` |

\* `Secure=false` solo cuando `EVA_BUILD_ENV=local`. En `development` es `true` — se espera HTTPS. → [ADR-002, ADR-007](decisions.md)

- Tokens **nunca** accesibles por JavaScript (HttpOnly)
- `SameSite=Lax`: POST desde sitios externos bloqueados
- Valores decodificados con `decodeURIComponent()` en parsing, con fallback al valor raw si el encoding es inválido (previene crasheo por cookies malformadas)
- Cookies se limpian **solo después de confirmar éxito** en el Auth Service

---

## JWT Verification

Verificación local con **ES256** (ECDSA P-256) usando jose v6.

Claims validados:

| Claim | Valor esperado |
|-------|----------------|
| `iss` | `auth-service` |
| `aud` | `proyecto-global` |
| `exp` | No expirado |
| `nbf` | No antes de |

---

## JWKS Cache

| Parámetro | Valor |
|-----------|-------|
| Cache TTL | 24 horas |
| Max TTL (fallback) | 25 horas |
| Revalidación | ETag / HTTP 304 |

Si el cache supera 25 horas sin actualización exitosa → **verificación rechazada**. No se usa key potencialmente revocada. → [ADR-005](decisions.md)

---

## Deduplicación de requests

### Token refresh

`Map<string, Promise>` a nivel de módulo en `refresh-dedup.ts`, keyed por `refreshToken`. Si múltiples requests llegan con access token expirado, solo una ejecuta el refresh. Las demás esperan el resultado. → [ADR-004](decisions.md)

Aplica en: `hono/middleware.ts`, `hono/auth-routes.ts`, `generic/verify.ts` (todos consumen `refresh-dedup.ts`).

### JWKS fetch

Variable `pendingFetch` a nivel de módulo en `jwks.ts`. Múltiples verificaciones simultáneas → solo un fetch.

---

## Request timeouts

| Operación | Timeout |
|-----------|--------|
| HTTP Client (Auth Service) | 10 segundos |
| JWKS fetch | 5 segundos |

Implementados con `AbortSignal.timeout()`.

---

## Validación

### Input
- JSON parsing con error diferenciado (`"JSON inválido en el body"`) antes de la validación de schema
- `phone` y `code`: validación de tipo y formato (schema Zod)
- Body de `PATCH /me`: validado como objeto no vacío
- User-Agent truncado a **500 caracteres**

### Response
- Estructura `{ data: T }` del Auth Service validada en runtime

### Safe status cast
Auth-routes usa `Set` de status codes HTTP conocidos. Status inesperado → fallback `500`.

---

## Error handling

- Errores del Auth Service se propagan **sin sanitizar** al frontend → [ADR-001](decisions.md)
- HTTP 429 (rate limiting) pasa **transparente** — el SDK no implementa rate limiting propio

# Modelo de seguridad

## Cookies

| Cookie | Max-Age | HttpOnly | Secure | SameSite | Path |
|--------|---------|----------|--------|----------|------|
| `eva_access_token` | 900 (15 min) | Sí | Sí | Lax | `/` |
| `eva_refresh_token` | 2592000 (30 días) | Sí | Sí | Lax | `/` |

`Secure` es **siempre** `true`, en todos los entornos y también al limpiar las cookies, aunque la `authUrl` sea `http://localhost`. Costo: Safari descarta cookies `Secure` sobre `http://localhost`, así que en desarrollo local se sirve la app por https. → [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre) (enmienda ADR-002 y ADR-007)

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
| Cache TTL (`cacheMaxAge`) | 24 horas |
| Cooldown entre re-fetches | 30 segundos |
| Timeout de fetch | 5 segundos |
| Revalidación | Re-fetch completo (sin ETag) |

Mientras el endpoint JWKS esté online: re-fetch transparente tras expiración del TTL, sin interrupción. Si el endpoint cae exactamente cuando el TTL expira: **verificación rechazada** (fail-closed). No se usa key potencialmente revocada tras expiración. Kid-matching RFC 7517 automático — soporte transparente de rotación multi-clave. → [ADR-016](decisions.md)

---

## Deduplicación de requests

### Token refresh

`Map<string, Promise>` a nivel de módulo en `refresh-dedup.ts`, keyed por `refreshToken`. Si múltiples requests llegan con access token expirado, solo una ejecuta el refresh. Las demás esperan el resultado. → [ADR-004](decisions.md)

Aplica en: `hono/middleware.ts`, `hono/auth-routes.ts`, `generic/verify.ts` (todos consumen `refresh-dedup.ts`).

### JWKS fetch

Deduplicación interna de `createRemoteJWKSet` (jose) en `jwks.ts`. Múltiples verificaciones simultáneas → solo un fetch. Cooldown de 30s entre re-fetches anti-abuse.

---

## S2S: firma HMAC y anti-replay

El SDK es dueño del algoritmo de firma S2S (canonical de 7 líneas, ver [api.md](api.md#eva_solutionsauth-sdks2s)). Puntos de seguridad:

- **Nonce por request** (`x-eva-nonce`): 16 bytes de `crypto.getRandomValues` como 32 hex en minúsculas, parte de la firma. Antes el anti-replay se apoyaba en timestamp + firma, y dos requests idénticos en el mismo segundo producían la misma firma (colisión o falso replay).
- **Formato canónico estricto**: el verificador valida `^[0-9a-f]{32}$` sin flag `/i` y rechaza con `nonce_malformed`; no normaliza. Es el contrato canónico y defensa en profundidad: una implementación que normalizara el valor podría derivar claves de replay distintas del valor realmente firmado. Reescribir el nonce en otra capitalización no evade el replay por sí solo, porque el nonce va dentro del canonical firmado y rompería el HMAC (`signature_invalid`). Se valida antes del HMAC porque no depende del secreto.
- **Clave de replay** `${clientId}:${nonce}` (sin ambigüedad: el nonce es un sufijo de largo fijo, 32 hex, que no contiene `:`; el SDK no valida el formato del clientId).
- **TTL del replayCache** `2 * timestampWindowSeconds + 1`. Con el TTL anterior (igual a la ventana) una clave podía expirar mientras el request aún era aceptable por timestamp, abriendo una ventana de replay.
- **El anti-replay solo existe con `replayCache`** compartido entre instancias y atómico; sin él, un request capturado se puede reenviar durante la ventana.
- **Vector de paridad (KAT)**: `tests/s2s-nonce.mock.test.ts` (test `KAT: canonical y firma literales`) trae un canonical y una firma literales calculados de forma independiente con `node:crypto`. Cualquier otro repo que verifique o firme S2S por su cuenta debe reproducirlos.
- Decisión y alternativas: [ADR-018](decisions.md#adr-018-nonce-obligatorio-en-las-firmas-s2s-x-eva-nonce).

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
- `authUrl`: solo https (o http en loopback), sin userinfo, query ni fragmento; inmutable una vez fijada; los mensajes de error no repiten el valor recibido (CWE-319) → [configuration.md](configuration.md#url-del-auth-service)

### Response
- Estructura `{ data: T }` del Auth Service validada en runtime

### Safe status cast
Auth-routes usa `Set` de status codes HTTP conocidos. Status inesperado → fallback `500`.

---

## Error handling

- Errores del Auth Service se propagan **sin sanitizar** al frontend → [ADR-001](decisions.md)
- HTTP 429 (rate limiting) pasa **transparente** — el SDK no implementa rate limiting propio
- `authUrl` no configurada: el error de configuración (`EvaAuthConfigError`) se **propaga** (el consumidor responde 500) en vez de convertirse en 401 o en error de red, y no se emiten ni limpian cookies. → [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre)

---

## Reporting Vulnerabilities

If you discover a security vulnerability in this SDK, please **do not open a public GitHub issue**.

**Preferred channel**: Use GitHub Security Advisories to report privately:
[https://github.com/eva-solutions-org/auth-sdk/security/advisories/new](https://github.com/eva-solutions-org/auth-sdk/security/advisories/new)

**Alternate contact**: arturo.rodas.gonzales@gmail.com (PGP not required; plain email is fine for initial contact).

**Response timeline**:
- Acknowledgement: within 72 hours of report.
- Status update: within 30 days.
- Full resolution target: within 90 days (coordinated disclosure).

We follow responsible disclosure — we will coordinate a fix and publish a GitHub Security Advisory before or simultaneously with any public disclosure.

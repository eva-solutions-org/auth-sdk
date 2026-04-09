# Modelo de seguridad

## Cookies HttpOnly

Tokens **NUNCA** accesibles por JavaScript en el frontend. Ambas cookies (`eva_access_token`, `eva_refresh_token`) tienen el flag `HttpOnly`.

---

## Cookie Secure

`Secure=true` siempre, excepto cuando `NODE_ENV=local`.

En `development` el flag es `true` — se espera HTTPS incluso en desarrollo. Ver [decisions.md](decisions.md).

---

## SameSite=Lax

Protección parcial contra CSRF. Requests `POST` desde sitios externos se bloquean. Las cookies solo se envían en navegación directa (top-level) y requests same-site.

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

## JWKS Auto-refresh

| Parámetro | Valor |
|-----------|-------|
| Cache TTL | 24 horas |
| Max TTL (fallback) | 25 horas |
| Revalidación | ETag / HTTP 304 |

Si el cache supera 25 horas sin actualización exitosa, la verificación se **rechaza**. No se usa una key potencialmente revocada.

---

## Token rotation y deduplicación

El middleware deduplica refresh requests concurrentes usando una **Promise compartida a nivel de módulo**. Si múltiples requests llegan con un access token expirado simultáneamente, solo una ejecuta el refresh contra el Auth Service. Las demás esperan el resultado de la primera.

Esto evita race conditions donde múltiples requests intentan usar el mismo refresh token.

---

## Input validation

- JSON parsing envuelto en try/catch
- Validación de tipo y formato para `phone` y `code`
- Body de `PATCH /me` validado como objeto
- User-Agent truncado a **500 caracteres** antes de enviar al Auth Service

---

## Cookie lifecycle

Las cookies se limpian **SOLO después de confirmar éxito** de la operación en el Auth Service. Nunca se borran preventivamente.

---

## Response validation

La estructura `{ data: T }` del Auth Service se valida en runtime antes de usar el contenido.

---

## Rate limiting

HTTP 429 del Auth Service pasa **transparente** al frontend. El SDK no implementa rate limiting propio.

---

## Error messages

Los mensajes de error del Auth Service se propagan **tal cual** al frontend. Decisión intencional para preservar la UX del consumidor. Ver [decisions.md](decisions.md).

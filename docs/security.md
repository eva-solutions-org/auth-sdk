# Modelo de seguridad

## Cookies

| Cookie | Max-Age | HttpOnly | Secure | SameSite | Path |
|--------|---------|----------|--------|----------|------|
| `eva_<producto>_access_token` | 900 (15 min) | Sí | Sí | Lax | `/` |
| `eva_<producto>_refresh_token` | 2592000 (30 días) | Sí | Sí | Lax | `/` |

`<producto>` es el slug de `configureEvaAuth({ product })`: dos productos bajo el mismo dominio padre no se pisan las cookies.

`Secure` es **siempre** `true`, en todos los entornos y también al limpiar las cookies, aunque la `authUrl` sea `http://localhost`. Costo: Safari descarta cookies `Secure` sobre `http://localhost`, así que en desarrollo local se sirve la app por https. → [ADR-017](decisions.md#adr-017-auth-url-en-runtime-errores-de-configuración-propagados-y-secure-siempre) (enmienda ADR-002 y ADR-007)

- Tokens **nunca** accesibles por JavaScript (HttpOnly)
- `SameSite=Lax`: POST desde sitios externos bloqueados
- **CSRF por `Origin`** en las mutaciones de `evaAuthRoutes`/`evaAuthOpenAPIRoutes`: `SameSite=Lax` no frena a otro origen del mismo *site* (subdominios). Mismo host por defecto, orígenes extra en `allowedOrigins`; ver [api.md](api.md#csrf-por-origin)
- Valores decodificados con `decodeURIComponent()` en parsing, con fallback al valor raw si el encoding es inválido (previene crasheo por cookies malformadas)
- Cookies se limpian **solo después de confirmar éxito** en el Auth Service

---

## JWT Verification

Verificación local con **ES256** (ECDSA P-256) usando jose v6.

Claims validados:

| Claim | Valor esperado |
|-------|----------------|
| `iss` | `auth-service` |
| `aud` | El producto configurado (`configureEvaAuth({ product })`) |
| `client_id` | Obligatorio (RFC 9068): el producto |
| `typ` (header) | `at+jwt` |
| `kid` (header) | Obligatorio, con prefijo `usr-`: un token sin `kid` o con `kid` `svc-` se rechaza antes de buscar una clave |
| `exp` | No expirado |
| `nbf` | No antes de |

---

## JWKS Cache

| Parámetro | Valor |
|-----------|-------|
| Cache TTL (`cacheMaxAge`) | 10 minutos |
| Cooldown entre re-fetches | 30 segundos |
| Timeout de fetch | 5 segundos |
| Revalidación | Re-fetch completo (sin ETag) |

Mientras el endpoint JWKS esté online: re-fetch transparente tras expiración del TTL, sin interrupción. Si el endpoint cae exactamente cuando el TTL expira: **verificación rechazada** (fail-closed). No se usa key potencialmente revocada tras expiración. Kid-matching RFC 7517 automático — soporte transparente de rotación multi-clave. El TTL de 10 min acota cuánto tiempo siguen aceptando los receptores una clave retirada (por ejemplo ante un compromiso). Un `kid` desconocido fuerza una recarga, respetando el cooldown. → [ADR-016](decisions.md), [ADR-020](decisions.md#adr-020-identidad-fase-1-tokens-de-servicio-token-de-usuario-por-producto-y-empresas)

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
- **Query malformado falla cerrado**: un query con percent-encoding inválido (`?a=%ZZ`) se rechaza con `signature_invalid` por el mismo camino que una firma inválida (secreto y HMAC incluidos, `replayCache` intacto); nunca llega a 500. Un secreto no hex devuelto por `secretStore` es un error de configuración y se lanza de forma explícita, sin incluir el secreto en el mensaje.
- **Vector de paridad (KAT)**: `packages/auth-sdk/tests/s2s-nonce.mock.test.ts` (test `KAT: canonical y firma literales`) trae un canonical y una firma literales calculados de forma independiente con `node:crypto`. Cualquier otro repo que verifique o firme S2S por su cuenta debe reproducirlos.
- Decisión y alternativas: [ADR-018](decisions.md#adr-018-nonce-obligatorio-en-las-firmas-s2s-x-eva-nonce).

---

## Admin: firma HMAC de un service client `esAdmin`

`createAdminClient` firma cada request con `signS2SHeaders` (mismas reglas que la sección anterior: nonce por request, timestamp, canonical de 7 líneas con el query y los bytes exactos del body) con el `clientId` y el `secretHex` de un service client con la marca `esAdmin` (ya no es un scope: `admin` no es concedible para `auth-api`). Puntos de seguridad:

- **Sin credencial global ni secreto estático en el viaje**: ya no existe `adminPassword` ni el header `x-admin-password`; el secret no viaja, solo la firma. Una persona, un client: se revoca deshabilitando o borrando su client, y el API registra el slug que firmó.
- **Anti-replay**: lo aplica el Auth Service con su `replayCache`; el SDK solo garantiza un nonce nuevo por llamada.
- **Último admin**: el API responde `409 last_admin_client` ante una operación que dejaría al sistema sin un client admin habilitado (`ADMIN_ERROR_CODES.last_admin_client`).
- **Solo backend u operador**: el secret del client admin da control total sobre los service clients; nunca va al navegador ni a un repositorio. `baseUrl` sigue exigiendo https (o loopback).

---

## Token de servicio (client credentials)

`createServiceTokenProvider` pide el token y `verifyServiceToken` / `serviceTokenAuth` lo verifican (contrato en [api.md](api.md#verificación-de-token-de-servicio-verifyservicetoken--servicetokenauth)). Puntos de seguridad:

- **Dos claves de firma separadas de verdad**: el JWKS publica una clave de usuario (`kid` `usr-…`) y una de servicio (`kid` `svc-…`). Cada verificador solo considera las claves de su prefijo y rechaza los tokens sin `kid`. Un token firmado con la clave de servicio bajo un `kid` `usr-` falla la firma, y al revés; hay un test por cada combinación.
- **Tipado explícito** (RFC 8725 §3.11, RFC 9068 §2.1): usuario `typ: at+jwt`, servicio `typ: svc-at+jwt`. Cada verificador exige el suyo.
- **Audiencias disjuntas**: el token de usuario lleva `aud` = producto; el de servicio, una audiencia de servicio. `verifyServiceToken` solo acepta audiencias del catálogo y un permiso que no sea de esa audiencia lanza `TypeError`. `admin` no es un permiso de `auth-api`.
- **Identidad estable**: `sub` es el id interno del service client (no cambia ni se reutiliza); `client_id` (slug) es solo informativo. Los registros del receptor se indexan por `sub`.
- **Vida corta y sin replay cache**: 300 s (60 s el token que Auth acuña por cada OTP), tolerancia de reloj de 5 s. Es reutilizable dentro de su vida: lo acotan la audiencia, el permiso y la vida. Revocar una concesión no afecta a los tokens ya emitidos (siguen valiendo hasta 300 s); para cortar de inmediato, deshabilitar el client.
- **El secreto HMAC solo sirve para pedir tokens**: vive en Auth y en el servicio, y firma `POST /internal/token` (y la superficie `/admin`). El proveedor mide el vencimiento con `expires_in`, no con el `exp` contra el reloj local.
- **Solo ES256**: `algorithms` fijo; un `alg` distinto se rechaza aunque el JWKS tenga una clave válida de otro algoritmo.
- **Fallos de infraestructura no son rechazos**: JWKS inalcanzable o `authUrl` sin configurar lanzan (500), no devuelven 401.

## Delegación: token delegado (token exchange)

`provider.exchangeToken` pide el token y `verifyDelegatedToken` / `delegatedTokenAuth` lo verifican ([api.md](api.md#verificación-de-token-delegado-verifydelegatedtoken--delegatedtokenauth)). Puntos de seguridad:

- **Tres tipos, separados por `typ` y `kid`**: usuario (`at+jwt`, `usr-`), servicio (`svc-at+jwt`, `svc-`) y delegado (`dlg-at+jwt`, `svc-`). Ningún verificador acepta el tipo de otro; un test cruza los tres tipos con los dos prefijos contra los tres verificadores y solo acepta la diagonal.
- **Una audiencia, nunca `auth-api`**: un `aud` arreglo se rechaza aunque contenga la audiencia propia. Las aristas y los permisos delegables salen de un catálogo cerrado donde `auth-api` y `admin` no existen; las opciones inválidas lanzan `TypeError` al construir.
- **Empresa obligatoria**: un delegado sin `empresa` (o sin `producto` / `sid`) se rechaza (`claims_invalid`). La delegación sin empresa no existe en esta fase.
- **Cadena acotada**: `act` de 1 a 3 niveles; una cadena más profunda se rechaza. Auth revalida la sesión, el usuario, la pertenencia, la empresa y la contratación en cada salto, así cerrar sesión o dar de baja corta la delegación en ≤ 120 s.
- **El caché de `exchangeToken` no confía en claims sin verificar**: la llave lleva una huella SHA-256 del `subjectToken` completo (no sus claims), así que un token falsificado no puede leer la entrada de otra persona y un re-exchange desde otro token de la cadena (otro `jti`) nunca reutiliza una entrada obtenida con otro que sí cumplía `requiere_scope_origen`. El SDK no verifica el `subjectToken`: pásalo ya verificado.
- **Ante Auth no se usan delegados**: toda acción de una persona sobre una empresa va con el token de servicio del producto más el access token de la persona (`subjectToken`), así ningún servicio intermedio puede ejercer el rol de la persona. El `subjectToken` va en el body, o en el header `x-eva-subject-token` en el único `GET` que lo necesita; nunca en la URL.
- **Riesgo aceptado**: el token delegado no está atado al emisor (sin DPoP): quien lo robe lo usa hasta 120 s ante su `aud`. El servicio destino no ve los roles del producto.
- **Caché de autorizaciones (30 s)**: una revocación o una baja de empresa tardan como máximo eso en notarse en un servicio que usa `checkAutorizacion`.

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

### Cache
- `POST /get-code` y `POST /login` (`evaAuthRoutes` y `evaAuthOpenAPIRoutes`) responden `Cache-Control: no-store` en éxito y en error: llevan el `challengeId` y las cookies de sesión, y no deben quedar en cachés intermedias ni del navegador → [api.md](api.md#evaauthroutesopts-evaauthroutesoptions)
- El header se fija por **dos mecanismos**, uno por variante:
  - **`evaAuthRoutes` (variante plana)**: el propio handler, como primera sentencia. Cubre el 200, el 400 por JSON o schema inválido y los errores del Auth Service.
  - **`evaAuthOpenAPIRoutes`**: el validador responde el 400 *antes* de que corra el handler, así que el header del handler no llega a aplicarse. Lo fija un **middleware de ruta** registrado antes del validador (que además pre-valida que el body sea JSON y, si no lo es, responde el 400 de la variante plana con el header ya puesto) y, para el 400 de schema, el **`defaultHook`** del `OpenAPIHono`, que devuelve el mismo cuerpo `{ error: { code: 'bad_request', message } }` de la variante plana, sin filtrar el `ZodError`.
- **Coincidencia exacta**: ambos mecanismos de la variante OpenAPI actúan solo sobre los `POST /get-code` y `POST /login` que registra el propio SDK, no por sufijo del path. Una ruta propia del consumidor (por ejemplo `/admin/login` o `/sms/get-code`) no hereda el header ni los mensajes del SDK: conserva su validación y su respuesta. El prefijo donde se monte la sub-app es irrelevante.

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

# Changelog

## 3.0.0

### Major Changes

- 5b11aea: `createAdminClient` signs with HMAC S2S instead of sending a password, `admin` scope, and `republishPendingWebhooks`.

  - **Breaking:** `AdminClientConfig` is now `{ clientId, secretHex, baseUrl }` (it was `{ adminPassword, baseUrl }`). Every admin request is signed with `signS2SHeaders` using the credentials of a service client that holds the `admin` scope; the `x-admin-password` header is no longer sent. The Auth Service rejects that header and requires the signature on `/api/v1/admin/*`, so ship this version together with the Auth Service that enforces it.
  - `SERVICE_CLIENT_SCOPES` (contract) and `S2S_SCOPES` add `admin` (`S2S_SCOPES.ADMIN`). `POST` / `PATCH /admin/service-clients` now accept it, and a client without it gets 403 on `/admin/*`.
  - New `AdminClient.republishPendingWebhooks({ older_than_minutes?, limit? })` for `POST /api/v1/admin/webhooks/republish-pending`. The two options travel in the signed query string (defaults and ranges are the API's: 10 minutes, at most 10080; `limit` 1 to 100, default 100). It returns `{ republished, hasMore }`; call again while `hasMore` is true. A 503 `service_unavailable` means QStash did not take the batch and the deliveries stay `pending`.
  - Contract: `ADMIN_ROUTES.republishPendingWebhooks`, `republishPendingQuerySchema` and `republishPendingResponseSchema` (+ `RepublishPendingQuery`, `RepublishPendingResponse`). New admin entry point types `RepublishPendingWebhooksQuery` and `RepublishPendingWebhooksResult`.
  - `ADMIN_ERROR_CODES` (and `AdminErrorCode`) adds `last_admin_client`: deleting, disabling or removing the `admin` scope from the last enabled admin client answers 409 and is not applied. Only code that exhaustively switches over `AdminErrorCode` needs a new case.

  **Migration**: create a service client with the `admin` scope (the Auth Service bootstrap script creates the first one), keep its secret in your secret manager, and replace `adminPassword` with `clientId` and `secretHex`. See `docs/migration.md`, section 12.

- 635f1f1: Identity phase 1: service tokens, a user token per product, and companies with branches (ADR-020). Nothing is in production, so the changes are incompatible on purpose.

  - **User token per product.** `configureEvaAuth({ product })` (required only by the login routes, the session cookies and `verifyAccessToken`; a service that only verifies service tokens does not need it). `verifyAccessToken` now requires `typ: at+jwt`, a `kid` with the `usr-` prefix and `aud` equal to the product, and returns `{ id, sessionId, clientId, empresaId? }` (`client_id` is mandatory, `empresa` is the optional active company). **Breaking:** the cookies are `eva_<product>_access_token` / `eva_<product>_refresh_token` (`COOKIES` is replaced by `getCookieNames()`; existing sessions restart), `JWT_CONFIG.AUDIENCE` (`proyecto-global`) is gone, and the login sends `producto` (always the configured one, never one from the browser) and the optional `empresaId`. `createHttpClient().setActiveEmpresa()` calls `POST /auth/empresa-activa`. The `GET /user/empresas` items carry `sucursales`.
  - **Two signing key types.** The JWKS resolver now rejects tokens without `kid` and only offers jose the keys whose `kid` has the prefix of the token type (`usr-` user, `svc-` service). The JWKS cache is 10 minutes (it was 24 hours).
  - **Service tokens (client credentials).** New `createServiceTokenProvider({ authUrl, clientId, secretHex, audience, scope? })` with `getToken()` and `invalidate(rejectedToken?)`: it asks `POST /internal/token` (HMAC-signed), measures expiry with `expires_in`, renews 30 s early and de-duplicates concurrent requests (N simultaneous 401s for the same token cause one renewal; a joiner of an orphaned Workers request stops waiting after 11 s). It validates its config when created. New `verifyServiceToken(token, { audience, requiredScope | anyScope })` and the Hono middleware `serviceTokenAuth` (`typ: svc-at+jwt`, `kid` `svc-`, one audience, `sub` as identity, `client_id` as slug; they set `serviceClientId`, `serviceClientSlug` and `serviceScopes`; `scopeCheck: 'deferred'` plus `requireScope` gives a per-route permission; options are validated at construction; the `Bearer` scheme is case-insensitive). **Breaking:** `verifyServiceJwt`, `serviceJwtAuth` and their `SERVICE_JWT_*` constants (`svc+jwt` with `bsha` and a replay cache) are removed.
  - **`createS2SClient` sends Bearer.** **Breaking:** its config is `{ baseUrl, tokenProvider }` (no `clientId` / `secretHex`); a 401 invalidates the token and retries once. New methods `createEmpresa`, `getEmpresa`, `addEmpresaMember`, `removeEmpresaMember` and `createSucursal` for the internal companies API. The HMAC helpers (`signS2SHeaders`, `verifyS2SRequest`, `s2sAuth`, ...) stay: the token endpoint and `/admin` still use them.
  - **Admin client.** **Breaking:** service clients no longer have `scopes`; `createServiceClient` / `updateServiceClient` take `esAdmin`, and `ServiceClientPublic` carries `esAdmin` and `grants`. New `listServiceClientGrants`, `setServiceClientGrant` and `deleteServiceClientGrant`. `S2S_SCOPES` drops `ADMIN` and adds `EMPRESAS_LEER` and `EMPRESAS_ESCRIBIR`.
  - **Contract (`/contracts`).** New closed catalog of service audiences and their permissions (`SERVICE_AUDIENCE_SCOPES`: `auth-api` without `admin`, `whatsapp-api` with it), token vocabulary (`TOKEN_ISSUER`, `USER_TOKEN_TYP`, `SERVICE_TOKEN_TYP`, kid prefixes, lifetimes, reserved slugs), the token endpoint schemas (RFC 6749 / 8707 shapes), grants, the internal companies API, `producto` / `empresaId` in the login, the active company switch, and the events `empresa.created`, `empresa.member_added`, `empresa.member_removed` and `empresa.branch_created`. `SERVICE_CLIENT_SCOPES` is removed. The `react` closure budget goes from 11 272 to 11 800 B (ESM). See `docs/migration.md`, section 13.

- f7d7a7e: Identity phase 2: company roles, delegation (token exchange), contracts, directory, authorizations and groups (ADR-021). Nothing is in production, so the changes are incompatible on purpose, also over the phase 1 companies API. Requires an Auth Service with the `identidad-fase2` design.

  - **Delegation (RFC 8693).** New `provider.exchangeToken({ subjectToken, audience, scope? })` on the service token provider: it exchanges the user's access token (or a delegated one, for a re-exchange) for a delegated token (`typ: dlg-at+jwt`, 120 s, one `aud`, `act` chain of up to 3 actors, mandatory `empresa` / `producto` / `sid`). It authenticates with its own `auth-api` / `tokens:exchange` service token, returns a `Result` (`invalid_grant` is a normal answer) and caches per isolate until 30 s before `exp`. **The cache key is the audience, the scope and a SHA-256 fingerprint of the whole subject token**, not its unverified claims, so a forged token cannot read another person's entry and a re-exchange from another token of the chain (other `jti`) never reuses one (deliberate refinement of the design key; see ADR-021). New `verifyDelegatedToken` and the Hono middleware `delegatedTokenAuth` (`typ: dlg-at+jwt`, `kid` `svc-`, one `aud`, company required; context `userId`, `empresaId`, `producto`, `sessionId`, `actorChain`, `scopes`). No verifier accepts the type of another (tested for the three types against both `kid` prefixes). **Breaking:** `ServiceTokenProvider` now includes `exchangeToken`; `S2SClientConfig.tokenProvider` is the new `ServiceTokenSource` (`getToken` + `invalidate`), so hand-made providers keep working.
  - **S2S client.** **Breaking:** `createEmpresa` takes `subjectToken` and loses `primerMiembroUserId`; `addEmpresaMember(id, { userId, subjectToken })`, `removeEmpresaMember(id, userId, { subjectToken })`, `createSucursal` carries `subjectToken`; `getEmpresa` answers a `completa` or `recortada` view (`data.vista`). Every action of a person on a company sends the person's access token as `subjectToken` (body, or the `x-eva-subject-token` header on the only `GET` that needs it). New methods: `updateEmpresa`, `listEmpresas`, `bajaEmpresa`, `reactivarEmpresa`, `setEmpresaMemberRole`, `updateSucursal`, `deactivateSucursal`, `requestContratacion`, `cancelContratacion`, `getContratacion`, `setContratacion`, `createGrupo`, `renameGrupo`, `addGrupoEmpresa`, `removeGrupoEmpresa`, `searchDirectorio`, `createAutorizacion`, `deleteAutorizacion`, `listAutorizaciones` and `checkAutorizacion` (30 s cache per client). `S2S_SCOPES` adds `TOKENS_EXCHANGE`, `CONTRATACIONES_PEDIR`, `CONTRATACIONES_ESCRIBIR`, `CONTRATACIONES_LEER`, `EMPRESAS_BAJA`, `AUTORIZACIONES_ESCRIBIR`, `AUTORIZACIONES_LEER` and `DIRECTORIO_LEER`.
  - **Admin client.** `ServiceClientPublic` and the creation answer carry `producto` and `audiencia` (settable on create and update). New `listServiceClientDelegations`, `setServiceClientDelegation`, `deleteServiceClientDelegation` (`requiere_scope_origen`), `getProductoPermisosAutorizables`, `setProductoPermisosAutorizables`, `reassignEmpresaTitular`, `bajaEmpresa`, `reactivarEmpresa` and `setContratacion`.
  - **User HTTP client.** New `getDirectorio` (`GET /directorio`). `EvaEmpresa` carries `rol`, `grupo` and `contratado`; the companies where the person is holder without the product contracted come as `contratado: false` with no contact data.
  - **Contract (`/contracts`).** `auth-api` gains the seven phase 2 permissions; new closed catalog of permissions BETWEEN companies (`INTER_EMPRESA_PERMISSIONS`) apart from the service permissions; `DELEGABLE_AUDIENCE_SCOPES` (never `auth-api`, never `admin`); delegated token vocabulary; schemas and routes for token exchange, company roles, the adapted internal companies API, contracts, groups, directory, authorizations, delegation edges, authorizable permissions and holder reassignment; 12 new webhook events (`empresa.updated`, `deactivated`, `reactivated`, `member_role_changed`, `branch_updated`, `branch_deactivated`, `product_changed`; `grupo.*`; `autorizacion.*`) with id-only payloads. `EVENT_CODES` moves to its own pure module, so the `react` closure goes down (11 431 B ESM) instead of up. See `docs/migration.md`, section 14.
  - **Review fixes.** A failure of the person's token answers `403 subject_token_invalid` (`SUBJECT_TOKEN_INVALID_CODE`); `createS2SClient` drops the service token and retries only on a `401` of the service Bearer, never for that code. New permission `contrataciones:pedir` (a product asks for or cancels its own contract); `contrataciones:escribir` is billing only. `verifyDelegatedToken` requires `jti` and a first-level `client_id` equal to `act.client_id`. `exchangeToken` shares in-flight identical requests. The four phase 1 `empresa.*` events also have id-only payload schemas. New `TOKEN_BEARING_KEYS` lists the keys the Auth API must redact in logs.

- 4aa64db: OTP login challenge: `get-code` now returns a `challengeId` that `/login` requires.

  - `POST /get-code` responds `{ data: { message, challengeId } }`. The `challengeId` is opaque, tied to the code just issued, and every new `get-code` invalidates the previous one. The browser-facing handler passes it through unchanged; `http-client.getCode` returns `Result<{ message: string; challengeId: string }>`.
  - `POST /login` requires `challengeId` in the body (`LoginSchema` adds `challengeId: z.string().min(1)`). A request without it fails with 400 `malformed` before reaching the Auth Service. `http-client.login` now takes `challengeId` and sends it.
  - React: `login.getCode` returns `Result<{ message; challengeId }>` and `login.verify({ phone, code, challengeId })` forwards it. The provider stays stateless and never stores the challenge.
  - OpenAPI (`/hono-openapi`): the `get-code` 200 response documents `message` and `challengeId`.
  - The `get-code` and `login` handlers of `evaAuthRoutes` / `evaAuthOpenAPIRoutes` now answer `Cache-Control: no-store` on every response (success and error), since they carry the `challengeId` and session cookies. In the OpenAPI variant the validation 400s (invalid or malformed body) of `get-code` / `login` now use the same `{ error: { code, message } }` wire as the plain variant instead of exposing a `ZodError`. This applies only to the SDK's own `POST /get-code` and `POST /login` (exact route match, any mount prefix); routes the consumer adds to the same sub-app keep their own validation and default 400.

  **Migration**: keep the `challengeId` from `getCode` in memory (no storage or cookie) and send it with the code to `login` / `verify`. If the user asks for a new code, replace the stored `challengeId`: the previous one stops working. Ship the Auth Service that issues and checks the challenge together with this version.

- a1c6d66: Runtime `authUrl`, `Secure` cookies always, `getEvaEnv` removed; S2S breaking change: required `x-eva-nonce` header and 7-line canonical.

  - `configureEvaAuth({ authUrl })` sets the Auth Service URL at runtime (https, or http on loopback; no userinfo, query or fragment). It is required before the first use that needs it, and immutable once set. One published artifact now serves every environment.
  - `getAuthUrl()` throws a configuration error when `authUrl` was never configured. `authFetch` and `verifyAccessToken` propagate it instead of mapping it to a network error or an invalid token, so consumers answer 500 rather than 401.
  - Auth cookies are always `Secure`, regardless of environment. Safari drops `Secure` cookies on `http://localhost`; use a local https origin.
  - Removed `getEvaEnv` and the `EvaEnv` type, and the build-time URL/environment injection (`build:local|dev|prod` scripts, `__EVA_AUTH_URL__`, `__EVA_ENV__`).

  **Migration**: call `configureEvaAuth({ authUrl })` at boot, delete any `getEvaEnv` usage, and stop selecting a build variant.

  ### S2S: `x-eva-nonce` required

  - New required header `x-eva-nonce` (16 random bytes, 32 lowercase hex). The signed canonical string is now 7 lines: METHOD, PATH, QUERY, TIMESTAMP, NONCE, CLIENT_ID, BODY_HASH. `S2SCanonicalParts` requires `nonce`, and `signS2SRequest` throws if it is not 32 lowercase hex. No dual mode: a request without the header fails with `header_missing`.
  - `verifyS2SRequest` / `s2sAuth` validate the nonce format before the HMAC and fail with the new reason `nonce_malformed` (also added to `S2SVerifyReason` and the default messages).
  - `replayCache.setIfAbsent` now receives the key `${clientId}:${nonce}` and a TTL of `2 * timestampWindowSeconds + 1` (241 s by default; it used to be the window and the key `${clientId}:${timestamp}:${signatureHex}`). Two identical requests in the same second no longer collide.
  - A query string with malformed percent-encoding (for example `?a=%ZZ`) no longer makes `verifyS2SRequest` throw (HTTP 500 through `s2sAuth`): it fails closed with `signature_invalid` (401), on the same path as an invalid signature. On the signing side, `signS2SRequest` / `buildS2SCanonicalString` throw a clear `rawQuery inválido` error instead of a `URIError`.
  - If `secretStore` returns a non-null value that is not valid hex, `verifyS2SRequest` throws an explicit configuration error (not a 401, and the message never contains the secret) instead of an opaque `TypeError`.
  - `createS2SClient` now signs the pathname of the final URL, so a `baseUrl` with a path prefix (for example `https://host/auth`) verifies correctly. Before, the prefix was left out of the signed path and the verifier answered `signature_invalid`.
  - New exports from the root and `/s2s`: `generateS2SNonce()` and `signS2SHeaders({ method, path, rawQuery?, bodyBytes?, clientId, secretHex })`, which returns the four headers. `createS2SClient` uses it.

  - `createS2SClient` validates and encodes the ids it puts in the path (`getUser`, `getWebhookSubscription`, `updateWebhookSubscription`, `deleteWebhookSubscription`, `rotateWebhookSubscriptionSecret`). An empty id, `.` or `..` (raw or percent-decoded, any case of `%2e`) now returns `{ ok: false, error: { kind: 'sdk', reason: 'malformed' } }` without sending a request. Any other id goes through `encodeURIComponent`, so `/`, `?`, `#` and `\` stay inside a single path segment. This stops an id from redirecting a validly signed request to another endpoint (the client signs the normalized pathname). UUIDs are unchanged.
  - Behavior change (`baseUrl` prefix): the signed path now includes the `baseUrl` prefix. Deployments where a proxy or gateway strips that prefix before the request reaches the verifier now fail with `signature_invalid`. See `docs/migration.md` section 7.
  - Internal: a malformed query now throws an internal `S2SMalformedQueryError` (same message), and `verifyS2SRequest` maps only that error to `signature_invalid`. Any other failure (for example a crypto error) propagates instead of being reported as a 401.

  **Migration**: `createS2SClient` users need nothing, unless they pass ids that are empty, `.`/`..` or contain reserved characters (now rejected or encoded), or run behind a proxy that strips the `baseUrl` path prefix. Manual signers switch to `signS2SHeaders`; custom verifiers adopt the 7-line canonical and the new replay key and TTL. Signers and verifiers must be upgraded together. See `docs/migration.md` section 7.

- bd7901b: Restructure the SDK repo as a pnpm workspace with a private `@eva_solutions/auth-contracts` package, whose contents ship inlined in the SDK.

  - New entry point `@eva_solutions/auth-sdk/contracts` (ESM and CJS): the wire schemas of the login flow, the user profile, the sessions list, the internal users batch, the webhook subscriptions and deliveries and the service-client admin endpoints, the error body, the route descriptors and the wire constants (`ERROR_CODES`, `HEADERS`, `INTERNAL_HEADERS`, `ACCOUNT_STATES`, `ACTIVITY_STATES`, `PRIVACY_STATES`, `USERS_BATCH_MAX_IDS`, `EVENT_CODES`, `WEBHOOK_HEADERS`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS`, `SERVICE_CLIENT_SCOPES`, `DELIVERY_STATUSES`). The SDK itself and the Auth API consume the same definitions.
  - `@eva_solutions/auth-sdk/hono-openapi` emits a different OpenAPI document: the error body is now a reusable `ErrorBody` component referenced with `$ref`, the schemas carry their descriptions, and `challengeId` declares its `pattern`. Consumers that diff or snapshot the generated document will see these changes.
  - The `react` entry closure stays small in both formats: the CJS build no longer pulls the handlers chunk (schemas, HTTP client, `bowser`) through the bundler runtime helper.
  - Fix: `createHttpClient().getSessions`, `getUserEmpresas` and the `GET /sessions` and `GET /empresas` routes of `evaAuthRoutes` returned the array as an object with numeric keys (`{ "0": …, "1": … }`), so `Array.isArray` was false and `.map` was undefined. They now return a real array; object responses are unchanged.
  - **Breaking:** every Auth Service route the SDK calls moves under `/api/v1` (login, user, sessions, `/internal/*`, `/admin/*`, webhooks). `createHttpClient`, `createS2SClient` and `createAdminClient` prepend the prefix through `apiPath()` (`API_PREFIX + path`); S2S requests sign the final pathname (`/api/v1/internal/...`, after any `baseUrl` path such as `/auth`). `/.well-known/jwks.json` and `/health` stay at the root. `authUrl` (`AUTH_URL`) does not change and must not include `/api/v1`, or the JWKS would be fetched under the prefix and return 404. This SDK only works against an Auth Service that serves `/api/v1`. The consumer's own BFF routes (`evaAuthRoutes`, `useAuthData('/sessions')`) are not Auth Service routes and are not prefixed. See `docs/migration.md`, section 9.
  - `createAdminClient` encodes `slug` and `userId` as a single path segment (`getServiceClient`, `updateServiceClient`, `deleteServiceClient`, `rotateServiceClientSecret`, `restoreUser`). An invalid value (not a string, empty, `.` or `..`, raw or percent-decoded) returns `{ ok: false, error: { kind: 'sdk', reason: 'malformed' } }` without sending the request; it does not throw. The helper is shared with `createS2SClient`, whose ids now also reject non-string values.
  - The webhook request contract is stricter: `url` must be `http` or `https` followed by `//` and contain no whitespace or control characters (a regex that also carries the scheme and is published as the spec `pattern`, plus `.url({ protocol })` and a 2048 maximum; `javascript:`, `ftp://` and `https:host/x` are rejected), and `eventCodes` accepts only `EVENT_CODES` values (minimum one) and is typed `EventCode[]`. The contract does not reject userinfo (`user:pass@host`) or duplicates: the API applies both, the userinfo rule by parsing the URL (an `@` in the path or query stays valid). Variants without `//` such as `https:user:pass@host` never reach that rule: the contract rejects them first.
  - **Breaking (types only):** `S2SGetUserResult` is now `ProfileResponse['data']` (the profile itself) instead of `{ user: ProfileResponse['data'] }`. `getUser` already delivered the profile directly in `result.data` at runtime, so the old type was wrong: code that read `result.data.user` must read `result.data`. A user that does not exist or is soft-deleted arrives as an API error with `code: 'user_not_found'` (404); `isNotFound` is also true for a generic route 404 (`not_found`), so use `matchError(err, 'user_not_found')` to detect a missing user.

### Minor Changes

- 5148937: BFF route for the active company, and the products admin API.

  - `evaAuthRoutes` and `evaAuthOpenAPIRoutes` gain `POST /empresa-activa` (`{ empresaId | null }`): it uses the product access cookie, calls `POST /api/v1/auth/empresa-activa` and rewrites ONLY the access cookie with the re-issued token (the refresh token does not rotate). Errors from Auth (401, 403) use the BFF error format. `createHttpClient().setActiveEmpresa()` returns `{ empresaId, accessToken }`.
  - Contract: `GET/POST /admin/productos` and `PATCH /admin/productos/{slug}` (no delete: a product is disabled) with `productoSchema`, `createProductoRequestSchema`, `updateProductoRequestSchema`, `listProductosResponseSchema` and `productoResponseSchema`. The admin client gains `listProductos()`, `createProducto({ slug, nombre, enabled? })` and `updateProducto(slug, { nombre?, enabled? })`.

- e2ec41a: Backends can forward the real client IP to Auth on every call made on behalf of a user, so Auth's per-IP rate limit and the session see the real IP and not the backend's.

  - **Automatic by default.** `configureEvaAuth` now takes `serviceCredentials: { clientId, secretHex } | null` on the SERVER entries (root, `/hono`, `/generic`): MANDATORY (`null` is the explicit discard; `undefined` throws at configure time, with no sensitive values in the message). With credentials, the configuration builds ONE forwarding object (a service token provider, audience `auth-api`, scope `login:client-ip`) that `evaAuthRoutes`, `evaAuthOpenAPIRoutes`, `evaAuth` and `verifyRequest` use by default, sharing its back-off. Reconfiguring with the same credentials keeps the object and the back-off. The default client IP is `cf-connecting-ip` only (never `x-forwarded-for`), from a Hono `Context` or a `Request`, and it exists ONLY on Cloudflare Workers (`navigator.userAgent === 'Cloudflare-Workers'`): anywhere else a client can write that header, so with credentials and no `getClientIp` `configureEvaAuth` throws at configure time (`null` is not affected). `getClientIp` is therefore required there (optional on Workers). `onClientIpForwardingError` is an optional `configureEvaAuth` option (default: a `console.warn` with `code` and `status`, never the token or the IP). `getConfiguredClientIpForwarder()` and `readRequestHeader()` are exported for callers of `createHttpClient`.
  - **Breaking (server entries):** every `configureEvaAuth` call on the root, `/hono` and `/generic` entries must pass `serviceCredentials` (an object, or `null` without a backend). The `/react` entry (the browser) has its own `configureEvaAuth` that does NOT accept `serviceCredentials` (type and runtime), and its bundle does not carry the provider (a test builds the real entries to prove it, and `check:react-closure` forbids the provider strings).
  - An explicit `clientIpForwarding: { getClientIp, getServiceToken, onError? }` on `evaAuthRoutes`, `evaAuthOpenAPIRoutes`, `buildAuthHandlers`, `evaAuth` or `verifyRequest` (`getClientIp` receives the `Request` there) still takes priority. It covers get-code, login, refresh, logout, me, empresas, empresa-activa and sessions. When `getClientIp` returns an IP it sends `x-eva-service-token: <service token>` and `x-eva-client-ip: <ip>` together (neither without an IP). Everything is best effort: if either function throws, the token takes more than 2 s, or the token is not a valid header value, the call goes on without those headers; after a token failure it is not requested again for 30 s, and a token that arrived after the 2 s is used within those 30 s. The state is shared per option object.
  - One channel for the credential: `Authorization` stays for the user token. New exports `SERVICE_TOKEN_HEADER` (`x-eva-service-token`) and `CLIENT_IP_HEADER` (`x-eva-client-ip`) from the root and `/s2s`, and `createClientIpForwarder(options)` (plus the `ClientIpForwarding*` types) to build those headers when calling `createHttpClient` directly.
  - New service scope `login:client-ip` on the `auth-api` audience (`S2S_SCOPES.LOGIN_CLIENT_IP`).
  - `createHttpClient()` `getCode`, `login`, `refresh`, `logout`, `deleteAllSessions`, `getUser`, `updateUser`, `deleteUser`, `getUserEmpresas`, `setActiveEmpresa`, `getDirectorio`, `getSessions` and `deleteSession` accept optional extra headers as a last argument. They cannot override `content-type` or the user credential the call sets.
  - Fix: `evaAuth` cleared the session cookies on ANY refresh failure. Now it clears them only when Auth rejects the refresh definitively (API error other than 408, 429 and 5xx); on a network failure, 408, 429 or 5xx it keeps them and answers 503 (with `Retry-After` when Auth sent it). If the refresh answered 200 but the new token cannot be verified for a transient reason (JWKS unreachable), the rotated cookies are written and it answers 503; a really invalid new token still clears them. A transient failure of the FIRST access-token check also answers 503 without refreshing or touching cookies. Only jose token errors count as definitive; anything else out of the `jwtVerify` stage (JWKS unreachable, fetch failure, "Network connection lost.") is transient, and whatever the `extraClaimsSchema` parse throws is always definitive. API and SDK errors carry an optional `retryAfterSeconds`.
  - `verifyRequest` returns `VerifyRequestResult`: the same `Result`, except a failure may carry `newCookies` (rotated tokens that could not be verified for a transient reason, with `error.status` 503). Write them or the rotation is lost. A transient failure of the first access-token check returns 503 without refreshing.
  - Fix: concurrent refreshes (`evaAuth`, `verifyRequest`, the refresh route) no longer hang when the runtime cancels the request that started them: an entry older than 8 s is dropped without timers and a joiner retries 8 s after the refresh started (Auth accepts the previous refresh token only for 10 s after a rotation).
  - Fix: `createServiceTokenProvider().getToken()` drops an in-flight request older than its deadline without relying on timers, so a request cancelled by Workers cannot leave it hanging.

  Only backends should use it, and `getClientIp` must read a trusted source (the edge header or the socket IP, never a client-controlled header). See `docs/security.md`.

- 5b11aea: `AdminClient.maintenanceCleanup` and `allowedOrigins` for native app schemes.

  - New `AdminClient.maintenanceCleanup({ limit? })` for `POST /api/v1/admin/maintenance/cleanup`, signed with HMAC like the other admin methods. On demand, it purges the `eliminado` accounts whose restore window has expired and deletes the `webhook_events` that have no live deliveries and exceed the retention. `limit` (1 to 100, default 100) travels in the signed query string. It returns `{ usersPurged, eventsDeleted, hasMore }`; call again while `hasMore` is true.
  - Contract: `ADMIN_ROUTES.maintenanceCleanup`, `maintenanceCleanupQuerySchema` and `maintenanceCleanupResponseSchema` (+ `MaintenanceCleanupQuery`, `MaintenanceCleanupResponse`). New admin entry point types `MaintenanceCleanupQuery` and `MaintenanceCleanupResult`.
  - `allowedOrigins` of `evaAuthRoutes` / `evaAuthOpenAPIRoutes` accepts any serialized origin (`scheme://host[:port]`), not only `http(s)`: `tauri://localhost` or `capacitor://localhost` now pass the `Origin` check by exact match. `'*'`, `null` and entries with path, userinfo or an invalid port still throw when the routes are built.

- 2da2f0f: Typed error codes for the secret rotation conflicts and for the S2S surface.

  - `ADMIN_ERROR_CODES` (and `AdminErrorCode`) adds `service_client_secret_rotation_conflict`: `POST /admin/service-clients/{slug}/rotate-secret` answers 409 with it when a concurrent rotation of the same service client won. The losing call receives no secret and can be retried.
  - New `S2S_ERROR_CODES` / `S2SErrorCode`, exported from the root and `/s2s`, covering the codes the Auth Service emits on `/internal/users` and `/internal/webhooks`: `user_not_found`, `webhook_subscription_duplicate`, `webhook_subscription_not_found`, `webhook_secret_rotation_conflict`, `webhook_url_invalid` and `webhook_event_codes_empty`. `rotateWebhookSubscriptionSecret` answers 409 `webhook_secret_rotation_conflict` when a concurrent rotation won; that call receives no signing key and can be retried.
  - Additive and non-breaking: the runtime `ErrorCode` type stays open (`CoreErrorCode | (string & {})`), so existing comparisons keep compiling. Only code that exhaustively switches over `AdminErrorCode` needs a new case.

- 6807512: CSRF por `Origin` en las rutas con cookies, verificador de JWT de servicio y zod 4.6.7.

  - `evaAuthRoutes` y `evaAuthOpenAPIRoutes` verifican `Origin` en las mutaciones (`POST`, `PATCH`, `PUT`, `DELETE`): un origen ajeno responde 403 `forbidden` sin llegar al handler. Por defecto pasa el mismo host que la request (el esquema no cuenta, por los proxies que terminan TLS); la opción nueva `allowedOrigins` agrega orígenes (coincidencia exacta; `'*'` lanza). Sin `Origin` pasa (clientes que no son navegador). Un front en otro origen, incluido otro puerto de `localhost`, debe listarse en `allowedOrigins`. Nueva key de mensajes `originNotAllowed` (`Origen no permitido`).
  - Nuevo `verifyServiceJwt` en `@eva_solutions/auth-sdk/s2s` y middleware `serviceJwtAuth` en `@eva_solutions/auth-sdk/hono` (más `SERVICE_JWT_TYP`, `SERVICE_JWT_MAX_LIFETIME_SECONDS`, `SERVICE_JWT_CLOCK_TOLERANCE_SECONDS`): verifican las llamadas que el Auth Service firma con un JWT ES256 (`typ: 'svc+jwt'`, `iss: 'auth-service'`, `aud` del receptor, `scope`, `jti` con `replayCache` obligatorio y `bsha`, el SHA-256 base64url del body crudo) contra el JWKS remoto. Un access token de usuario no pasa. `verifyS2SRequest` no cambia. Contrato en `docs/api.md` y ADR-019.
  - Los arrays de los request del contrato ya no son ilimitados: `ids` del batch de usuarios acepta hasta `USERS_BATCH_MAX_IDS` (100, y el OpenAPI publica `maxItems`), `scopes` de los service clients hasta 16 y `eventCodes` de las subscriptions hasta 32 (repetidos incluidos). Más allá responde 400.
  - `zod` sube a `^4.6.7` (GHSA-mrhx-c7xc-m3w5); el `zod` de los consumidores debe cumplir ese rango.

Todas las versiones notables de `@eva_solutions/auth-sdk` están documentadas aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/). Este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] — 2026-06-09

### Fixed

- **Docs** — corrige ejemplos de `secretStore` en JSDoc de `verifyS2SRequest` y README que sugerían el campo `secretHash` (modelo R1); el contrato espera el plaintext del secret (`secret`).

---

## [2.0.0] — 2026-06-08

### Breaking Changes

- **`configureEvaAuth.authUrl` eliminado** — el campo `authUrl` ya no existe en `ConfigureEvaAuthOptions`. TypeScript rechazará `configureEvaAuth({ authUrl: '...' })` en compilación. En JS puro, el campo extra es ignorado silenciosamente (sin throw).

- **`process.env.EVA_AUTH_URL` ignorado** — la variable de entorno ya no tiene efecto. `getAuthUrl()` retorna exclusivamente la URL horneada en build-time (`__EVA_AUTH_URL__`).

- **`createS2SClient` lanza si `baseUrl` es HTTP no-loopback** — se requiere `https:` para hosts no-loopback. `http://localhost:*`, `http://127.x.x.x:*`, `http://[::1]:*` y `http://::1:*` siguen siendo válidos para entornos de test/desarrollo local.

- **`createAdminClient` lanza si `baseUrl` es HTTP no-loopback** — mismo comportamiento que `createS2SClient`.

- **`getPublicKey` eliminado** — el export `getPublicKey(): Promise<CryptoKey>` ya no existe en el barrel raíz. Era una API interna expuesta accidentalmente. Consumers que necesiten la clave pública deben usar `verifyAccessToken()` directamente.

- **`fetchJwks` eliminado** — el export `fetchJwks(): Promise<void>` ya no existe. La hidratación del cache JWKS es automática y gestionada internamente por jose.

- **`clearJwksCache` eliminado** — el export `clearJwksCache(): void` ya no existe. Con la URL del Auth Service siendo build-time pura (ADR-013), no hay caso de uso válido para invalidar el cache manualmente.

### Documentation correction

- **Nota (corrección de documentación)** — 2.0.0 ya incluía el lado servidor de S2S (`verifyS2SRequest`, el middleware `s2sAuth`, `requireScope` y la opción `replayCache`), que nunca se listó en este changelog.

### Migration Guide

#### Si usabas `configureEvaAuth({ authUrl })`

```ts
// v1.x — ya no funciona
configureEvaAuth({ authUrl: "https://auth.example.com" });

// v2.x — usar la variante de build correcta
// El SDK ya trae la URL horneada. No se necesita ningún código adicional.
// Asegurarse de consumir la variante 'production' del SDK.
```

#### Si usabas `process.env.EVA_AUTH_URL`

Eliminar la variable de entorno. La URL se fija en build-time con `EVA_BUILD_ENV=production` al publicar.

#### Si tus tests usan `http://auth.test` como baseUrl de S2S o Admin

```ts
// v1.x
createS2SClient({ baseUrl: 'http://auth.test', ... })

// v2.x — usar loopback
createS2SClient({ baseUrl: 'http://localhost:4000', ... })
// O mockear el factory completo en lugar de crear el cliente real
```

### Security

- `validateHttpsUrl` reemplaza `validateAuthUrl`: requiere HTTPS salvo host loopback (`localhost`, `127.0.0.0/8`, `::1`/`[::1]`). Mitiga CWE-319 para `secretHex` (S2S) y `adminPassword` (Admin).
- Auth URL build-time puro elimina superficie de misconfiguración accidental de URL en deploys.
- **kid-matching RFC 7517** — la verificación de tokens ahora usa `createRemoteJWKSet` de jose, que selecciona la clave pública por `kid` + `alg` + `use`. Resuelve el bug de selección ciega `keys[0]` que producía comportamiento incorrecto con múltiples claves (rotación de clave).
- **`algorithms: ['ES256']` explícito en jwtVerify** — defensa en profundidad contra algorithm confusion attacks. jose ya rechazaba el algoritmo vía la CryptoKey tipada, pero ahora la restricción es declarativa.
- **jose pinado a `~6.2.3`** — el rango de patch acota upgrades automáticos. El comportamiento fail-closed verificado se protege con `tests/jwks.contract.test.ts`.

### Changed

- **Mensajes de error JWKS** — `EvaSdkError.message` ahora contiene mensajes de jose en inglés técnico (ej: `"Expected 200 OK from the JSON Web Key Set HTTP response"`) en lugar de mensajes en español del SDK (ej: `"Clave pública no disponible"`). El discriminator `reason: 'token_invalid'` y `status: 401` no cambian.

### Internal

- ADR-010 marcado como SUPERSEDED por ADR-013.
- ADR-013 agregado a `docs/decisions.md`.
- `src/globals.d.ts` JSDoc actualizado.
- `tsdown.config.ts` comentario de cabecera actualizado.

---

## [1.0.0-public] — 2026-05-16

### Changed

- **Package scope rename**: internal name → `@eva_solutions/auth-sdk` for the public npm release. The original internal name was never published to npm; this is a branding change only. See [ADR-014](docs/adr-014-package-scope.md).
- **Repository**: public at `github.com/eva-solutions-org/auth-sdk`.
- **License**: MIT — see [LICENSE](LICENSE).
- Community health files added: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- CI/CD workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml`.
- npm provenance publishing via OIDC (GitHub Actions Trusted Publisher).

---

## [1.0.0] — 2026-05-10

### Breaking Changes

- **`Result<T>.error` cambia de `string` a `EvaError`** (discriminated union `EvaApiError | EvaSdkError`). Todos los callsites que tratan `result.error` como string deben actualizarse. Ver [docs/migration.md](docs/migration.md#1-resulterror--string--evaerror).

- **`Result<T>` en el branch `ok: false` ya no tiene `status` top-level** — el status vive en `result.error.status`. Ver [docs/migration.md](docs/migration.md#2-resultstatus--resulterrorstatus).

- **Wire HTTP del SDK cambia de `{ error: string }` a `{ error: { code, message } }` por default** — el nuevo default `errorWire: 'api'` emite el shape del Auth Service. Para compat 0.x usar `configureEvaAuth({ errorWire: 'string' })`. Ver [docs/configuration.md#errorwire](docs/configuration.md#errorwire).

- **`EvaAuthError`, `createAuthError`, `isAuthError` eliminados** — `src/errors.ts` hard-deleted sin @deprecated. No existen en 1.0.0. Ver [docs/migration.md](docs/migration.md#3-evaautherror--eliminado-sin-reemplazo).

- **`ERROR_CODES` tiene 12 entries** (antes 11 — se agregó `account_state_locked`).

- **`parseErrorResponse` async (tomaba `Response`) eliminada** — reemplazada por versión sync en `src/schemas.ts` con firma `(status: number, body: unknown): EvaError`.

- **`Result<T>` — segundo parámetro genérico `E` eliminado** — el tipo de error es siempre `EvaError`. La firma es `Result<T>`, no `Result<T, E>`.

### Added

- **`EvaApiError`** — tipo para errores del Auth Service: `{ kind: 'api', code: string, message: string, status: number }`.
- **`EvaSdkError`** — tipo para errores internos del SDK: `{ kind: 'sdk', reason: SdkErrorReason, message: string, status: number }`.
- **`EvaError`** — discriminated union `EvaApiError | EvaSdkError`. Nuevo tipo de `Result<T>.error`.
- **`ERROR_CODES`** — catálogo `as const` de 12 error codes core del Auth Service. Solo aplica a `EvaApiError` (kind: `'api'`).
- **`SDK_ERROR_REASONS`** — enum cerrado `as const` de 6 reasons internos del SDK.
- **`CoreErrorCode`** — unión cerrada de los 12 values de `ERROR_CODES`.
- **`ErrorCode`** — `CoreErrorCode | (string & {})` — tipo abierto para feature-specific codes con autocomplete.
- **`SdkErrorReason`** — tipo de los 6 values de `SDK_ERROR_REASONS`.
- **`getMessage(err: EvaError): string`** — helper de conveniencia para migración gradual desde 0.x. Equivale a `err.message`.
- **`@eva_solutions/auth-sdk/webhooks`** — nuevo entry point con `verifyWebhookSignature`, `EVENT_CODES`, `WEBHOOK_TIMESTAMP_WINDOW_SECONDS` y tipos.
- **`@eva_solutions/auth-sdk/admin`** — nuevo entry point con `createAdminClient()` para gestión de service clients y restauración de usuarios.
- **`@eva_solutions/auth-sdk/s2s`** — nuevo entry point con `createS2SClient()` para llamadas internas con firma HMAC S2S automática.
- **`errorWire?: 'api' | 'string'`** en `configureEvaAuth()` — controla el shape HTTP que el SDK emite al rechazar requests. Default: `'api'`.
- **`getErrorWire(): 'api' | 'string'`** — getter público de la config runtime `errorWire`.
- **`EVENT_CODES`** — 11 event codes del Auth Service re-exportados desde `@eva_solutions/auth-sdk` y `@eva_solutions/auth-sdk/webhooks`.
- **`ACCOUNT_STATES`** — catálogo `as const` de 6 estados de cuenta (`no_verificado`, `verificado`, `pendiente_de_verificacion`, `suspendido`, `baneado`, `eliminado`). Espejo de `src/core/constants/account-states.ts` del API. Re-exportado desde `@eva_solutions/auth-sdk`.
- **`AccountState`** — tipo union de los 6 literales de `ACCOUNT_STATES`. `RestoreUserResult.stateAccount` tipado como `AccountState`.
- **`WEBHOOK_HEADERS`** — headers que el Auth Service incluye en cada webhook entregado: `SIGNATURE`, `ID`, `TIMESTAMP`. Re-exportado desde `@eva_solutions/auth-sdk/webhooks` y `@eva_solutions/auth-sdk`.
- **`S2S_SCOPES`** — catálogo `as const` de scopes S2S reconocidos: `USERS_READ`, `WEBHOOKS_READ`, `WEBHOOKS_WRITE`. Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **`S2SScope`** — tipo union de los literales de `S2S_SCOPES`.
- **`S2S_RESPONSE_HEADERS`** — header de respuesta S2S: `SERVER_TIME` (`x-eva-server-time`). Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **`ADMIN_ERROR_CODES`** — códigos de error específicos del módulo Admin: `service_client_already_exists`, `service_client_not_found`. Re-exportado desde `@eva_solutions/auth-sdk/admin` y `@eva_solutions/auth-sdk`.
- **`AdminErrorCode`** — tipo union de los literales de `ADMIN_ERROR_CODES`.
- **`USERS_BATCH_MAX_IDS = 100`** — constante documentando el límite del API para `batchUsers`. Re-exportado desde `@eva_solutions/auth-sdk/s2s` y `@eva_solutions/auth-sdk`.
- **Validación client-side en `batchUsers`** — si `ids.length > 100` retorna `Result ok:false` con `kind: 'sdk', reason: 'malformed'` sin hacer fetch.
- **Validación client-side en `listWebhookDeliveries`** — si `limit` fuera de `[1, 100]` u `offset < 0`, retorna `Result ok:false` con `kind: 'sdk', reason: 'malformed'` sin hacer fetch.

### Changed

- **`parseErrorResponse`** — de función async (tomaba `Response`) a función sync (toma `status: number, body: unknown`). Vive en `src/schemas.ts`.
- **`ErrorResponseSchema`** — de `{ error: z.string() }` a `{ error: z.object({ code: z.string(), message: z.string() }) }`. Afecta la spec OpenAPI generada por `evaAuthOpenAPIRoutes()`.
- **`configureEvaAuth()`** — acepta nuevo campo `errorWire?: 'api' | 'string'`. Validación inline en setup time.
- **`src/hono/middleware.ts`** — el reject path construye `EvaSdkError` local y consulta `getErrorWire()` para emitir el shape correcto.
- **`src/auth-handlers.ts`** — `errorResponse()` privado ahora acepta `EvaError` + consulta `getErrorWire()`. Nuevo helper interno `resolveCode()` para mapear `SdkErrorReason` → `ErrorCode`.
- **Todos los callsites de `result.error`** en `src/http-client.ts`, `src/jwt.ts`, `src/generic/verify.ts` — migrados a `EvaError`.

### Removed

- **`src/errors.ts`** — hard-deleted. `EvaAuthError`, `createAuthError`, `isAuthError` y `parseErrorResponse` async eliminados.
- **`Result<T>` propiedad `.status` top-level** en el branch `ok: false` — eliminada. El status vive en `result.error.status`.
- **Re-exports de `EvaAuthError`, `createAuthError`, `isAuthError`** desde `src/index.ts`.

### Migration

Ver [`docs/migration.md`](docs/migration.md) para guía completa con before/after por área, tabla de mapping de reasons y snippets de codemod manual.

---

## [0.1.0] — 2026-04-09

Versión inicial del SDK.

### Added

- Core: `createEvaAuth()`, `createHttpClient()`, `verifyAccessToken()`, JWKS cache con ETag/304.
- Hono: `evaAuth()` middleware, `evaAuthRoutes()`, `getEvaPayload()`, `getSessionId()`, `parseDeviceInfo()`.
- Generic: `verifyRequest()`, `setTokenCookies()`, `clearTokenCookies()`.
- React: `EvaAuthProvider`, `useAuth()`, `useUser()`, `useSessions()`, `useEmpresas()`, `authFetch()`.
- Config build-time via `tsup define` (`__EVA_AUTH_URL__`, `__EVA_ENV__`).
- Runtime config via `configureEvaAuth({ authUrl, cookieDomain, errorMessages })`.
- Sistema i18n de 16 mensajes de error con precedencia local > global > default.
- Entry point `@eva_solutions/auth-sdk/hono-openapi` con `evaAuthOpenAPIRoutes()`.
- `EvaTokenPayload<TExtra>` genérico con validación opcional via `extraClaimsSchema`.
- `RESERVED_JWT_CLAIMS` (RFC 7519 + OIDC Core 1.0) con fail-fast en extraClaimsSchema.
- Auto-refresh con deduplicación via `Map<string, Promise>`.
- `Result<T>` pattern para todos los flujos de error.

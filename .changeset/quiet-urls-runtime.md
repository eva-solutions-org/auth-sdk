---
'@eva_solutions/auth-sdk': major
---

Runtime `authUrl`, `Secure` cookies always, `getEvaEnv` removed; S2S breaking change: required `x-eva-nonce` header and 7-line canonical.

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

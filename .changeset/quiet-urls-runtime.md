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
- New exports from the root and `/s2s`: `generateS2SNonce()` and `signS2SHeaders({ method, path, rawQuery?, bodyBytes?, clientId, secretHex })`, which returns the four headers. `createS2SClient` uses it.

**Migration**: `createS2SClient` users need nothing. Manual signers switch to `signS2SHeaders`; custom verifiers adopt the 7-line canonical and the new replay key and TTL. Signers and verifiers must be upgraded together. See `docs/migration.md` section 7.

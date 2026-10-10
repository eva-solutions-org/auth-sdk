---
'@eva_solutions/auth-sdk': major
---

Runtime `authUrl`, `Secure` cookies always, `getEvaEnv` removed.

- `configureEvaAuth({ authUrl })` sets the Auth Service URL at runtime (https, or http on loopback; no userinfo, query or fragment). It is required before the first use that needs it, and immutable once set. One published artifact now serves every environment.
- `getAuthUrl()` throws a configuration error when `authUrl` was never configured. `authFetch` and `verifyAccessToken` propagate it instead of mapping it to a network error or an invalid token, so consumers answer 500 rather than 401.
- Auth cookies are always `Secure`, regardless of environment. Safari drops `Secure` cookies on `http://localhost`; use a local https origin.
- Removed `getEvaEnv` and the `EvaEnv` type, and the build-time URL/environment injection (`build:local|dev|prod` scripts, `__EVA_AUTH_URL__`, `__EVA_ENV__`).

**Migration**: call `configureEvaAuth({ authUrl })` at boot, delete any `getEvaEnv` usage, and stop selecting a build variant.

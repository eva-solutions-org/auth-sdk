---
'@eva_solutions/auth-sdk': major
---

Restructure the SDK repo as a pnpm workspace with a private `@eva_solutions/auth-contracts` package, whose contents ship inlined in the SDK.

- New entry point `@eva_solutions/auth-sdk/contracts` (ESM and CJS): the wire schemas of the login flow, the user profile, the sessions list and the internal users batch, the error body, the route descriptors and the wire constants (`ERROR_CODES`, `HEADERS`, `INTERNAL_HEADERS`, `ACCOUNT_STATES`, `ACTIVITY_STATES`, `PRIVACY_STATES`, `USERS_BATCH_MAX_IDS`). The SDK itself and the Auth API consume the same definitions.
- `@eva_solutions/auth-sdk/hono-openapi` emits a different OpenAPI document: the error body is now a reusable `ErrorBody` component referenced with `$ref`, the schemas carry their descriptions, and `challengeId` declares its `pattern`. Consumers that diff or snapshot the generated document will see these changes.
- The `react` entry closure stays small in both formats: the CJS build no longer pulls the handlers chunk (schemas, HTTP client, `bowser`) through the bundler runtime helper.
- Fix: `createHttpClient().getSessions`, `getUserEmpresas` and the `GET /sessions` and `GET /empresas` routes of `evaAuthRoutes` returned the array as an object with numeric keys (`{ "0": …, "1": … }`), so `Array.isArray` was false and `.map` was undefined. They now return a real array; object responses are unchanged.

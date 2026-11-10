---
'@eva_solutions/auth-sdk': major
---

`createAdminClient` signs with HMAC S2S instead of sending a password, `admin` scope, and `republishPendingWebhooks`.

- **Breaking:** `AdminClientConfig` is now `{ clientId, secretHex, baseUrl }` (it was `{ adminPassword, baseUrl }`). Every admin request is signed with `signS2SHeaders` using the credentials of a service client that holds the `admin` scope; the `x-admin-password` header is no longer sent. The Auth Service rejects that header and requires the signature on `/api/v1/admin/*`, so ship this version together with the Auth Service that enforces it.
- `SERVICE_CLIENT_SCOPES` (contract) and `S2S_SCOPES` add `admin` (`S2S_SCOPES.ADMIN`). `POST` / `PATCH /admin/service-clients` now accept it, and a client without it gets 403 on `/admin/*`.
- New `AdminClient.republishPendingWebhooks({ older_than_minutes?, limit? })` for `POST /api/v1/admin/webhooks/republish-pending`. The two options travel in the signed query string (defaults and ranges are the API's: 10 minutes, at most 10080; `limit` 1 to 100, default 100). It returns `{ republished, hasMore }`; call again while `hasMore` is true. A 503 `service_unavailable` means QStash did not take the batch and the deliveries stay `pending`.
- Contract: `ADMIN_ROUTES.republishPendingWebhooks`, `republishPendingQuerySchema` and `republishPendingResponseSchema` (+ `RepublishPendingQuery`, `RepublishPendingResponse`). New admin entry point types `RepublishPendingWebhooksQuery` and `RepublishPendingWebhooksResult`.
- `ADMIN_ERROR_CODES` (and `AdminErrorCode`) adds `last_admin_client`: deleting, disabling or removing the `admin` scope from the last enabled admin client answers 409 and is not applied. Only code that exhaustively switches over `AdminErrorCode` needs a new case.

**Migration**: create a service client with the `admin` scope (the Auth Service bootstrap script creates the first one), keep its secret in your secret manager, and replace `adminPassword` with `clientId` and `secretHex`. See `docs/migration.md`, section 12.

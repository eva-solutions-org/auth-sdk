---
'@eva_solutions/auth-sdk': minor
---

Typed error codes for the secret rotation conflicts and for the S2S surface.

- `ADMIN_ERROR_CODES` (and `AdminErrorCode`) adds `service_client_secret_rotation_conflict`: `POST /admin/service-clients/{slug}/rotate-secret` answers 409 with it when a concurrent rotation of the same service client won. The losing call receives no secret and can be retried.
- New `S2S_ERROR_CODES` / `S2SErrorCode`, exported from the root and `/s2s`, covering the codes the Auth Service emits on `/internal/users` and `/internal/webhooks`: `user_not_found`, `webhook_subscription_duplicate`, `webhook_subscription_not_found`, `webhook_secret_rotation_conflict`, `webhook_url_invalid` and `webhook_event_codes_empty`. `rotateWebhookSubscriptionSecret` answers 409 `webhook_secret_rotation_conflict` when a concurrent rotation won; that call receives no signing key and can be retried.
- Additive and non-breaking: the runtime `ErrorCode` type stays open (`CoreErrorCode | (string & {})`), so existing comparisons keep compiling. Only code that exhaustively switches over `AdminErrorCode` needs a new case.

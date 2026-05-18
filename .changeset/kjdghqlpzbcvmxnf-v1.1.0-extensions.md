---
'@eva_solutions/auth-sdk': minor
---

Three additive, non-breaking extensions to the S2S server-side API:

- Add optional `replayCache` callback to `verifyS2SRequest` (and `s2sAuth`) for atomic nonce-based replay protection. The callback exposes a single atomic `setIfAbsent(nonce, ttlSeconds): Promise<boolean>` method that maps naturally to Redis `SET ... NX EX`. The SDK constructs the nonce as `${clientId}:${timestamp}:${signatureHex}`. A new `'replay_detected'` reason is added to `S2SVerifyReason`.
- Add multi-scope overloads to `requireScope`: `requireScope({ all: readonly string[] })` (all scopes must be present) and `requireScope({ any: readonly string[] })` (at least one). The legacy single-scope `requireScope(string)` is preserved unchanged. Wire format for multi-scope 403 uses `requiredAll`/`missing` (AND) and `requiredAny` (OR) — separate fields to avoid colliding with the legacy `required: string` shape.
- Add optional `messages` override to `verifyS2SRequest` (and `s2sAuth`) for i18n of `S2SVerifyError.message`. Provide a partial `Record<S2SVerifyReason, string>` to override default English messages; un-overridden keys keep their defaults.

**Migration note (type-level only)**: If you exhaustive-switch on `S2SVerifyError.reason` (e.g. with `default: const _: never = reason`), add a case for `'replay_detected'`. The new value only occurs at runtime when `replayCache` is configured — but TypeScript flags it as a missing exhaustive case at compile time regardless.

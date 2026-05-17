---
'@eva_solutions/auth-sdk': minor
---

Add server-side S2S verification primitives.

New exports for verifying inbound HMAC-signed S2S requests:

- `verifyS2SRequest` from `@eva_solutions/auth-sdk/s2s` and root barrel — framework-agnostic primitive using Web API Request. Returns a `S2SVerifyResult<{ clientId }>` discriminated by `ok: true | false`. Timing-safe defense applied when the client is unknown.
- `s2sAuth` and `requireScope` from `@eva_solutions/auth-sdk/hono` — Hono middlewares that wrap the primitive, set `c.var.s2sClientId` / `c.var.s2sScopes`, and respond with the standard `{ error: { code, message } }` wire format.
- New types: `S2SVerifyError`, `S2SVerifyReason`, `S2SVerifyResult`, `S2SVerifyOptions`, `S2sAuthOptions`, `S2sAuthVariables`.

Backward-compatible — no changes to existing exports or runtime behavior.

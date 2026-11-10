---
'@eva_solutions/auth-sdk': major
---

OTP login challenge: `get-code` now returns a `challengeId` that `/login` requires.

- `POST /get-code` responds `{ data: { message, challengeId } }`. The `challengeId` is opaque, tied to the code just issued, and every new `get-code` invalidates the previous one. The browser-facing handler passes it through unchanged; `http-client.getCode` returns `Result<{ message: string; challengeId: string }>`.
- `POST /login` requires `challengeId` in the body (`LoginSchema` adds `challengeId: z.string().min(1)`). A request without it fails with 400 `malformed` before reaching the Auth Service. `http-client.login` now takes `challengeId` and sends it.
- React: `login.getCode` returns `Result<{ message; challengeId }>` and `login.verify({ phone, code, challengeId })` forwards it. The provider stays stateless and never stores the challenge.
- OpenAPI (`/hono-openapi`): the `get-code` 200 response documents `message` and `challengeId`.
- The `get-code` and `login` handlers of `evaAuthRoutes` / `evaAuthOpenAPIRoutes` now answer `Cache-Control: no-store` on every response (success and error), since they carry the `challengeId` and session cookies. In the OpenAPI variant the validation 400s (invalid or malformed body) of `get-code` / `login` now use the same `{ error: { code, message } }` wire as the plain variant instead of exposing a `ZodError`. This applies only to the SDK's own `POST /get-code` and `POST /login` (exact route match, any mount prefix); routes the consumer adds to the same sub-app keep their own validation and default 400.

**Migration**: keep the `challengeId` from `getCode` in memory (no storage or cookie) and send it with the code to `login` / `verify`. If the user asks for a new code, replace the stored `challengeId`: the previous one stops working. Ship the Auth Service that issues and checks the challenge together with this version.

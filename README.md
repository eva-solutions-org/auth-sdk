# @eva_solutions/auth-sdk

> Official TypeScript client for the EVA Auth Service — secure cookie-based auth with JWT ES256, JWKS rotation, S2S signing, and webhooks.

[![npm version](https://img.shields.io/npm/v/@eva_solutions/auth-sdk)](https://www.npmjs.com/package/@eva_solutions/auth-sdk)
[![npm downloads](https://img.shields.io/npm/dm/@eva_solutions/auth-sdk)](https://www.npmjs.com/package/@eva_solutions/auth-sdk)
[![license MIT](https://img.shields.io/npm/l/@eva_solutions/auth-sdk)](./LICENSE)
[![CI status](https://github.com/eva-solutions-org/auth-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/eva-solutions-org/auth-sdk/actions/workflows/ci.yml)
[![Provenance](https://img.shields.io/badge/Provenance-%E2%9C%93-blue)](https://docs.npmjs.com/generating-provenance-statements)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@eva_solutions/auth-sdk)](https://bundlephobia.com/package/@eva_solutions/auth-sdk)

---

`@eva_solutions/auth-sdk` is the official TypeScript client for the EVA Auth Service. It handles the full authentication lifecycle — OTP login, secure cookie-based session management, automatic token refresh, and JWT verification with ES256 + JWKS rotation — so application code stays clean.

The SDK bridges two transport layers: HttpOnly cookies between the React frontend and the Hono backend, and custom headers between the backend and the EVA Auth Service. Neither layer is visible to consumers.

It ships as tree-shakeable ESM + CJS with TypeScript declarations, sourcemaps, and zero runtime dependencies on heavy frameworks. Pick only the entry points you need.

## Features

- JWT verification with ES256 + automatic JWKS rotation (24 h cache + ETag/304)
- Secure HttpOnly cookie session management — no tokens exposed to JavaScript
- React hooks for client-side auth state (`useAuth`, `useUser`, `useSessions`, `useEmpresas`)
- Hono middleware and pre-built auth routes for server-side route protection
- S2S (service-to-service) client with automatic HMAC canonical signing
- Webhook event verification (HMAC-SHA256 with timestamp window)
- Built-in error handling with `Result<T>` pattern — no thrown exceptions for business flows
- Tree-shakeable ESM + CJS + `.d.ts` with declaration maps and sourcemaps
- 8 independent entry points — import only what your runtime needs
- Typed extra JWT claims via optional Zod schema (`extraClaimsSchema`)
- Runtime `configureEvaAuth()` override — same build, multiple environments

---

## Installation

```bash
pnpm add @eva_solutions/auth-sdk
# or
npm install @eva_solutions/auth-sdk
# or
yarn add @eva_solutions/auth-sdk
```

**Optional peer dependencies** — install only the peers you need:

```bash
pnpm add hono              # required for @eva_solutions/auth-sdk/hono
pnpm add react             # required for @eva_solutions/auth-sdk/react
pnpm add @hono/zod-openapi # required for @eva_solutions/auth-sdk/hono-openapi
```

---

## Quick Start

### Server — Hono

```ts
import { Hono } from 'hono';
import { evaAuth, evaAuthRoutes } from '@eva_solutions/auth-sdk/hono';
import { configureEvaAuth } from '@eva_solutions/auth-sdk';

// Call once at boot, before registering routes
configureEvaAuth({ authUrl: 'https://auth.example.com' });

const app = new Hono();

app.route('/auth', evaAuthRoutes()); // pre-built login / logout / me routes
app.use('/api/*', evaAuth());         // protect routes — verifies JWT, auto-refreshes

app.get('/api/me', (c) => {
  const { id, sessionId } = c.var.evaPayload;
  return c.json({ id, sessionId });
});
```

Typed extra JWT claims:

```ts
import { z } from 'zod';
import { evaAuth } from '@eva_solutions/auth-sdk/hono';

const auth = evaAuth({
  extraClaimsSchema: z.object({
    phone: z.string(),
    empresaId: z.string().uuid(),
  }),
});

app.use('/api/*', auth);
```

### Client — React

```tsx
import { EvaAuthProvider, useAuth, useUser } from '@eva_solutions/auth-sdk/react';

function App() {
  return (
    <EvaAuthProvider basePath="/auth">
      <Profile />
    </EvaAuthProvider>
  );
}

function Profile() {
  const { isAuthenticated, isLoading, login, logout } = useAuth();
  const { data: user } = useUser();

  if (isLoading) return <p>Loading...</p>;
  if (!isAuthenticated)
    return <button onClick={() => login.getCode('+1555000000')}>Sign in</button>;

  return (
    <div>
      <p>Hello, {user?.name}</p>
      <button onClick={logout}>Sign out</button>
    </div>
  );
}
```

### Generic Runtime (non-Hono backends)

```ts
import { verifyRequest } from '@eva_solutions/auth-sdk/generic';

const result = await verifyRequest(request); // standard Web API Request

if (!result.ok) {
  return new Response('Unauthorized', { status: 401 });
}

const { payload, newCookies } = result.data;
// payload.id, payload.sessionId
// newCookies: string[] | undefined — forward to Set-Cookie if present
```

### Service-to-Service (S2S signing)

```ts
import { createS2SClient } from '@eva_solutions/auth-sdk/s2s';

const s2s = createS2SClient({
  secret: process.env.S2S_SECRET!,
  serviceId: 'my-service',
});

// All requests are automatically signed with HMAC
const user = await s2s.getUser('user-id-123');
```

Low-level signing (when you need manual control):

```ts
import { signS2SRequest } from '@eva_solutions/auth-sdk/s2s';

const signed = signS2SRequest({
  method: 'POST',
  url: 'https://auth.example.com/internal/users',
  body: JSON.stringify({ id: '123' }),
  secret: process.env.S2S_SECRET!,
  serviceId: 'my-service',
});

await fetch(signed.url, {
  method: signed.method,
  headers: signed.headers,
  body: signed.body,
});
```

### Verifying inbound S2S requests

If your service receives requests signed via `createS2SClient` or `signS2SRequest`,
use the server-side verification primitives to authenticate them.

#### Hono middleware (recommended for Hono apps)

```ts
import { Hono } from 'hono'
import { s2sAuth, requireScope } from '@eva_solutions/auth-sdk/hono'

const app = new Hono()

app.use('*', s2sAuth({
  secretStore: async (clientId) => {
    const client = await db.serviceClients.findBySlug(clientId)
    return client?.secretHash ?? null
  },
  scopesOf: async (clientId) => {
    const client = await db.serviceClients.findBySlug(clientId)
    return client?.scopes ?? []
  },
  onAuth: (clientId, scopes) => {
    logger.info({ clientId, scopes }, 's2s authenticated')
  },
}))

app.use('/admin/*', requireScope('admin'))

app.post('/internal/users', async (c) => {
  const clientId = c.get('s2sClientId')
  // ... handle request
})
```

On verification failure: responds with HTTP 401 and body `{ error: { code, message } }`.
On scope failure: responds with HTTP 403 and body `{ error: { code: 'forbidden', message } }`.

#### Framework-agnostic (Web API Request)

```ts
import { verifyS2SRequest } from '@eva_solutions/auth-sdk/s2s'

const result = await verifyS2SRequest({
  request,
  secretStore: async (clientId) => lookupSecret(clientId),
})

if (!result.ok) {
  return new Response(JSON.stringify({ error: result.error }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

const { clientId } = result.data
```

#### Replay protection

The SDK validates the `x-eva-timestamp` header against a configurable window
(default 120 seconds via `S2S_TIMESTAMP_WINDOW_SECONDS`), but does NOT
provide nonce-based replay protection out of the box. An attacker who
captures a valid request can replay it within the timestamp window.

For replay protection, combine `verifyS2SRequest` with a short-lived
nonce store (Redis SETNX is the canonical pattern):

```ts
import { verifyS2SRequest, S2S_TIMESTAMP_WINDOW_SECONDS } from '@eva_solutions/auth-sdk/s2s'

const result = await verifyS2SRequest({ request, secretStore })
if (!result.ok) return /* 401 */

const signature = request.headers.get('x-eva-signature')!
const wasNew = await redis.set(`s2s:nonce:${signature}`, '1', {
  NX: true,
  EX: S2S_TIMESTAMP_WINDOW_SECONDS,
})
if (!wasNew) return /* 401 replay_detected */
```

A future v1.2.0 will likely add a `replayCache` callback to `verifyS2SRequest`
to streamline this pattern.

---

### Webhook Verification

```ts
import { verifyWebhookSignature } from '@eva_solutions/auth-sdk/webhooks';

const isValid = await verifyWebhookSignature({
  payload: req.body,          // raw string body
  signature: req.headers['x-eva-signature']!,
  secret: process.env.WEBHOOK_SECRET!,
  timestamp: req.headers['x-eva-timestamp']!,
});

if (!isValid) return new Response('Forbidden', { status: 403 });
```

---

## Configuration

```ts
import { configureEvaAuth } from '@eva_solutions/auth-sdk';

// Call once at application boot, before any requests
configureEvaAuth({
  authUrl: 'https://auth.example.com',  // EVA Auth Service URL
  cookieDomain: '.example.com',         // share cookies across subdomains
  errorWire: 'api',                     // 'api' (default) | 'string' (legacy 0.x compat)
  errorMessages: {                      // optional — override SDK error messages
    authRequired: 'Authentication required',
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `authUrl` | `string` | build-time constant | EVA Auth Service base URL. Validated (must be `http` or `https`). |
| `cookieDomain` | `string` | `undefined` | Cookie `Domain` attribute — use `'.example.com'` for subdomain sharing. |
| `errorWire` | `'api' \| 'string'` | `'api'` | Wire shape for 4xx responses. `'api'` emits `{ error: { code, message } }`. `'string'` emits `{ error: string }` (legacy). |
| `errorMessages` | `Partial<EvaErrorMessages>` | built-in defaults | Granular override of SDK error messages (16 keys). Unknown keys throw. |

**Precedence** (highest wins): `configureEvaAuth({ authUrl })` > `process.env.EVA_AUTH_URL` > build-time constant.

For full configuration details see [docs/configuration.md](docs/configuration.md).

---

## Entry Points

The SDK exports 8 independent entry points. Import only what your runtime needs.

| Import | Description | Required peer |
|--------|-------------|---------------|
| `@eva_solutions/auth-sdk` | Core: client factory, JWT verify, JWKS, error system, types, constants | — |
| `@eva_solutions/auth-sdk/hono` | `evaAuth()` middleware, `evaAuthRoutes()`, helpers, cookies | `hono >=4` |
| `@eva_solutions/auth-sdk/react` | `EvaAuthProvider`, `useAuth`, `useUser`, `useSessions`, `useEmpresas`, `authFetch` | `react >=18` |
| `@eva_solutions/auth-sdk/generic` | `verifyRequest()`, `setTokenCookies()`, `clearTokenCookies()` — Web API `Request` | — |
| `@eva_solutions/auth-sdk/hono-openapi` | `evaAuthOpenAPIRoutes()` — OpenAPI 3.1 variant with `/doc` | `hono >=4`, `@hono/zod-openapi >=1.3.0` |
| `@eva_solutions/auth-sdk/webhooks` | `verifyWebhookSignature()`, `EVENT_CODES`, webhook types | — |
| `@eva_solutions/auth-sdk/admin` | `createAdminClient()` — service clients and user management | — |
| `@eva_solutions/auth-sdk/s2s` | `createS2SClient()`, `signS2SRequest()` — HMAC S2S signing | — |

---

## JWT Configuration

The SDK verifies tokens issued by the EVA Auth Service. The JWT `iss` and `aud` claim values are fixed to the values emitted by the official service (`iss: 'auth-service'`, `aud: 'proyecto-global'`). These values are not configurable — they reflect the Auth Service contract and are intentional.

---

## Error Handling

All SDK operations return `Result<T>` — never throw for business flows:

```ts
import { isNotFound, isUnauthorized, getMessage } from '@eva_solutions/auth-sdk';

const result = await client.getUser(id);

if (!result.ok) {
  if (isNotFound(result.error)) return c.notFound();
  if (isUnauthorized(result.error)) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ error: getMessage(result.error) }, 500);
}

return c.json(result.data);
```

Available error helpers (re-exported from core):

```ts
// Type guards
isApiError(err), isSdkError(err)

// Generic matchers
matchError(err, code), matchSdkReason(err, reason)

// API shortcuts (12)
isNotFound, isUnauthorized, isForbidden, isConflict,
isValidationError, isRateLimited, isGone, isUnprocessableEntity,
isBadRequest, isInternalError, isServiceUnavailable, isAccountStateLocked

// SDK shortcuts (6)
isNetworkError, isTokenInvalid, isAuthRequired,
isRefreshNoTokens, isVerifyFailed, isMalformed
```

---

## Documentation

Full API reference, architecture diagrams, and configuration guide are available at:

**[https://eva-solutions-org.github.io/auth-sdk](https://eva-solutions-org.github.io/auth-sdk)**

Generated with TypeDoc + DMT theme. Source in `docs/`.

| Document | Contents |
|----------|----------|
| [docs/api.md](docs/api.md) | Complete API reference per entry point |
| [docs/architecture.md](docs/architecture.md) | Two-layer model, full auth flow, module structure |
| [docs/configuration.md](docs/configuration.md) | Build-time model, runtime override, errorWire |
| [docs/security.md](docs/security.md) | Cookies, JWT, JWKS cache, deduplication |
| [docs/migration.md](docs/migration.md) | Migration guide 0.x → 1.0.0 |

---

## Security

Found a vulnerability? Please report it via [GitHub Security Advisories](https://github.com/eva-solutions-org/auth-sdk/security/advisories/new) or email `arturo.rodas.gonzales@gmail.com`. **Do not open a public issue for security reports.** See [SECURITY.md](./SECURITY.md) for the full disclosure process and response timeline.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, changeset process, and coding conventions. Please read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating.

---

## License

[MIT](./LICENSE) © 2026 EVA Solutions

---

*Built on [`jose`](https://github.com/panva/jose), [`hono`](https://hono.dev), [`react`](https://react.dev), and the broader TypeScript ecosystem.*

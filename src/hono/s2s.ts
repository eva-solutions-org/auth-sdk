/**
 * Hono middlewares for inbound S2S request authentication and scope-based authorization.
 *
 * REQ-HONO-AUTH-*, REQ-HONO-SCOPE-*, REQ-HONO-WIRE-*, REQ-API-02, REQ-API-03, REQ-API-05.
 *
 * Decisión in-flight B3-01: `cloneRawRequest` existe en Hono 4.12.19 bajo el entry point
 * `'hono/request'` (no `'hono/utils/request'` como estimaba el design). Se usa la ruta correcta
 * confirmada en node_modules/hono/package.json exports map: `"./request"` → `dist/request.js`.
 */

import { createMiddleware } from 'hono/factory'
import { cloneRawRequest } from 'hono/request'
import { verifyS2SRequest } from '../s2s/verify'
import type { S2SVerifyOptions } from '../s2s/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for the `s2sAuth` Hono middleware.
 * Extends `S2SVerifyOptions` (omits `request` — the middleware provides it internally).
 */
export type S2sAuthOptions = {
  /**
   * Callback that returns the plaintext secret (64 hex chars) for the given clientId,
   * or null if unknown. Return null — do NOT throw — for unknown clients.
   * D5 LOCKED: SDK does not assume any storage layer.
   */
  secretStore: S2SVerifyOptions['secretStore']
  /**
   * Optional callback that returns the scope list for the verified clientId.
   * If omitted, `c.var.s2sScopes` will be an empty array.
   */
  scopesOf?: (clientId: string) => Promise<readonly string[]>
  /**
   * Optional hook called after successful authentication and scope lookup, before `next()`.
   * Useful for audit logging, nonce tracking, or metrics.
   *
   * @throws If this hook throws, the middleware propagates the error and Hono returns HTTP 500.
   *   Catch errors inside the hook if you want different behavior.
   *
   * @example
   * ```ts
   * onAuth: (clientId, scopes) => logger.info({ clientId, scopes }, 's2s authenticated'),
   * ```
   */
  onAuth?: (clientId: string, scopes: readonly string[]) => void | Promise<void>
  /**
   * Override timestamp validation window in seconds.
   * Default: `S2S_TIMESTAMP_WINDOW_SECONDS` (120).
   */
  timestampWindowSeconds?: number
}

/**
 * Hono context variables set by `s2sAuth`.
 * Declare in your app type for full type inference:
 * ```ts
 * const app = new Hono<{ Variables: S2sAuthVariables }>()
 * ```
 */
export type S2sAuthVariables = {
  s2sClientId: string
  s2sScopes: readonly string[]
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

/**
 * Hono middleware that verifies inbound S2S requests signed with HMAC-SHA-256.
 *
 * On **success**: sets `c.var.s2sClientId` and `c.var.s2sScopes`, then calls `next()`.
 * On **failure**: responds with HTTP 401 `{ error: { code: <S2SVerifyReason>, message } }`.
 *
 * The middleware clones the request before reading the body (using Hono's `cloneRawRequest`),
 * so route handlers can still read the body after authentication — even if a prior middleware
 * already consumed the original stream.
 *
 * @see {@link requireScope} to enforce scope-based authorization after authentication.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { s2sAuth, requireScope } from '@eva_solutions/auth-sdk/hono'
 *
 * const app = new Hono()
 *
 * app.use('/api/*', s2sAuth({
 *   secretStore: async (clientId) => redis.get(`s2s:${clientId}:secret`),
 *   scopesOf: async (clientId) => redis.smembers(`s2s:${clientId}:scopes`),
 *   onAuth: (clientId, scopes) => logger.info({ clientId, scopes }, 's2s authenticated'),
 * }))
 *
 * app.get('/api/resource', (c) => {
 *   const clientId = c.var.s2sClientId   // available after s2sAuth
 *   const scopes   = c.var.s2sScopes
 *   return c.json({ clientId, scopes })
 * })
 * ```
 */
export function s2sAuth(
  opts: S2sAuthOptions,
): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>> {
  return createMiddleware<{ Variables: S2sAuthVariables }>(async (c, next) => {
    // Clone the request so route handlers can still read the body.
    // cloneRawRequest (Hono 4.12.19) handles the case where a prior middleware
    // already consumed the original ReadableStream by using HonoRequest's body cache.
    const clonedRequest = await cloneRawRequest(c.req)

    const result = await verifyS2SRequest(clonedRequest, {
      secretStore: opts.secretStore,
      timestampWindowSeconds: opts.timestampWindowSeconds,
    })

    if (!result.ok) {
      return c.json(
        { error: { code: result.error.reason, message: result.error.message } },
        401,
      )
    }

    const scopes: readonly string[] = opts.scopesOf
      ? await opts.scopesOf(result.data.clientId)
      : []

    c.set('s2sClientId', result.data.clientId)
    c.set('s2sScopes', scopes)

    if (opts.onAuth) {
      await opts.onAuth(result.data.clientId, scopes)
    }

    await next()
  })
}

/**
 * Hono middleware that requires a specific scope to be present in `c.var.s2sScopes`.
 *
 * Must be applied **after** `s2sAuth`. If `s2sAuth` was not applied, this middleware
 * throws a descriptive `Error` (programming error, results in HTTP 500).
 *
 * On **success** (scope present): calls `next()`.
 * On **failure** (scope absent): returns HTTP 403 `{ error: { code: 'insufficient_scope', required } }`.
 *
 * To require multiple scopes with AND semantics, chain multiple `requireScope` calls.
 *
 * @see v1.2.0 — multi-scope AND/OR planned via TypeScript overloads, non-breaking.
 *
 * @throws `Error` if `s2sAuth` was not applied before this middleware.
 *
 * @example
 * ```ts
 * app.use('/admin/*', s2sAuth({ secretStore }), requireScope('admin'))
 * app.use('/admin/users', requireScope('users:read'))   // AND with 'admin'
 * ```
 */
export function requireScope(
  scope: string,
): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>> {
  return createMiddleware<{ Variables: S2sAuthVariables }>(async (c, next) => {
    const scopes = c.var.s2sScopes

    if (scopes === undefined) {
      throw new Error(
        '[eva-auth-sdk] requireScope: s2sAuth middleware not applied — apply s2sAuth() before requireScope()',
      )
    }

    if (!scopes.includes(scope)) {
      return c.json(
        { error: { code: 'insufficient_scope', required: scope } },
        403,
      )
    }

    await next()
  })
}

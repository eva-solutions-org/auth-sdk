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
import {
  assertServiceTokenOptions,
  verifyServiceToken,
} from '../s2s/service-token'
import type { ServiceTokenVerifyOptions } from '../s2s/service-token'
import {
  assertDelegatedTokenOptions,
  verifyDelegatedToken,
} from '../s2s/delegated-token'
import type {
  DelegatedActor,
  DelegatedTokenVerifyOptions,
} from '../s2s/delegated-token'
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
  /**
   * Optional replay-protection cache. If provided, each verified request's key
   * (`${clientId}:${nonce}`) is atomically inserted with a TTL of
   * `2 * timestampWindowSeconds + 1`; if already present the request is rejected with `replay_detected`.
   *
   * @since v1.1.0
   * @see verifyS2SRequest for the full `setIfAbsent` contract and nonce format.
   */
  replayCache?: S2SVerifyOptions['replayCache']
  /**
   * Optional message overrides for error reasons (i18n / custom wording).
   * Any key not overridden falls back to the built-in English default.
   *
   * @since v1.1.0
   * @see verifyS2SRequest for the full `messages` contract and default strings.
   */
  messages?: S2SVerifyOptions['messages']
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
      replayCache: opts.replayCache,
      messages: opts.messages,
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
 * On **failure** (scope absent): returns HTTP 403 with `{ error: { code: 'insufficient_scope', ... } }`.
 *
 * @throws `TypeError` at setup-time if the argument is invalid (empty object, empty array,
 *   or both `all` and `any` specified simultaneously).
 * @throws `Error` at runtime if `s2sAuth` was not applied before this middleware.
 *
 * @example
 * ```ts
 * // Single scope (legacy — unchanged)
 * app.use('/admin/*', s2sAuth({ secretStore }), requireScope('admin'))
 *
 * // AND semantics — all scopes must be present
 * app.use('/admin/*', s2sAuth({ secretStore }), requireScope({ all: ['admin', 'audit'] }))
 *
 * // OR semantics — at least one scope must be present
 * app.use('/data/*', s2sAuth({ secretStore }), requireScope({ any: ['data:read', 'data:write'] }))
 * ```
 */
export function requireScope(
  scope: string,
): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>>
/**
 * Hono middleware that requires **all** listed scopes to be present (AND semantics).
 *
 * On failure returns HTTP 403 with `{ error: { code: 'insufficient_scope', requiredAll, missing } }`.
 *
 * @since v1.1.0
 * @throws `TypeError` at setup-time if `all` is an empty array.
 */
export function requireScope(spec: {
  all: readonly string[]
}): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>>
/**
 * Hono middleware that requires **at least one** of the listed scopes to be present (OR semantics).
 *
 * On failure returns HTTP 403 with `{ error: { code: 'insufficient_scope', requiredAny } }`.
 *
 * @since v1.1.0
 * @throws `TypeError` at setup-time if `any` is an empty array.
 */
export function requireScope(spec: {
  any: readonly string[]
}): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>>
export function requireScope(
  arg: string | { all?: readonly string[]; any?: readonly string[] },
): ReturnType<typeof createMiddleware<{ Variables: S2sAuthVariables }>> {
  // Setup-time guards (D23)
  if (arg === null || arg === undefined) {
    throw new TypeError('requireScope: scope argument required')
  }
  if (typeof arg === 'object') {
    const hasAll = 'all' in arg && arg.all !== undefined
    const hasAny = 'any' in arg && arg.any !== undefined
    if (hasAll && hasAny) {
      throw new TypeError("requireScope: cannot use both 'all' and 'any'")
    }
    if (!hasAll && !hasAny) {
      throw new TypeError("requireScope: must specify 'all' or 'any'")
    }
    if (hasAll && arg.all!.length === 0) {
      throw new TypeError("requireScope: 'all' cannot be empty")
    }
    if (hasAny && arg.any!.length === 0) {
      throw new TypeError("requireScope: 'any' cannot be empty")
    }
  }

  return createMiddleware<{ Variables: S2sAuthVariables }>(async (c, next) => {
    // Tras `s2sAuth` (HMAC) vive en `s2sScopes`; tras `serviceTokenAuth` (Bearer), en `serviceScopes`.
    const vars =
      c.var.s2sScopes ??
      (c.var as unknown as { serviceScopes?: readonly string[] }).serviceScopes

    if (vars === undefined) {
      throw new Error(
        '[eva-auth-sdk] requireScope: no auth middleware applied — apply s2sAuth() or serviceTokenAuth() before requireScope()',
      )
    }

    if (typeof arg === 'string') {
      // Single scope — legacy wire format preserved (S-LEGACY-01)
      if (!vars.includes(arg)) {
        return c.json(
          { error: { code: 'insufficient_scope', required: arg } },
          403,
        )
      }
    } else if ('all' in arg && arg.all) {
      // AND semantics
      const required = arg.all
      const missing = required.filter((s) => !vars.includes(s))
      if (missing.length > 0) {
        return c.json(
          {
            error: {
              code: 'insufficient_scope',
              requiredAll: required,
              missing,
            },
          },
          403,
        )
      }
    } else if ('any' in arg && arg.any) {
      // OR semantics
      const required = arg.any
      const hasAnyScope = required.some((s) => vars.includes(s))
      if (!hasAnyScope) {
        return c.json(
          { error: { code: 'insufficient_scope', requiredAny: required } },
          403,
        )
      }
    }

    await next()
  })
}

// ---------------------------------------------------------------------------
// Token de servicio (Bearer de otro servicio, o del propio Auth en el OTP)
// ---------------------------------------------------------------------------

/** Options for `serviceTokenAuth`: those of `verifyServiceToken` (the middleware provides the token). */
export type ServiceTokenAuthOptions = ServiceTokenVerifyOptions

/**
 * Hono context variables set by `serviceTokenAuth`.
 */
export type ServiceTokenAuthVariables = {
  /** `sub` del token: id interno estable del service client. Es la identidad. */
  serviceClientId: string
  /** `client_id` del token: slug del service client. Dato visible, no identidad. */
  serviceClientSlug: string
  serviceScopes: readonly string[]
}

// El esquema se compara sin distinguir mayúsculas (RFC 9110 §11.1: `bearer` también es válido).
const BEARER_REGEX =
  /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i

/**
 * Hono middleware that verifies the service token (ES256, `typ: 'svc-at+jwt'`, `kid` `svc-…`, `aud`
 * of this service, `scope`) sent as `Authorization: Bearer`. See `verifyServiceToken` for the
 * token contract.
 *
 * On **success**: sets `c.var.serviceClientId` (`sub`), `c.var.serviceClientSlug` (`client_id`) and
 * `c.var.serviceScopes`, then calls `next()`.
 * On **failure**: HTTP 401 `{ error: { code: <ServiceTokenVerifyReason>, message } }`, or HTTP 403
 * with code `insufficient_scope` when the token is valid but lacks the required scope.
 *
 * JWKS/config failures are not rejections: they propagate and Hono answers 500.
 *
 * With `scopeCheck: 'deferred'` the token is authenticated but no permission is required here; mount
 * `requireScope(...)` per route afterwards (it reads `serviceScopes` when `s2sScopes` is absent).
 *
 * @throws `TypeError` when the middleware is built with options that are not valid for the
 *   catalog (unknown audience, a permission of another audience, no permission rule).
 *
 * @example
 * ```ts
 * app.use(
 *   '/v1/internal/messages/*',
 *   serviceTokenAuth({ audience: 'whatsapp-api', requiredScope: 'messages:send:text' }),
 * )
 * ```
 */
export function serviceTokenAuth(
  opts: ServiceTokenAuthOptions,
): ReturnType<
  typeof createMiddleware<{ Variables: ServiceTokenAuthVariables }>
> {
  // Las opciones se validan al construir el middleware (falla al arrancar), no en cada request.
  assertServiceTokenOptions(opts)
  return createMiddleware<{ Variables: ServiceTokenAuthVariables }>(
    async (c, next) => {
      const bearer = c.req.header('authorization')?.match(BEARER_REGEX)
      const result = bearer
        ? await verifyServiceToken(bearer[1] as string, opts)
        : ({
            ok: false,
            error: {
              reason: 'token_missing',
              message:
                opts.messages?.token_missing ?? 'Bearer token is missing',
            },
          } as const)

      if (!result.ok) {
        if (result.error.reason === 'scope_insufficient') {
          return c.json(
            {
              error: {
                code: 'insufficient_scope',
                message: result.error.message,
              },
            },
            403,
          )
        }
        return c.json(
          {
            error: { code: result.error.reason, message: result.error.message },
          },
          401,
        )
      }

      c.set('serviceClientId', result.data.serviceClientId)
      c.set('serviceClientSlug', result.data.serviceClientSlug)
      c.set('serviceScopes', result.data.scopes)
      await next()
    },
  )
}

// ---------------------------------------------------------------------------
// Token delegado (otro servicio actuando en nombre de un usuario)
// ---------------------------------------------------------------------------

/** Options for `delegatedTokenAuth`: those of `verifyDelegatedToken` (the middleware provides the token). */
export type DelegatedTokenAuthOptions = DelegatedTokenVerifyOptions

/**
 * Hono context variables set by `delegatedTokenAuth`.
 */
export type DelegatedTokenAuthVariables = {
  /** `sub` del token: el usuario en cuyo nombre se actúa. */
  userId: string
  /** `empresa`: obligatoria en toda la cadena. */
  empresaId: string
  /** `producto` de origen de la cadena. */
  producto: string
  /** `sid`: sesión de origen. */
  sessionId: string
  /** Cadena de actores, del último (quien llama a este servicio) al primero. */
  actorChain: readonly DelegatedActor[]
  /** Permisos del token. */
  scopes: readonly string[]
}

/**
 * Hono middleware that verifies the delegated token (ES256, `typ: 'dlg-at+jwt'`, `kid` `svc-…`, one
 * `aud` = this service, never `auth-api`, mandatory `empresa`) sent as `Authorization: Bearer`. See
 * `verifyDelegatedToken` for the token contract. It accepts NOTHING else: a service token, a user
 * access token and a delegated token are three different types and each verifier takes only its own.
 *
 * On **success**: sets `c.var.userId`, `empresaId`, `producto`, `sessionId`, `actorChain` and
 * `scopes`, then calls `next()`.
 * On **failure**: HTTP 401 `{ error: { code: <reason>, message } }`, or HTTP 403 with code
 * `insufficient_scope` when the token is valid but lacks the required scope.
 *
 * With `scopeCheck: 'deferred'` no permission is required here; check `c.var.scopes` in the route.
 * (`requireScope` reads the scopes of `s2sAuth` / `serviceTokenAuth` and does not apply here.)
 *
 * The receiving service does not see the roles of the product: the product that acted is
 * responsible for having checked the permission of the person before asking for the token.
 *
 * @throws `TypeError` when the middleware is built with options that are not valid for the catalog.
 *
 * @example
 * ```ts
 * app.use(
 *   '/v1/stock/*',
 *   delegatedTokenAuth({ audience: 'whatsapp-api', requiredScope: 'messages:send:text' }),
 * )
 * ```
 */
export function delegatedTokenAuth(
  opts: DelegatedTokenAuthOptions,
): ReturnType<
  typeof createMiddleware<{ Variables: DelegatedTokenAuthVariables }>
> {
  assertDelegatedTokenOptions(opts)
  return createMiddleware<{ Variables: DelegatedTokenAuthVariables }>(
    async (c, next) => {
      const bearer = c.req.header('authorization')?.match(BEARER_REGEX)
      const result = bearer
        ? await verifyDelegatedToken(bearer[1] as string, opts)
        : ({
            ok: false,
            error: {
              reason: 'token_missing',
              message:
                opts.messages?.token_missing ?? 'Bearer token is missing',
            },
          } as const)

      if (!result.ok) {
        if (result.error.reason === 'scope_insufficient') {
          return c.json(
            {
              error: {
                code: 'insufficient_scope',
                message: result.error.message,
              },
            },
            403,
          )
        }
        return c.json(
          {
            error: { code: result.error.reason, message: result.error.message },
          },
          401,
        )
      }

      c.set('userId', result.data.userId)
      c.set('empresaId', result.data.empresaId)
      c.set('producto', result.data.producto)
      c.set('sessionId', result.data.sessionId)
      c.set('actorChain', result.data.actorChain)
      c.set('scopes', result.data.scopes)
      await next()
    },
  )
}

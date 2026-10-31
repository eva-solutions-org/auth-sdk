/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). The closed catalog of service audiences and, for each, its permissions.
 *
 * Apart from `tokens.ts` and `constants.ts` on purpose: the SDK `react` entry is size-budgeted and
 * reaches `constants.ts` (header names), so nothing the browser does not need goes there. The SDK
 * `react` closure imports neither this catalog nor the token vocabulary; Auth uses
 * `isServiceAudience` to keep product slugs and service audiences apart.
 */

/**
 * Closed catalog of service audiences and, for each one, the permissions a service client can be
 * granted on it. The service token `aud` is one of these keys and its `scope` a subset of the
 * values. Add a permission here only together with the route that requires it.
 *
 * `admin` is NOT a permission of `auth-api`: the Auth admin surface authenticates with the signed
 * request of a service client flagged `esAdmin`, never with a token. It IS a permission of
 * `whatsapp-api`.
 */
export const SERVICE_AUDIENCE_SCOPES = {
  'auth-api': [
    'users:read',
    'webhooks:read',
    'webhooks:write',
    'empresas:leer',
    'empresas:escribir',
  ],
  'whatsapp-api': ['messages:send:text', 'messages:send:media', 'admin'],
} as const

export type ServiceAudience = keyof typeof SERVICE_AUDIENCE_SCOPES

/** Service audiences as a tuple, so schemas can build an enum straight from it. */
export const SERVICE_AUDIENCES = [
  'auth-api',
  'whatsapp-api',
] as const satisfies readonly ServiceAudience[]

export type ServiceScope<A extends ServiceAudience = ServiceAudience> =
  (typeof SERVICE_AUDIENCE_SCOPES)[A][number]

/** True when `value` is an audience of the catalog. */
export function isServiceAudience(value: string): value is ServiceAudience {
  return Object.hasOwn(SERVICE_AUDIENCE_SCOPES, value)
}

/** True when `scope` is a permission of `audience` in the catalog (an unknown audience is false). */
export function isScopeOfAudience(audience: string, scope: string): boolean {
  return (
    isServiceAudience(audience) &&
    (SERVICE_AUDIENCE_SCOPES[audience] as readonly string[]).includes(scope)
  )
}

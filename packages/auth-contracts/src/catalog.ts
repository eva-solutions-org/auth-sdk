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
    'tokens:exchange',
    'contrataciones:pedir',
    'contrataciones:escribir',
    'contrataciones:leer',
    'empresas:baja',
    'autorizaciones:escribir',
    'autorizaciones:leer',
    'directorio:leer',
    'login:client-ip',
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

/**
 * Permissions a service client can DELEGATE on behalf of a user (token exchange), by destination
 * audience. A delegation edge (`service_client_delegations`) can only carry these.
 *
 * Narrower than {@link SERVICE_AUDIENCE_SCOPES} on purpose: `auth-api` is never a destination (Auth
 * is the issuer, so no delegated token talks to it) and `admin` is never delegable. A test pins both
 * and that every value is in the audience catalog.
 */
export const DELEGABLE_AUDIENCE_SCOPES = {
  'whatsapp-api': ['messages:send:text', 'messages:send:media'],
} as const satisfies {
  [A in Exclude<ServiceAudience, 'auth-api'>]: readonly Exclude<
    ServiceScope<A>,
    'admin'
  >[]
}

/** Audiences that can be the destination of a delegated token. */
export type DelegableAudience = keyof typeof DELEGABLE_AUDIENCE_SCOPES

/** Delegable audiences as a tuple, so schemas can build an enum straight from it. */
export const DELEGABLE_AUDIENCES = [
  'whatsapp-api',
] as const satisfies readonly DelegableAudience[]

export type DelegableScope<A extends DelegableAudience = DelegableAudience> =
  (typeof DELEGABLE_AUDIENCE_SCOPES)[A][number]

/** Every delegable permission of every audience, flat (a scope string names its audience's service). */
export const DELEGABLE_SCOPES = Object.values(
  DELEGABLE_AUDIENCE_SCOPES,
).flat() as unknown as readonly [DelegableScope, ...DelegableScope[]]

/** True when `audience` can be the destination of a delegated token. */
export function isDelegableAudience(value: string): value is DelegableAudience {
  return Object.hasOwn(DELEGABLE_AUDIENCE_SCOPES, value)
}

/** True when `scope` can be delegated towards `audience` (an unknown or non-delegable audience is false). */
export function isDelegableScope(audience: string, scope: string): boolean {
  return (
    isDelegableAudience(audience) &&
    (DELEGABLE_AUDIENCE_SCOPES[audience] as readonly string[]).includes(scope)
  )
}

/**
 * Closed catalog of permissions BETWEEN companies ("company B may do X on the data of company A"),
 * by the service audience that owns the data. Kept apart from {@link SERVICE_AUDIENCE_SCOPES} on
 * purpose: those say what a service CLIENT can do, these say what a COMPANY authorizes another
 * company to do. They are only for private data; public or shared data needs none.
 *
 * Starts minimal and each owning service adds its own (together with the route that checks it).
 * `auth-api` owns none: it only stores and answers the grants.
 */
export const INTER_EMPRESA_PERMISSIONS = {
  'whatsapp-api': ['whatsapp:mensajes:leer'],
} as const satisfies Partial<
  Record<Exclude<ServiceAudience, 'auth-api'>, readonly string[]>
>

/** Audience that owns a block of inter-company permissions. */
export type InterEmpresaOwner = keyof typeof INTER_EMPRESA_PERMISSIONS

export type InterEmpresaPermission =
  (typeof INTER_EMPRESA_PERMISSIONS)[InterEmpresaOwner][number]

/** Every inter-company permission, flat, so schemas can build an enum straight from it. */
export const INTER_EMPRESA_PERMISSION_LIST = Object.values(
  INTER_EMPRESA_PERMISSIONS,
).flat() as unknown as readonly [
  InterEmpresaPermission,
  ...InterEmpresaPermission[],
]

/** True when `value` is a permission of the inter-company catalog. */
export function isInterEmpresaPermission(
  value: string,
): value is InterEmpresaPermission {
  return (INTER_EMPRESA_PERMISSION_LIST as readonly string[]).includes(value)
}

/** The audience that owns `permission` (the only one that may verify it), or `undefined`. */
export function interEmpresaPermissionOwner(
  permission: string,
): InterEmpresaOwner | undefined {
  return (Object.keys(INTER_EMPRESA_PERMISSIONS) as InterEmpresaOwner[]).find(
    (owner) =>
      (INTER_EMPRESA_PERMISSIONS[owner] as readonly string[]).includes(
        permission,
      ),
  )
}

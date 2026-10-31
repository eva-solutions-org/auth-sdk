/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). Token vocabulary shared by the Auth service and every consumer: issuer, token
 * types, key prefixes, lifetimes and the token endpoint error codes.
 */

/** Issuer (`iss`) of every token the Auth service signs. */
export const TOKEN_ISSUER = 'auth-service'

/**
 * Service client slugs nobody can create: the token issuer name (an `iss`-like value would let a
 * client pass for the service itself).
 */
export const RESERVED_SERVICE_CLIENT_SLUGS = [TOKEN_ISSUER] as const

/** True when `slug` is reserved and cannot be used as a service client slug. */
export function isReservedServiceClientSlug(slug: string): boolean {
  return (RESERVED_SERVICE_CLIENT_SLUGS as readonly string[]).includes(slug)
}

/**
 * Fixed id (`sub`) of the Auth service itself when it mints its own service tokens (the OTP send).
 * Receivers register it like any other service client id.
 */
export const AUTH_SERVICE_SUB = '00000000-0000-4000-8000-000000000001'

/** Header `typ` of a user access token (RFC 9068). */
export const USER_TOKEN_TYP = 'at+jwt'

/** Header `typ` of a service access token. Distinct from the user one on purpose (RFC 8725 3.11). */
export const SERVICE_TOKEN_TYP = 'svc-at+jwt'

/** The `kid` of a user signing key starts with this prefix. */
export const USER_KID_PREFIX = 'usr-'

/** The `kid` of a service signing key starts with this prefix. */
export const SERVICE_KID_PREFIX = 'svc-'

/** Lifetime in seconds of a service token obtained from the token endpoint. */
export const SERVICE_TOKEN_LIFETIME_SECONDS = 300

/** Lifetime in seconds of the single-use service token Auth mints in-process per OTP send. */
export const INTERNAL_SERVICE_TOKEN_LIFETIME_SECONDS = 60

/**
 * Error codes of the token endpoint (RFC 6749 5.2 and RFC 8707 2). Throttling a client has no
 * code of its own: it answers `429` with `temporarily_unavailable` and a `Retry-After` header (the
 * SDK token provider reads both).
 */
export const SERVICE_TOKEN_ERROR_CODES = [
  'invalid_request',
  'invalid_client',
  'invalid_target',
  'invalid_scope',
  'temporarily_unavailable',
] as const

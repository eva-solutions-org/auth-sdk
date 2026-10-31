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

/**
 * Header `typ` of a delegated access token (token exchange, RFC 8693). A third type, distinct from
 * the user and service ones: it is signed with a SERVICE key (`svc-` kid) but no service verifier
 * accepts it, and the delegated verifier accepts nothing else.
 */
export const DELEGATED_TOKEN_TYP = 'dlg-at+jwt'

/** Lifetime in seconds of a delegated token (`exp` never exceeds the one of the subject token). */
export const DELEGATED_TOKEN_LIFETIME_SECONDS = 120

/**
 * Most levels the `act` (actor) chain of a delegated token can have. A delegated token that
 * already has this many levels cannot be exchanged again.
 */
export const DELEGATED_TOKEN_MAX_DEPTH = 3

/** `grant_type` of the token exchange request (RFC 8693 2.1). */
export const TOKEN_EXCHANGE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:token-exchange'

/**
 * Token type identifier for `subject_token_type` (what is exchanged) and `issued_token_type` (what
 * comes back): both are JWT access tokens (RFC 8693 3).
 */
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

/**
 * Claims of a delegated token (the `act` claim, RFC 8693 4.1): who acts on behalf of the user.
 * `act` of the token is the LAST actor; each nested `act` is the previous one.
 */
export type DelegatedActorClaim = {
  sub: string
  client_id: string
  act?: DelegatedActorClaim
}

/**
 * Header with which a service sends the access token of a person on the requests that cannot carry
 * a body (the `GET` that needs a person's role). Every other person-bound request carries it as
 * `subjectToken` in the body.
 */
export const SUBJECT_TOKEN_HEADER = 'x-eva-subject-token'

/**
 * Error codes of the token exchange endpoint (RFC 6749 5.2, RFC 8693 2.2.2 and RFC 8707 2).
 * `invalid_grant`: the subject token or what it depends on (session, user, membership, company,
 * contract, depth, cycle) is not valid. Throttling answers `429` with `temporarily_unavailable`.
 */
export const TOKEN_EXCHANGE_ERROR_CODES = [
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'invalid_target',
  'invalid_scope',
  'temporarily_unavailable',
] as const

/**
 * Failure of the PERSON's token (`subjectToken`) on a person-bound request: invalid, expired, of
 * another product, or its session/user is gone. It answers `403` with this code, never `401`: a
 * `401` on `/internal/*` means the service Bearer was rejected (the S2S client then drops its
 * service token and retries once), and a bad person token must not trigger that.
 */
export const SUBJECT_TOKEN_INVALID_STATUS = 403
export const SUBJECT_TOKEN_INVALID_CODE = 'subject_token_invalid'

/**
 * Keys that carry a person or service token in bodies, headers and token endpoint answers. The
 * Auth API redacts them in logs and audit records. It is ADDED to the consumer's own redaction
 * list (which already covers `refresh_token`, `authorization` and the like); it does not replace it.
 */
export const TOKEN_BEARING_KEYS = [
  'subjectToken',
  'subject_token',
  'x-eva-subject-token',
  'access_token',
] as const

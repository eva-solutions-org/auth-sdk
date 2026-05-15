/**
 * Catálogo de error codes del Auth Service y reasons internos del SDK.
 *
 * - ERROR_CODES: espejo del as const runtime del API (12 entries). Solo aplica a EvaApiError (kind: 'api').
 * - SDK_ERROR_REASONS: enum cerrado de reasons internos del SDK (6 entries). Solo aplica a EvaSdkError (kind: 'sdk').
 *
 * D-07 LOCKED: el catálogo replica el runtime del API (12 codes, incluyendo account_state_locked).
 * D-08 LOCKED: dual type CoreErrorCode / ErrorCode para catálogo semiabierto con autocomplete.
 */

export const ERROR_CODES = {
  account_state_locked: 'account_state_locked',
  unauthorized: 'unauthorized',
  validation_error: 'validation_error',
  not_found: 'not_found',
  conflict: 'conflict',
  forbidden: 'forbidden',
  rate_limited: 'rate_limited',
  gone: 'gone',
  unprocessable_entity: 'unprocessable_entity',
  bad_request: 'bad_request',
  internal_error: 'internal_error',
  service_unavailable: 'service_unavailable',
} as const

/**
 * Unión cerrada de los 12 error codes core del Auth Service.
 * Para autocomplete exhaustivo con los valores del API.
 */
export type CoreErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Tipo semiabierto: incluye los 12 cores (con autocomplete) y permite
 * strings adicionales para feature-specific codes del API.
 * Pattern idiomático TS: `LiteralType | (string & {})`.
 */
export type ErrorCode = CoreErrorCode | (string & {})

/**
 * Reasons internos del SDK — enum cerrado, 6 valores.
 * Solo aplican a EvaSdkError (kind: 'sdk').
 */
export const SDK_ERROR_REASONS = {
  /** No hay tokens en el request (sin cookies). */
  auth_required: 'auth_required',
  /** Token presente pero inválido (signature/format/expiry). */
  token_invalid: 'token_invalid',
  /** Refresh exitoso pero el servidor no devolvió tokens nuevos. */
  refresh_no_tokens: 'refresh_no_tokens',
  /** Fallo de verificación no clasificable (post-refresh). */
  verify_failed: 'verify_failed',
  /** Error de red / fetch fallido. */
  network: 'network',
  /** Respuesta HTTP no parseable o sin el shape esperado. */
  malformed: 'malformed',
} as const

/**
 * Unión cerrada de los 6 reasons internos del SDK.
 */
export type SdkErrorReason = (typeof SDK_ERROR_REASONS)[keyof typeof SDK_ERROR_REASONS]

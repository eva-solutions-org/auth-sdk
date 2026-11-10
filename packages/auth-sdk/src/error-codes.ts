/**
 * Catálogo de error codes del Auth Service y reasons internos del SDK.
 *
 * - ERROR_CODES: re-export del contrato compartido (12 entries, mismo objeto que usa el API). Solo aplica a EvaApiError (kind: 'api').
 * - SDK_ERROR_REASONS: enum cerrado de reasons internos del SDK (6 entries). Solo aplica a EvaSdkError (kind: 'sdk').
 *
 * D-07 LOCKED: el catálogo replica el runtime del API (12 codes, incluyendo account_state_locked).
 * D-08 LOCKED: dual type CoreErrorCode / ErrorCode para catálogo semiabierto con autocomplete.
 */

import type { CoreErrorCode } from '@eva_solutions/auth-contracts'

/*
 * `ERROR_CODES` y `CoreErrorCode` vienen del contrato. Este módulo es alcanzable desde
 * `src/react`: de la barrel del contrato solo se importan VALORES de módulos puros
 * (`constants.ts`, `routes.ts`) o `import type`. Un schema importado por valor aquí arrastraría
 * su código al bundle de react.
 */
export { ERROR_CODES } from '@eva_solutions/auth-contracts'

/**
 * Unión cerrada de los 12 error codes core del Auth Service.
 * Para autocomplete exhaustivo con los valores del API.
 */
export type { CoreErrorCode }

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
export type SdkErrorReason =
  (typeof SDK_ERROR_REASONS)[keyof typeof SDK_ERROR_REASONS]

/**
 * Helpers semánticos para inspeccionar EvaError sin conocer los internals del SDK.
 *
 * El consumidor NO debe inspeccionar `err.kind` ni comparar contra `ERROR_CODES`
 * directamente. Use los helpers exportados aquí.
 *
 * Exports:
 *   - Branch guards: isApiError, isSdkError
 *   - Generic matchers: matchError, matchSdkReason
 *   - API shortcut predicates (12): isNotFound, isUnauthorized, isForbidden,
 *     isConflict, isValidationError, isRateLimited, isGone, isUnprocessableEntity,
 *     isBadRequest, isInternalError, isServiceUnavailable, isAccountStateLocked
 *   - SDK shortcut predicates (6): isNetworkError, isTokenInvalid, isAuthRequired,
 *     isRefreshNoTokens, isVerifyFailed, isMalformed
 */

import { ERROR_CODES, SDK_ERROR_REASONS } from './error-codes'
import type { ErrorCode, SdkErrorReason } from './error-codes'
import type { EvaApiError, EvaSdkError, EvaError } from './types'

// ---------------------------------------------------------------------------
// Branch guards
// ---------------------------------------------------------------------------

/**
 * Narrows EvaError a EvaApiError (kind: 'api').
 * Use para acceder a `.code`, `.status`, `.message` del error del API.
 */
export function isApiError(err: EvaError): err is EvaApiError {
  return err.kind === 'api'
}

/**
 * Narrows EvaError a EvaSdkError (kind: 'sdk').
 * Use para acceder a `.reason`, `.status`, `.message` del error interno del SDK.
 */
export function isSdkError(err: EvaError): err is EvaSdkError {
  return err.kind === 'sdk'
}

// ---------------------------------------------------------------------------
// Generic matchers
// ---------------------------------------------------------------------------

/**
 * Comprueba si err es un EvaApiError con el code exacto indicado.
 * Útil para codes feature-specific que no tienen shortcut propio.
 *
 * @example
 * if (matchError(r.error, ERROR_CODES.conflict)) { ... }
 * if (matchError(r.error, 'service_client_already_exists')) { ... }
 */
export function matchError<TCode extends ErrorCode>(
  err: EvaError,
  code: TCode,
): err is EvaApiError & { code: TCode } {
  return isApiError(err) && err.code === code
}

/**
 * Comprueba si err es un EvaSdkError con el reason exacto indicado.
 *
 * @example
 * if (matchSdkReason(r.error, SDK_ERROR_REASONS.network)) { ... }
 */
export function matchSdkReason<TReason extends SdkErrorReason>(
  err: EvaError,
  reason: TReason,
): err is EvaSdkError & { reason: TReason } {
  return isSdkError(err) && err.reason === reason
}

// ---------------------------------------------------------------------------
// API shortcut predicates (12 — uno por code de ERROR_CODES)
// ---------------------------------------------------------------------------

/** El recurso solicitado no existe (HTTP 404). */
export function isNotFound(err: EvaError): err is EvaApiError & { code: 'not_found' } {
  return matchError(err, ERROR_CODES.not_found)
}

/** Token o credenciales inválidos (HTTP 401). */
export function isUnauthorized(err: EvaError): err is EvaApiError & { code: 'unauthorized' } {
  return matchError(err, ERROR_CODES.unauthorized)
}

/** Acción no permitida para el usuario autenticado (HTTP 403). */
export function isForbidden(err: EvaError): err is EvaApiError & { code: 'forbidden' } {
  return matchError(err, ERROR_CODES.forbidden)
}

/** El recurso ya existe o hay conflicto de estado (HTTP 409). */
export function isConflict(err: EvaError): err is EvaApiError & { code: 'conflict' } {
  return matchError(err, ERROR_CODES.conflict)
}

/** Los datos de entrada no superaron la validación (HTTP 422). */
export function isValidationError(
  err: EvaError,
): err is EvaApiError & { code: 'validation_error' } {
  return matchError(err, ERROR_CODES.validation_error)
}

/** Límite de requests excedido (HTTP 429). */
export function isRateLimited(err: EvaError): err is EvaApiError & { code: 'rate_limited' } {
  return matchError(err, ERROR_CODES.rate_limited)
}

/** El recurso fue eliminado permanentemente (HTTP 410). */
export function isGone(err: EvaError): err is EvaApiError & { code: 'gone' } {
  return matchError(err, ERROR_CODES.gone)
}

/** La entidad no puede procesarse según las reglas de negocio (HTTP 422). */
export function isUnprocessableEntity(
  err: EvaError,
): err is EvaApiError & { code: 'unprocessable_entity' } {
  return matchError(err, ERROR_CODES.unprocessable_entity)
}

/** Request malformada o con parámetros inválidos (HTTP 400). */
export function isBadRequest(err: EvaError): err is EvaApiError & { code: 'bad_request' } {
  return matchError(err, ERROR_CODES.bad_request)
}

/** Error interno del servidor (HTTP 500). */
export function isInternalError(err: EvaError): err is EvaApiError & { code: 'internal_error' } {
  return matchError(err, ERROR_CODES.internal_error)
}

/** El servicio no está disponible (HTTP 503). */
export function isServiceUnavailable(
  err: EvaError,
): err is EvaApiError & { code: 'service_unavailable' } {
  return matchError(err, ERROR_CODES.service_unavailable)
}

/** La cuenta está bloqueada por estado (HTTP 403). */
export function isAccountStateLocked(
  err: EvaError,
): err is EvaApiError & { code: 'account_state_locked' } {
  return matchError(err, ERROR_CODES.account_state_locked)
}

// ---------------------------------------------------------------------------
// SDK shortcut predicates (6 — uno por SdkErrorReason)
// ---------------------------------------------------------------------------

/** Fallo de red o fetch (no se pudo contactar al servidor). */
export function isNetworkError(err: EvaError): err is EvaSdkError & { reason: 'network' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.network)
}

/** Token presente pero inválido (signature/format/expiry). */
export function isTokenInvalid(err: EvaError): err is EvaSdkError & { reason: 'token_invalid' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.token_invalid)
}

/** No hay tokens en el request (sin cookies de autenticación). */
export function isAuthRequired(err: EvaError): err is EvaSdkError & { reason: 'auth_required' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.auth_required)
}

/** Refresh exitoso pero el servidor no devolvió tokens nuevos. */
export function isRefreshNoTokens(
  err: EvaError,
): err is EvaSdkError & { reason: 'refresh_no_tokens' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.refresh_no_tokens)
}

/** Fallo de verificación no clasificable (post-refresh). */
export function isVerifyFailed(err: EvaError): err is EvaSdkError & { reason: 'verify_failed' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.verify_failed)
}

/** Respuesta HTTP no parseable o sin el shape esperado. */
export function isMalformed(err: EvaError): err is EvaSdkError & { reason: 'malformed' } {
  return matchSdkReason(err, SDK_ERROR_REASONS.malformed)
}

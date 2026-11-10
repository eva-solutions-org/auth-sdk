/**
 * Distingue un fallo transitorio de verificación (JWKS inaccesible, red) de un token realmente
 * inválido, sin cambiar el `Result` público de `verifyAccessToken`: el resultado sigue siendo
 * `token_invalid` (401); solo el objeto de error queda marcado aquí, para los middlewares que
 * deben decidir entre cerrar la sesión (token inválido) y reintentar (503).
 *
 * Solo aplica a la etapa de `jwtVerify` (firma y resolución de clave). Lo que lance el parseo de
 * `extraClaimsSchema` es siempre definitivo.
 */

const transientFailures = new WeakSet<object>()

// Errores de jose que dicen "no pude consultar el JWKS", no "el token es malo".
const TRANSIENT_NAMES = new Set(['JWKSTimeout', 'JWKSInvalid'])
const TRANSIENT_CODES = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_INVALID',
  'ERR_JOSE_GENERIC', // JWKS answered a non-200
])

// Errores de token de jose: JWTExpired, JWTClaimValidationFailed, JWTInvalid, JWSInvalid,
// JWSSignatureVerificationFailed, JWKSNoMatchingKey, JOSEAlgNotAllowed, JOSENotSupported, ...
const JOSE_TOKEN_ERROR = /^(?:ERR_)?(?:JWT|JWS|JWE|JWK|JOSE)/

/**
 * True when the error thrown by `jwtVerify` says "the token is bad". Anything else that comes out
 * of that stage (a TypeError from fetch, "Network connection lost.", ...) is transient.
 */
export function isDefinitiveJoseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (
    TRANSIENT_NAMES.has(err.name) ||
    (typeof code === 'string' && TRANSIENT_CODES.has(code))
  ) {
    return false
  }
  return (
    JOSE_TOKEN_ERROR.test(err.name) ||
    (typeof code === 'string' && JOSE_TOKEN_ERROR.test(code))
  )
}

export function markTransientVerifyFailure<T extends object>(error: T): T {
  transientFailures.add(error)
  return error
}

export function isTransientVerifyFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && transientFailures.has(error)
  )
}

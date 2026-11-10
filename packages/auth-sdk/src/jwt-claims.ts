/**
 * Claims reservados que el SDK NUNCA expone en EvaTokenPayload,
 * aunque estén presentes en el JWT decodificado.
 *
 * Fuentes:
 * - RFC 7519 §4.1: iss, sub, aud, exp, nbf, iat, jti
 * - OIDC Core 1.0 §2: nonce, auth_time, acr, amr, azp
 *
 * Módulo interno — NO se exporta desde ningún barrel raíz.
 * Uso: src/jwt.ts (filtrado + assertSchemaNoReservedKeys).
 */
export const RESERVED_JWT_CLAIMS = [
  'iat',
  'exp',
  'iss',
  'aud',
  'jti',
  'sub',
  'nbf',
  'nonce',
  'auth_time',
  'acr',
  'amr',
  'azp',
] as const

export type ReservedJwtClaim = (typeof RESERVED_JWT_CLAIMS)[number]

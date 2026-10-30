/**
 * Verificador de las llamadas que el Auth Service firma con un JWT de servicio (Auth -> otro
 * servicio, p. ej. Whatsapp-api). Es el sentido inverso de `verifyS2SRequest` (HMAC, servicio -> Auth).
 *
 * El JWT usa ES256 con el mismo JWKS que los access tokens, así que lo que impide confundir un
 * access token de usuario con un token de servicio son cuatro chequeos independientes:
 * `typ: 'svc+jwt'` en el header, `aud` propio del servicio receptor, `scope` y `bsha`.
 *
 * Framework-agnostic: acepta Web API `Request`.
 */

import { jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import { JWT_CONFIG } from '../constants'
import { getJwksKeyFn } from '../jwks'

/** Valor del header `typ` de un JWT de servicio. Un access token de usuario no lo lleva. */
export const SERVICE_JWT_TYP = 'svc+jwt'

/** Vida máxima por defecto (`exp - iat`) de un JWT de servicio, en segundos. */
export const SERVICE_JWT_MAX_LIFETIME_SECONDS = 60

/** Tolerancia por defecto al desfase de relojes, en segundos. */
export const SERVICE_JWT_CLOCK_TOLERANCE_SECONDS = 5

/** Largo máximo aceptado del `jti` (es parte de la clave del replay cache). */
const JTI_MAX_LENGTH = 128

/**
 * Motivos de rechazo de `verifyServiceJwt`.
 *
 * - `token_missing` — no hay `Authorization: Bearer <jwt>`.
 * - `token_malformed` — no es un JWT bien formado.
 * - `token_expired` — `exp` ya pasó (más la tolerancia).
 * - `signature_invalid` — firma inválida, `kid` desconocido o algoritmo distinto de ES256.
 * - `claims_invalid` — `typ`, `iss`, `aud`, `iat`/`exp` ausentes o fuera de rango, o vida mayor al máximo.
 * - `jti_missing` — `jti` ausente, vacío o demasiado largo.
 * - `scope_insufficient` — el claim `scope` no incluye el scope requerido.
 * - `body_hash_mismatch` — `bsha` ausente o distinto del SHA-256 del body recibido.
 * - `replay_detected` — el `jti` ya fue usado (solo con `replayCache`).
 */
export type ServiceJwtVerifyReason =
  | 'token_missing'
  | 'token_malformed'
  | 'token_expired'
  | 'signature_invalid'
  | 'claims_invalid'
  | 'jti_missing'
  | 'scope_insufficient'
  | 'body_hash_mismatch'
  | 'replay_detected'

export type ServiceJwtVerifyError = {
  reason: ServiceJwtVerifyReason
  message: string
}

export type ServiceJwtVerifyResult =
  | { ok: true; data: ServiceJwtClaims }
  | { ok: false; error: ServiceJwtVerifyError }

/** Datos verificados del JWT de servicio. */
export type ServiceJwtClaims = {
  /** Identificador único del token (ya registrado en `replayCache`). */
  jti: string
  /** Scopes del claim `scope` (separado por espacios). */
  scopes: readonly string[]
}

export type ServiceJwtVerifyOptions = {
  /**
   * Audiencia propia del servicio receptor (p. ej. `'whatsapp-api'`). No puede ser la de los
   * access tokens de usuario (`proyecto-global`): lanza `TypeError`.
   */
  audience: string
  /** Scope que debe traer el claim `scope`. */
  requiredScope: string
  /**
   * Registro atómico de `jti` ya vistos. Obligatorio: sin él un token capturado se podría reenviar
   * mientras no expire. Mismo contrato que `S2SVerifyOptions['replayCache']` (p. ej. Redis
   * `SET key value NX EX ttl`); la clave es `svcjwt:${jti}` y el TTL cubre la vida restante del
   * token más la tolerancia de reloj.
   */
  replayCache: {
    setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>
  }
  /**
   * Resolutor de claves. Por defecto el JWKS remoto del Auth Service (`getJwksKeyFn()`, requiere
   * `configureEvaAuth({ authUrl })`). Inyectable para tests.
   */
  jwks?: JWTVerifyGetKey
  /** Vida máxima aceptada (`exp - iat`). Default: `SERVICE_JWT_MAX_LIFETIME_SECONDS` (60). */
  maxLifetimeSeconds?: number
  /** Tolerancia de reloj. Default: `SERVICE_JWT_CLOCK_TOLERANCE_SECONDS` (5). */
  clockToleranceSeconds?: number
  /** Overrides de mensajes (i18n). Las keys no provistas usan el default en inglés. */
  messages?: Partial<Record<ServiceJwtVerifyReason, string>>
}

const MESSAGES: Record<ServiceJwtVerifyReason, string> = {
  token_missing: 'Bearer token is missing',
  token_malformed: 'Token is malformed',
  token_expired: 'Token has expired',
  signature_invalid: 'Authentication failed',
  claims_invalid: 'Authentication failed',
  jti_missing: 'Token id is missing or invalid',
  scope_insufficient: 'Token does not carry the required scope',
  body_hash_mismatch: 'Body does not match the signed hash',
  replay_detected: 'Token already used',
}

const BEARER_REGEX = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

/** SHA-256 de los bytes, en base64url sin padding (formato del claim `bsha`). */
export async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as BufferSource),
  )
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fail(
  reason: ServiceJwtVerifyReason,
  messages: Record<ServiceJwtVerifyReason, string>,
): ServiceJwtVerifyResult {
  return { ok: false, error: { reason, message: messages[reason] } }
}

/** Traduce un error de jose; los que no son del token (fallo de red del JWKS, config) se relanzan. */
function reasonFromJoseError(err: unknown): ServiceJwtVerifyReason | null {
  const code = (err as { code?: unknown } | null)?.code
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'token_expired'
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return 'claims_invalid'
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
      return 'token_malformed'
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JOSE_NOT_SUPPORTED':
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return 'signature_invalid'
    default:
      return null
  }
}

/**
 * Verifica una request firmada por el Auth Service con un JWT de servicio.
 *
 * Contrato del token (lo emite el Auth Service):
 * - Header: `alg: 'ES256'`, `typ: 'svc+jwt'`, `kid`.
 * - Claims: `iss: 'auth-service'`, `aud` (la audiencia del receptor), `iat`, `exp` (con
 *   `exp - iat` <= `maxLifetimeSeconds`), `jti` único, `scope` (separado por espacios) y
 *   `bsha` (SHA-256 del body crudo en base64url sin padding; body vacío = hash de cero bytes).
 *
 * El body se lee una vez (`request.arrayBuffer()`); quien necesite leerlo después debe pasar un
 * clon (el middleware `serviceJwtAuth` lo hace).
 *
 * @throws `TypeError` si `audience` es vacío o es la audiencia de los access tokens de usuario.
 * @throws Error de configuración (`EvaAuthConfigError`) si falta `authUrl` y no se inyecta `jwks`, y
 *   los fallos de red del JWKS: son errores de infraestructura, no un token inválido, así que no
 *   se degradan a un rechazo.
 */
export async function verifyServiceJwt(
  request: Request,
  opts: ServiceJwtVerifyOptions,
): Promise<ServiceJwtVerifyResult> {
  const {
    audience,
    requiredScope,
    replayCache,
    maxLifetimeSeconds = SERVICE_JWT_MAX_LIFETIME_SECONDS,
    clockToleranceSeconds = SERVICE_JWT_CLOCK_TOLERANCE_SECONDS,
  } = opts
  if (audience === '' || audience === JWT_CONFIG.AUDIENCE) {
    throw new TypeError(
      `[eva-auth-sdk] verifyServiceJwt: audience debe ser propio del servicio receptor (no vacío ni '${JWT_CONFIG.AUDIENCE}', la de los access tokens de usuario)`,
    )
  }
  const messages = { ...MESSAGES, ...opts.messages }

  const bearer = request.headers.get('authorization')?.match(BEARER_REGEX)
  if (bearer === null || bearer === undefined) {
    return fail('token_missing', messages)
  }

  let payload
  try {
    ;({ payload } = await jwtVerify(
      bearer[1] as string,
      opts.jwks ?? getJwksKeyFn(),
      {
        algorithms: [JWT_CONFIG.ALGORITHM],
        typ: SERVICE_JWT_TYP,
        issuer: JWT_CONFIG.ISSUER,
        audience,
        clockTolerance: clockToleranceSeconds,
        requiredClaims: ['iat', 'exp'],
      },
    ))
  } catch (err) {
    const reason = reasonFromJoseError(err)
    if (reason === null) throw err
    return fail(reason, messages)
  }

  const { iat, exp, jti, scope, bsha } = payload
  const now = Math.floor(Date.now() / 1000)
  if (
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    exp - iat > maxLifetimeSeconds ||
    iat > now + clockToleranceSeconds
  ) {
    return fail('claims_invalid', messages)
  }
  if (typeof jti !== 'string' || jti === '' || jti.length > JTI_MAX_LENGTH) {
    return fail('jti_missing', messages)
  }
  const scopes =
    typeof scope === 'string' ? scope.split(' ').filter(Boolean) : []
  if (!scopes.includes(requiredScope)) {
    return fail('scope_insufficient', messages)
  }

  const bodyBytes = new Uint8Array(await request.arrayBuffer())
  if (typeof bsha !== 'string' || bsha !== (await sha256Base64Url(bodyBytes))) {
    return fail('body_hash_mismatch', messages)
  }

  // Último: un token con el body equivocado no debe gastar su jti.
  const ttlSeconds = Math.max(1, exp - now + clockToleranceSeconds + 1)
  if (!(await replayCache.setIfAbsent(`svcjwt:${jti}`, ttlSeconds))) {
    return fail('replay_detected', messages)
  }

  return { ok: true, data: { jti, scopes } }
}

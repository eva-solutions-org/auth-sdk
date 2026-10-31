/**
 * Verificador de los tokens de servicio (client credentials) que emite el Auth Service y que un
 * servicio recibe como `Authorization: Bearer` de otro servicio (o del propio Auth, en el OTP).
 *
 * Comparte el JWKS con los access tokens de usuario, así que lo que impide confundir un token de
 * usuario con uno de servicio son chequeos independientes: `typ: 'svc-at+jwt'`, `kid` con prefijo
 * `svc-` (un token sin `kid` o con `kid` `usr-` ni siquiera llega a una clave), `aud` igual a la
 * audiencia propia del servicio receptor y el `scope` pedido.
 *
 * Framework-agnostic: recibe el token ya extraído del header.
 */

import { jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import {
  SERVICE_AUDIENCES,
  SERVICE_KID_PREFIX,
  SERVICE_TOKEN_LIFETIME_SECONDS,
  SERVICE_TOKEN_TYP,
  isScopeOfAudience,
  isServiceAudience,
} from '@eva_solutions/auth-contracts'
import type { ServiceAudience } from '@eva_solutions/auth-contracts'
import { JWT_CONFIG } from '../constants'
import { getJwksKeyFn } from '../jwks'
import { withKidPrefix } from '../key-resolver'

/** Tolerancia por defecto al desfase de relojes, en segundos. */
export const SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS = 5

/**
 * Motivos de rechazo de `verifyServiceToken`.
 *
 * - `token_missing` — no hay `Authorization: Bearer <jwt>` (solo lo produce el middleware).
 * - `token_malformed` — no es un JWT bien formado.
 * - `token_expired` — `exp` ya pasó (más la tolerancia).
 * - `signature_invalid` — firma inválida, `kid` ausente, de otro tipo o desconocido, o algoritmo distinto de ES256.
 * - `claims_invalid` — `typ`, `iss`, `aud`, `sub`, `client_id`, `iat`/`exp` ausentes o fuera de rango, o vida mayor al máximo.
 * - `scope_insufficient` — el claim `scope` no cubre el permiso requerido.
 */
export type ServiceTokenVerifyReason =
  | 'token_missing'
  | 'token_malformed'
  | 'token_expired'
  | 'signature_invalid'
  | 'claims_invalid'
  | 'scope_insufficient'

export type ServiceTokenVerifyError = {
  reason: ServiceTokenVerifyReason
  message: string
}

/** Datos verificados del token de servicio. */
export type ServiceTokenClaims = {
  /** `sub`: id interno estable del service client. Es la identidad; no cambia ni se reutiliza. */
  serviceClientId: string
  /** `client_id`: slug del service client. Dato visible (logs, UI); no usarlo como identidad. */
  serviceClientSlug: string
  /** Permisos del claim `scope` (separado por espacios). */
  scopes: readonly string[]
  /** `jti` del token, si lo trae. */
  jti: string | undefined
}

export type ServiceTokenVerifyResult =
  | { ok: true; data: ServiceTokenClaims }
  | { ok: false; error: ServiceTokenVerifyError }

/**
 * Permiso exigido: uno concreto (`requiredScope`), al menos uno de varios (`anyScope`) o
 * `scopeCheck: 'deferred'`, que no exige ninguno aquí y deja el permiso por ruta a `requireScope`
 * (cadena Bearer + permiso por ruta). Es explícito para que olvidar el permiso no abra la ruta.
 */
export type ServiceTokenScopeRequirement =
  | { requiredScope: string; anyScope?: never; scopeCheck?: never }
  | { anyScope: readonly string[]; requiredScope?: never; scopeCheck?: never }
  | { scopeCheck: 'deferred'; requiredScope?: never; anyScope?: never }

export type ServiceTokenVerifyOptions = ServiceTokenScopeRequirement & {
  /**
   * Audiencia propia del servicio receptor (`'whatsapp-api'`), del catálogo de `auth-contracts`.
   * Un slug de producto o cualquier otro valor lanza `TypeError`.
   */
  audience: ServiceAudience
  /**
   * Resolutor de claves. Por defecto el JWKS remoto del Auth Service (`getJwksKeyFn()`, requiere
   * `configureEvaAuth({ authUrl })`). Inyectable para tests. Siempre se filtra por el prefijo
   * `svc-`, también el inyectado.
   */
  jwks?: JWTVerifyGetKey
  /** Vida máxima aceptada (`exp - iat`). Default: `SERVICE_TOKEN_LIFETIME_SECONDS` (300). */
  maxLifetimeSeconds?: number
  /** Tolerancia de reloj. Default: `SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS` (5). */
  clockToleranceSeconds?: number
  /** Overrides de mensajes (i18n). Las keys no provistas usan el default en inglés. */
  messages?: Partial<Record<ServiceTokenVerifyReason, string>>
}

export const SERVICE_TOKEN_MESSAGES: Record<ServiceTokenVerifyReason, string> =
  {
    token_missing: 'Bearer token is missing',
    token_malformed: 'Token is malformed',
    token_expired: 'Token has expired',
    signature_invalid: 'Authentication failed',
    claims_invalid: 'Authentication failed',
    scope_insufficient: 'Token does not carry the required scope',
  }

function fail(
  reason: ServiceTokenVerifyReason,
  messages: Record<ServiceTokenVerifyReason, string>,
): ServiceTokenVerifyResult {
  return { ok: false, error: { reason, message: messages[reason] } }
}

/** Traduce un error de jose; los que no son del token (fallo de red del JWKS, config) se relanzan. */
export function reasonFromJoseError(
  err: unknown,
): ServiceTokenVerifyReason | null {
  const code = (err as { code?: unknown } | null)?.code
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'token_expired'
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
    case 'ERR_JWT_INVALID':
      return 'claims_invalid'
    case 'ERR_JWS_INVALID':
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
 * Valida las opciones (audiencia del catálogo, permisos de esa audiencia). Lanza `TypeError`.
 * `serviceTokenAuth` la llama al construirse; `verifyServiceToken` en cada llamada.
 */
export function assertServiceTokenOptions(
  opts: ServiceTokenVerifyOptions,
): void {
  const { audience, requiredScope, anyScope } = opts
  if (!isServiceAudience(audience)) {
    throw new TypeError(
      `[eva-auth-sdk] verifyServiceToken: audience debe ser una audiencia de servicio del catálogo (${SERVICE_AUDIENCES.join(', ')})`,
    )
  }
  const given = [
    requiredScope !== undefined,
    anyScope !== undefined,
    opts.scopeCheck !== undefined,
  ].filter(Boolean).length
  if (
    given !== 1 ||
    (opts.scopeCheck !== undefined && opts.scopeCheck !== 'deferred')
  ) {
    throw new TypeError(
      "[eva-auth-sdk] verifyServiceToken: indica exactamente uno de 'requiredScope', 'anyScope' o scopeCheck: 'deferred'",
    )
  }
  if (opts.scopeCheck !== undefined) return
  const wanted = requiredScope !== undefined ? [requiredScope] : anyScope!
  if (wanted.length === 0) {
    throw new TypeError(
      "[eva-auth-sdk] verifyServiceToken: 'anyScope' no puede ser vacío",
    )
  }
  for (const scope of wanted) {
    if (!isScopeOfAudience(audience, scope)) {
      throw new TypeError(
        `[eva-auth-sdk] verifyServiceToken: "${scope}" no es un permiso de la audiencia "${audience}"`,
      )
    }
  }
}

/**
 * Verifica un token de servicio.
 *
 * Contrato del token (lo emite el Auth Service):
 * - Header: `alg: 'ES256'`, `typ: 'svc-at+jwt'`, `kid` con prefijo `svc-`.
 * - Claims: `iss: 'auth-service'`, `aud` (una sola, la del receptor), `sub` (id del service
 *   client), `client_id` (su slug), `scope` (separado por espacios), `iat`, `exp` (con
 *   `exp - iat` <= `maxLifetimeSeconds`) y `jti`.
 *
 * Un token de servicio es reutilizable dentro de su vida: no hay replay cache.
 *
 * @throws `TypeError` si `audience` no es del catálogo, si no se indica exactamente uno de
 *   `requiredScope` / `anyScope`, o si un permiso no pertenece a la audiencia.
 * @throws Error de configuración (`EvaAuthConfigError`) si falta `authUrl` y no se inyecta `jwks`, y
 *   los fallos de red del JWKS: son errores de infraestructura, no un token inválido, así que no
 *   se degradan a un rechazo.
 */
export async function verifyServiceToken(
  token: string,
  opts: ServiceTokenVerifyOptions,
): Promise<ServiceTokenVerifyResult> {
  assertServiceTokenOptions(opts)
  const {
    audience,
    maxLifetimeSeconds = SERVICE_TOKEN_LIFETIME_SECONDS,
    clockToleranceSeconds = SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS,
  } = opts
  const messages = { ...SERVICE_TOKEN_MESSAGES, ...opts.messages }

  let payload
  try {
    ;({ payload } = await jwtVerify(
      token,
      withKidPrefix(opts.jwks ?? getJwksKeyFn(), SERVICE_KID_PREFIX),
      {
        algorithms: [JWT_CONFIG.ALGORITHM],
        typ: SERVICE_TOKEN_TYP,
        issuer: JWT_CONFIG.ISSUER,
        audience,
        clockTolerance: clockToleranceSeconds,
        requiredClaims: ['iat', 'exp', 'sub'],
      },
    ))
  } catch (err) {
    const reason = reasonFromJoseError(err)
    if (reason === null) throw err
    return fail(reason, messages)
  }

  const { iat, exp, sub, client_id: clientId, scope, jti } = payload
  const now = Math.floor(Date.now() / 1000)
  if (
    // Una sola audiencia: un token con varias (`aud` arreglo) no es de este formato.
    payload.aud !== audience ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    exp - iat > maxLifetimeSeconds ||
    iat > now + clockToleranceSeconds ||
    typeof sub !== 'string' ||
    sub === '' ||
    typeof clientId !== 'string' ||
    clientId === ''
  ) {
    return fail('claims_invalid', messages)
  }

  const scopes =
    typeof scope === 'string' ? scope.split(' ').filter(Boolean) : []
  const satisfied =
    opts.scopeCheck !== undefined ||
    (opts.requiredScope !== undefined
      ? scopes.includes(opts.requiredScope)
      : opts.anyScope!.some((wanted) => scopes.includes(wanted)))
  if (!satisfied) return fail('scope_insufficient', messages)

  return {
    ok: true,
    data: {
      serviceClientId: sub,
      serviceClientSlug: clientId,
      scopes,
      jti: typeof jti === 'string' ? jti : undefined,
    },
  }
}

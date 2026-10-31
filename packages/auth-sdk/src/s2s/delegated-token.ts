/**
 * Verificador de los tokens delegados (token exchange, RFC 8693) que un servicio recibe como
 * `Authorization: Bearer` de otro servicio que actúa en nombre de un usuario.
 *
 * El token delegado se firma con una clave de SERVICIO (`kid` `svc-`) pero tiene su propio tipo:
 * `typ: 'dlg-at+jwt'`. Ningún verificador acepta el tipo de otro: este exige `typ` + prefijo de
 * `kid` + una sola `aud` (la del receptor, nunca `auth-api`) + empresa, producto y sesión de
 * origen; `verifyServiceToken` exige `svc-at+jwt` y `verifyAccessToken` exige `at+jwt` + `kid` `usr-`.
 *
 * Framework-agnostic: recibe el token ya extraído del header.
 */

import { jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'
import {
  DELEGATED_TOKEN_LIFETIME_SECONDS,
  DELEGATED_TOKEN_MAX_DEPTH,
  DELEGATED_TOKEN_TYP,
  SERVICE_KID_PREFIX,
  isDelegableAudience,
  isDelegableScope,
} from '@eva_solutions/auth-contracts'
import type {
  DelegableAudience,
  DelegatedActorClaim,
} from '@eva_solutions/auth-contracts'
import { JWT_CONFIG } from '../constants'
import { getJwksKeyFn } from '../jwks'
import { withKidPrefix } from '../key-resolver'
import {
  SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS,
  SERVICE_TOKEN_MESSAGES,
  reasonFromJoseError,
} from './service-token'
import type {
  ServiceTokenScopeRequirement,
  ServiceTokenVerifyReason,
} from './service-token'

/** Motivos de rechazo: los mismos que los del token de servicio. */
export type DelegatedTokenVerifyReason = ServiceTokenVerifyReason

export type DelegatedTokenVerifyError = {
  reason: DelegatedTokenVerifyReason
  message: string
}

/** Un actor de la cadena: el servicio que intercambió el token. */
export type DelegatedActor = {
  /** `act.sub`: id interno estable del service client. */
  serviceClientId: string
  /** `act.client_id`: slug del service client. Dato visible, no identidad. */
  serviceClientSlug: string
}

/** Datos verificados del token delegado. */
export type DelegatedTokenClaims = {
  /** `sub`: el usuario en cuyo nombre se actúa. */
  userId: string
  /** `empresa`: obligatoria e inmutable en toda la cadena. */
  empresaId: string
  /** `producto`: producto de origen de la cadena. */
  producto: string
  /** `sid`: sesión de origen. */
  sessionId: string
  /**
   * Cadena de actores, del último (quien llama a este servicio) al primero (quien partió del
   * access token del usuario). Siempre tiene al menos uno y como máximo `DELEGATED_TOKEN_MAX_DEPTH`.
   */
  actorChain: readonly DelegatedActor[]
  /** `client_id` del token: slug del actor, para logs y rate limit. */
  clientId: string
  /** Permisos del claim `scope` (separado por espacios). */
  scopes: readonly string[]
  /** `jti` del token (obligatorio). */
  jti: string
}

export type DelegatedTokenVerifyResult =
  | { ok: true; data: DelegatedTokenClaims }
  | { ok: false; error: DelegatedTokenVerifyError }

export type DelegatedTokenVerifyOptions = ServiceTokenScopeRequirement & {
  /**
   * Audiencia propia del servicio receptor, del catálogo delegable de `auth-contracts`. `auth-api`
   * (o cualquier otro valor) lanza `TypeError`: Auth nunca es destino de un token delegado.
   */
  audience: DelegableAudience
  /** Resolutor de claves; por defecto el JWKS remoto. Siempre se filtra por el prefijo `svc-`. */
  jwks?: JWTVerifyGetKey
  /** Vida máxima aceptada (`exp - iat`). Default: `DELEGATED_TOKEN_LIFETIME_SECONDS` (120). */
  maxLifetimeSeconds?: number
  /** Tolerancia de reloj. Default: 5 s. */
  clockToleranceSeconds?: number
  /** Overrides de mensajes (i18n). */
  messages?: Partial<Record<DelegatedTokenVerifyReason, string>>
}

function fail(
  reason: DelegatedTokenVerifyReason,
  messages: Record<DelegatedTokenVerifyReason, string>,
): DelegatedTokenVerifyResult {
  return { ok: false, error: { reason, message: messages[reason] } }
}

/**
 * Valida las opciones (audiencia delegable, permisos delegables de esa audiencia). Lanza
 * `TypeError`. `delegatedTokenAuth` la llama al construirse; `verifyDelegatedToken` en cada llamada.
 */
export function assertDelegatedTokenOptions(
  opts: DelegatedTokenVerifyOptions,
): void {
  const { audience, requiredScope, anyScope } = opts
  if (!isDelegableAudience(audience)) {
    throw new TypeError(
      '[eva-auth-sdk] verifyDelegatedToken: audience debe ser una audiencia delegable del catálogo (auth-api nunca lo es)',
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
      "[eva-auth-sdk] verifyDelegatedToken: indica exactamente uno de 'requiredScope', 'anyScope' o scopeCheck: 'deferred'",
    )
  }
  if (opts.scopeCheck !== undefined) return
  const wanted = requiredScope !== undefined ? [requiredScope] : anyScope!
  if (wanted.length === 0) {
    throw new TypeError(
      "[eva-auth-sdk] verifyDelegatedToken: 'anyScope' no puede ser vacío",
    )
  }
  for (const scope of wanted) {
    if (!isDelegableScope(audience, scope)) {
      throw new TypeError(
        `[eva-auth-sdk] verifyDelegatedToken: "${scope}" no es un permiso delegable de la audiencia "${audience}"`,
      )
    }
  }
}

/**
 * Lee la cadena `act`: cada nivel con `sub` y `client_id` no vacíos, al menos uno y como máximo
 * `DELEGATED_TOKEN_MAX_DEPTH`. `null` si algo no cumple.
 */
function readActorChain(act: unknown): DelegatedActor[] | null {
  const chain: DelegatedActor[] = []
  let node = act as DelegatedActorClaim | undefined
  while (node !== undefined) {
    if (chain.length >= DELEGATED_TOKEN_MAX_DEPTH) return null
    if (
      typeof node !== 'object' ||
      node === null ||
      typeof node.sub !== 'string' ||
      node.sub === '' ||
      typeof node.client_id !== 'string' ||
      node.client_id === ''
    ) {
      return null
    }
    chain.push({ serviceClientId: node.sub, serviceClientSlug: node.client_id })
    node = node.act
  }
  return chain.length > 0 ? chain : null
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== ''

/**
 * Verifica un token delegado.
 *
 * Contrato del token (lo emite el Auth Service en `POST /internal/token-exchange`):
 * - Header: `alg: 'ES256'`, `typ: 'dlg-at+jwt'`, `kid` con prefijo `svc-`.
 * - Claims: `iss: 'auth-service'`, `aud` (una sola, la del receptor), `sub` (el usuario),
 *   `client_id`, `act` (cadena de actores), `empresa`, `producto` y `sid` (obligatorios: la
 *   empresa es inmutable en la cadena), `scope`, `iat`, `exp` (con `exp - iat` <=
 *   `maxLifetimeSeconds`) y `jti`.
 *
 * Un token delegado sin empresa se rechaza (`claims_invalid`): la delegación sin empresa no existe.
 * Es reutilizable dentro de su vida (120 s): no hay replay cache.
 *
 * @throws `TypeError` si `audience` no es delegable o los permisos exigidos no lo son.
 * @throws Error de configuración si falta `authUrl` y no se inyecta `jwks`, y los fallos de red del
 *   JWKS (son de infraestructura, no un token inválido).
 */
export async function verifyDelegatedToken(
  token: string,
  opts: DelegatedTokenVerifyOptions,
): Promise<DelegatedTokenVerifyResult> {
  assertDelegatedTokenOptions(opts)
  const {
    audience,
    maxLifetimeSeconds = DELEGATED_TOKEN_LIFETIME_SECONDS,
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
        typ: DELEGATED_TOKEN_TYP,
        issuer: JWT_CONFIG.ISSUER,
        audience,
        clockTolerance: clockToleranceSeconds,
        requiredClaims: ['iat', 'exp', 'sub', 'jti'],
      },
    ))
  } catch (err) {
    const reason = reasonFromJoseError(err)
    if (reason === null) throw err
    return fail(reason, messages)
  }

  const {
    iat,
    exp,
    sub,
    client_id: clientId,
    empresa,
    producto,
    sid,
    scope,
    jti,
  } = payload
  const now = Math.floor(Date.now() / 1000)
  const actorChain = readActorChain(payload.act)
  if (
    // Una sola audiencia: un token con varias (`aud` arreglo) no es de este formato.
    payload.aud !== audience ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    exp - iat > maxLifetimeSeconds ||
    iat > now + clockToleranceSeconds ||
    !isNonEmptyString(sub) ||
    !isNonEmptyString(clientId) ||
    // La empresa es obligatoria: el token delegado sin empresa no existe.
    !isNonEmptyString(empresa) ||
    !isNonEmptyString(producto) ||
    !isNonEmptyString(sid) ||
    !isNonEmptyString(jti) ||
    actorChain === null ||
    // `client_id` es el slug del actor del primer nivel: debe ser el mismo de `act`.
    clientId !== actorChain[0]!.serviceClientSlug
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
      userId: sub,
      empresaId: empresa,
      producto,
      sessionId: sid,
      actorChain,
      clientId,
      scopes,
      jti,
    },
  }
}

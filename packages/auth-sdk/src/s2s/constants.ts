/**
 * Constantes del módulo S2S (service-to-service).
 *
 * REQ-S2S-05 LOCKED: la ventana de tiempo para el timestamp S2S es de 120 segundos.
 */

import { INTERNAL_HEADERS } from '@eva_solutions/auth-contracts'
import type { ServiceScope } from '@eva_solutions/auth-contracts'

/**
 * Ventana máxima (en segundos) para aceptar un request S2S.
 * Si |serverTime - timestamp| > S2S_TIMESTAMP_WINDOW_SECONDS → firma rechazada.
 */
export const S2S_TIMESTAMP_WINDOW_SECONDS = 120

/**
 * Formato canónico del nonce S2S (`x-eva-nonce`): 16 bytes aleatorios como 32 hex en minúsculas.
 * Sin flag `/i`: el verificador rechaza variantes no canónicas en vez de normalizarlas. Es el
 * contrato canónico y defensa en profundidad: una implementación que normalizara el valor
 * podría derivar claves de replay distintas del valor realmente firmado. (Reescribirlo en
 * mayúsculas no evade nada por sí solo: el nonce va en el canonical firmado y rompería el HMAC.)
 * Uso interno: no se exporta desde el barrel.
 */
export const S2S_NONCE_REGEX = /^[0-9a-f]{32}$/

/**
 * Máximo de IDs permitidos por llamada a `batchUsers`.
 * Si se superan, el cliente retorna un error sin hacer fetch al API.
 *
 * Re-export del contrato compartido: el tope NO está en el schema del request (un máximo ahí
 * cambiaría el documento OpenAPI publicado), lo aplica quien lo consume leyendo esta constante.
 */
export { USERS_BATCH_MAX_IDS } from '@eva_solutions/auth-contracts'

/**
 * Permisos de la audiencia `auth-api`, tal como los concede el Auth Service a un service client.
 *
 * Se mantiene como objeto del SDK (`S2S_SCOPES.USERS_READ`) pero sus valores deben ser miembros del
 * catálogo `SERVICE_AUDIENCE_SCOPES['auth-api']` del contrato: `satisfies` lo comprueba en
 * compilación. `admin` no está: la superficie `/admin` de Auth se firma, no usa tokens.
 *
 * @example
 * ```ts
 * import { S2S_SCOPES } from '@eva_solutions/auth-sdk/s2s'
 *
 * const scope = [S2S_SCOPES.USERS_READ, S2S_SCOPES.EMPRESAS_ESCRIBIR].join(' ')
 * ```
 */
export const S2S_SCOPES = {
  USERS_READ: 'users:read',
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',
  EMPRESAS_LEER: 'empresas:leer',
  EMPRESAS_ESCRIBIR: 'empresas:escribir',
} as const satisfies Record<string, ServiceScope<'auth-api'>>

/** Unión de literales de todos los permisos de la audiencia `auth-api`. */
export type S2SScope = (typeof S2S_SCOPES)[keyof typeof S2S_SCOPES]

/**
 * Header de respuesta que el Auth Service incluye en cada respuesta S2S
 * con la hora del servidor (Unix timestamp en segundos como string).
 *
 * @example
 * ```ts
 * import { S2S_RESPONSE_HEADERS } from '@eva_solutions/auth-sdk/s2s'
 *
 * const serverTime = response.headers.get(S2S_RESPONSE_HEADERS.SERVER_TIME)
 * ```
 */
export const S2S_RESPONSE_HEADERS = {
  SERVER_TIME: INTERNAL_HEADERS.X_EVA_SERVER_TIME,
} as const

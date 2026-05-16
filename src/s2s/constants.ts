/**
 * Constantes del módulo S2S (service-to-service).
 *
 * REQ-S2S-05 LOCKED: la ventana de tiempo para el timestamp S2S es de 120 segundos.
 */

/**
 * Ventana máxima (en segundos) para aceptar un request S2S.
 * Si |serverTime - timestamp| > S2S_TIMESTAMP_WINDOW_SECONDS → firma rechazada.
 */
export const S2S_TIMESTAMP_WINDOW_SECONDS = 120

/**
 * Máximo de IDs permitidos por llamada a `batchUsers`.
 * Si se superan, el cliente retorna un error sin hacer fetch al API.
 */
export const USERS_BATCH_MAX_IDS = 100

/**
 * Catálogo de scopes S2S reconocidos por el Auth Service.
 * Fuente: API `src/routes/webhook-router.ts` + `internal-router.ts`.
 *
 * @example
 * ```ts
 * import { S2S_SCOPES } from '@eva_solutions/auth-sdk/s2s'
 *
 * const client = await createServiceClient({
 *   scopes: [S2S_SCOPES.USERS_READ, S2S_SCOPES.WEBHOOKS_WRITE],
 * })
 * ```
 */
export const S2S_SCOPES = {
  USERS_READ: 'users:read',
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',
} as const

/** Unión de literales de todos los scopes S2S reconocidos. */
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
  SERVER_TIME: 'x-eva-server-time',
} as const

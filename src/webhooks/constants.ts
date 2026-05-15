/**
 * Constantes del módulo webhooks.
 *
 * REQ-WH-01, REQ-WH-02 LOCKED: la ventana de tiempo para validar la firma
 * del webhook es de 300 segundos (5 minutos), igual que el API.
 * Confirmado en API `src/core/constants/webhook-constants.ts`.
 */

/**
 * Ventana máxima (en segundos) para aceptar un webhook entrante.
 * Si |now - timestamp| > WEBHOOK_TIMESTAMP_WINDOW_SECONDS → firma rechazada.
 */
export const WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300

/**
 * Headers HTTP que el Auth Service incluye en cada webhook entregado.
 * Usarlos para extraer firma e identificador en el handler receptor.
 *
 * @example
 * ```ts
 * import { WEBHOOK_HEADERS } from '@eva/auth-sdk/webhooks'
 *
 * const sig = req.headers[WEBHOOK_HEADERS.SIGNATURE]
 * const id  = req.headers[WEBHOOK_HEADERS.ID]
 * ```
 */
export const WEBHOOK_HEADERS = {
  SIGNATURE: 'x-eva-webhook-signature',
  ID: 'x-eva-webhook-id',
  TIMESTAMP: 'x-eva-webhook-timestamp',
} as const

/**
 * Catálogo de event codes que el Auth Service puede emitir en webhooks.
 * Espejo del API `src/features/webhooks/domain/event-codes.ts`.
 *
 * REQ-WH-07 LOCKED: 11 event codes.
 */
export const EVENT_CODES = {
  USER_CREATED: 'user.created',
  USER_VERIFIED: 'user.verified',
  USER_LOGIN_SUCCESS: 'user.login_success',
  USER_LOGIN_FAILED: 'user.login_failed',
  SESSION_CREATED: 'session.created',
  SESSION_DELETED: 'session.deleted',
  SESSION_DELETED_ALL: 'session.deleted_all',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_DELETED: 'user.deleted',
  USER_RESTORED: 'user.restored',
  USER_HARD_DELETED: 'user.hard_deleted',
} as const

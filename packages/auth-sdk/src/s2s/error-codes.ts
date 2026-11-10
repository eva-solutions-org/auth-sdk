/**
 * Códigos de error específicos del módulo S2S.
 *
 * Complementan a `ERROR_CODES` (core) para los errores propios de los endpoints
 * `/api/v1/internal/*` que consume `createS2SClient`: usuarios y subscriptions de webhooks.
 *
 * @example
 * ```ts
 * import { S2S_ERROR_CODES } from '@eva_solutions/auth-sdk/s2s'
 *
 * const r = await s2s.rotateWebhookSubscriptionSecret(id)
 * if (!r.ok && r.error.kind === 'api' && r.error.code === S2S_ERROR_CODES.webhook_secret_rotation_conflict) {
 *   // otra rotación concurrente ganó; esta llamada no recibió clave. Reintenta.
 * }
 * ```
 */
export const S2S_ERROR_CODES = {
  /** `GET /internal/users/{id}`: el usuario no existe o está soft-deleted (404). */
  user_not_found: 'user_not_found',
  /** Ya existe una subscription del mismo service client con la misma URL y los mismos eventCodes (409). */
  webhook_subscription_duplicate: 'webhook_subscription_duplicate',
  /** La subscription no existe o pertenece a otro service client (404). */
  webhook_subscription_not_found: 'webhook_subscription_not_found',
  /**
   * `rotate-secret` perdió contra otra rotación concurrente de la misma subscription (409).
   * El perdedor no recibe clave; es reintentable.
   */
  webhook_secret_rotation_conflict: 'webhook_secret_rotation_conflict',
  /** URL de webhook inválida: reglas estáticas, IP privada o host sin direcciones (400). */
  webhook_url_invalid: 'webhook_url_invalid',
  /** `eventCodes` vacío al crear o actualizar (400). */
  webhook_event_codes_empty: 'webhook_event_codes_empty',
} as const

/** Unión de literales de los error codes específicos del módulo S2S. */
export type S2SErrorCode =
  (typeof S2S_ERROR_CODES)[keyof typeof S2S_ERROR_CODES]

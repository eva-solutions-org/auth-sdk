/**
 * Tipos del módulo webhooks.
 *
 * REQ-WH-08, REQ-ADMIN-06 LOCKED.
 */

import type { EVENT_CODES } from './constants'

/**
 * Tipo del event code — unión de los 11 valores del catálogo.
 */
export type EventCode = (typeof EVENT_CODES)[keyof typeof EVENT_CODES]

/**
 * Payload genérico de un evento webhook tal como lo emite el Auth Service.
 *
 * @template TData - Shape del campo `data` específico del evento.
 */
export type WebhookPayload<TData = Record<string, unknown>> = {
  /** UUID del evento (único por entrega). */
  id: string
  /** Código del evento (uno de los 11 EVENT_CODES). */
  eventCode: EventCode
  /** Unix timestamp en segundos del momento en que se generó el evento. */
  timestamp: number
  /** Datos específicos del evento. */
  data: TData
}

/**
 * Subscription de webhook (sin el signingKey — solo metadata).
 * Shape del wire del API en GET /internal/webhooks/subscriptions/*.
 */
export type WebhookSubscription = {
  id: string
  clientId: string
  url: string
  eventCodes: EventCode[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Respuesta de creación/rotación que incluye el signingKey en texto plano.
 * El signingKey solo se devuelve una vez — guardarlo de inmediato.
 */
export type WebhookSubscriptionWithSecret = {
  subscription: WebhookSubscription
  signingKey: string
}

/**
 * Delivery de un webhook (intento de entrega a la URL del consumer).
 */
export type WebhookDelivery = {
  id: string
  subscriptionId: string
  eventId: string
  status: 'pending' | 'delivering' | 'success' | 'expired'
  attempts: number
  lastAttemptAt: string | null
  nextRetryAt: string | null
  responseStatus: number | null
  createdAt: string
}

/**
 * Resultado de rotar el secret de una subscription.
 * El signingKey nuevo solo se devuelve una vez.
 */
export type RotateWebhookSecretResult = {
  id: string
  signingKey: string
  updatedAt: string
}

/**
 * Tipos del módulo S2S (service-to-service).
 *
 * REQ-S2S-06 LOCKED.
 */

import type { EvaUser } from '../types'
import type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from '../webhooks/types'

// Re-exportar tipos de webhooks para que sean accesibles desde el barrel s2s
export type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
}

/**
 * Configuración del cliente S2S.
 */
export type S2SClientConfig = {
  /** Slug del service client (clientId). */
  clientId: string
  /**
   * Secret del service client en formato hex (64 chars = 32 bytes).
   * Es el valor que devuelve el Admin al crear/rotar el service client.
   */
  secretHex: string
  /** URL base del Auth Service API (sin trailing slash). */
  baseUrl: string
}

/**
 * Partes del request necesarias para construir el canonical string SigV4-style.
 * Espejo del tipo `CanonicalRequestParts` del API.
 */
export type S2SCanonicalParts = {
  /** HTTP method en uppercase (GET, POST, PATCH, DELETE). */
  method: string
  /** Pathname del request sin query string ni fragment. */
  path: string
  /** Query string crudo (sin el `?`). String vacío si no hay query. */
  rawQuery: string
  /** Unix timestamp en segundos como string decimal. */
  timestamp: string
  /** Slug del service client (clientId). */
  clientId: string
  /** Bytes raw del body. GET/sin body → `new Uint8Array(0)`. */
  bodyBytes: Uint8Array
}

/**
 * Resultado de `getUser` — perfil público del usuario.
 */
export type S2SGetUserResult = {
  user: EvaUser
}

/**
 * Input para `batchUsers` — lista de IDs a consultar.
 */
export type S2SBatchUsersInput = {
  ids: string[]
}

/**
 * Resultado de `batchUsers` — usuarios activos encontrados.
 * IDs inválidos, inexistentes o soft-deleted se omiten.
 */
export type S2SBatchUsersResult = {
  users: EvaUser[]
}

/**
 * Input para crear una subscription de webhook.
 */
export type CreateWebhookSubscriptionInput = {
  /** URL pública donde el Auth Service enviará los eventos. */
  url: string
  /** Lista de event codes a suscribir. */
  eventCodes: string[]
  /** Si la subscription está activa al crearla. Default: true en el API. */
  enabled?: boolean
}

/**
 * Input para actualizar una subscription de webhook (patch parcial).
 */
export type UpdateWebhookSubscriptionInput = {
  url?: string
  eventCodes?: string[]
  enabled?: boolean
}

/**
 * Query params para listar deliveries.
 */
export type ListWebhookDeliveriesQuery = {
  event_id?: string
  subscription_id?: string
  status?: 'pending' | 'delivering' | 'success' | 'expired'
  limit?: number
  offset?: number
}

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

// ===== v1.1.0: Server-side verification types =====

/**
 * All possible reasons why an S2S request verification can fail.
 *
 * - `header_missing` — one or more required headers are absent.
 * - `timestamp_invalid` — the `x-eva-timestamp` header is not a valid integer string.
 * - `timestamp_expired` — the timestamp is outside the allowed window (default ±120 s).
 * - `signature_malformed` — the `x-eva-signature` header is not in `sha256=<hex64>` format.
 * - `client_unknown` — `secretStore` returned null for the given clientId.
 * - `signature_invalid` — the HMAC signature does not match the expected value.
 *
 * `client_unknown` and `signature_invalid` share the same human-readable message
 * ("Authentication failed") to avoid revealing whether the clientId exists.
 */
export type S2SVerifyReason =
  | 'header_missing'
  | 'timestamp_invalid'
  | 'timestamp_expired'
  | 'signature_malformed'
  | 'client_unknown'
  | 'signature_invalid'

/**
 * Discriminated union of all S2S verification failure modes.
 * Q-E01 LOCKED — this is a module-specific type, NOT the global Result<T, E>.
 */
export type S2SVerifyError = {
  reason: S2SVerifyReason
  message: string
}

/**
 * Result of S2S verification.
 *
 * Use the `ok` discriminant to narrow:
 * ```ts
 * const result = await verifyS2SRequest(req, opts)
 * if (!result.ok) return new Response(result.error.message, { status: 401 })
 * const { clientId } = result.data
 * ```
 */
export type S2SVerifyResult<T> = { ok: true; data: T } | { ok: false; error: S2SVerifyError }

/**
 * Input options for `verifyS2SRequest`.
 */
export type S2SVerifyOptions = {
  /**
   * Callback that must return the plaintext secret (64 hex chars = 32 bytes) for the given
   * clientId, or null if the client is unknown. The SDK applies a timing-safe dummy HMAC
   * when null — callers MUST NOT throw; return null for unknown clients instead.
   */
  secretStore: (clientId: string) => Promise<string | null>
  /**
   * Override timestamp validation window in seconds.
   * Default: `S2S_TIMESTAMP_WINDOW_SECONDS` (120).
   */
  timestampWindowSeconds?: number
}

/**
 * Tipos del módulo S2S (service-to-service).
 *
 * REQ-S2S-06 LOCKED.
 */

import type {
  ProfileResponse,
  UsersBatchRequest,
  UsersBatchResponse,
} from '@eva_solutions/auth-contracts'
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
  /**
   * URL base del Auth Service API (sin trailing slash).
   * Validada en `createS2SClient`: se requiere https (o http con host loopback para tests).
   */
  baseUrl: string
}

/**
 * Partes del request necesarias para construir el canonical string SigV4-style
 * (7 líneas: método, path, query, timestamp, nonce, clientId, hash del body).
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
  /** Nonce del request: 32 hex en minúsculas (ver `generateS2SNonce`). */
  nonce: string
  /** Slug del service client (clientId). */
  clientId: string
  /** Bytes raw del body. GET/sin body → `new Uint8Array(0)`. */
  bodyBytes: Uint8Array
}

/**
 * Resultado de `getUser` — perfil público del usuario.
 * El perfil es el del contrato compartido; `{ user }` es solo el envoltorio que arma el cliente
 * al desenvolver `data`.
 */
export type S2SGetUserResult = {
  user: ProfileResponse['data']
}

/**
 * Input para `batchUsers` — lista de IDs a consultar (alias del request del contrato).
 * El tope de `USERS_BATCH_MAX_IDS` lo aplica el cliente, no el tipo.
 */
export type S2SBatchUsersInput = UsersBatchRequest

/**
 * Resultado de `batchUsers` — usuarios activos encontrados (alias del `data` de la respuesta del
 * contrato). IDs inválidos, inexistentes o soft-deleted se omiten.
 */
export type S2SBatchUsersResult = UsersBatchResponse['data']

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
 * - `header_missing` — one or more required headers are absent (client id, timestamp, nonce, signature).
 * - `timestamp_invalid` — the `x-eva-timestamp` header is not a valid integer string.
 * - `timestamp_expired` — the timestamp is outside the allowed window (default ±120 s).
 * - `nonce_malformed` — the `x-eva-nonce` header is not 32 lowercase hex chars.
 * - `signature_malformed` — the `x-eva-signature` header is not in `sha256=<hex64>` format.
 * - `client_unknown` — `secretStore` returned null for the given clientId.
 * - `signature_invalid` — the HMAC signature does not match the expected value.
 * - `replay_detected` — the `(clientId, nonce)` pair has already been seen (only when `replayCache` is configured).
 *
 * `client_unknown` and `signature_invalid` share the same human-readable message
 * ("Authentication failed") to avoid revealing whether the clientId exists.
 */
export type S2SVerifyReason =
  | 'header_missing'
  | 'timestamp_invalid'
  | 'timestamp_expired'
  | 'nonce_malformed'
  | 'signature_malformed'
  | 'client_unknown'
  | 'signature_invalid'
  | 'replay_detected'

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
export type S2SVerifyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: S2SVerifyError }

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
  /**
   * Optional nonce store for replay protection. When provided, `verifyS2SRequest`
   * calls `setIfAbsent` after a successful HMAC verify to detect replayed requests.
   *
   * The SDK builds the key internally as `${clientId}:${nonce}` (`nonce` is the validated
   * `x-eva-nonce` header, 32 lowercase hex). The TTL passed to `setIfAbsent` is
   * `2 * timestampWindowSeconds + 1` (default 241 s): the current time is floored to seconds
   * and the window is inclusive on both sides (±W), so a request stays acceptable for 2W + 1
   * seconds and the key must outlive that.
   *
   * @remarks
   * The implementation MUST be atomic (e.g. Redis `SET key value NX EX ttl`).
   * Non-atomic implementations are vulnerable to TOCTOU race conditions.
   *
   * The store SHOULD be shared across all instances of the same service that share
   * the clientId/secret pair. Independent per-instance stores allow cross-instance
   * replay attacks.
   *
   * @security Critical for replay protection — must be atomic.
   * @security Check occurs AFTER HMAC verify (D16) to preserve timing-safe invariant.
   */
  replayCache?: {
    /**
     * Atomically insert `key` (`${clientId}:${nonce}`) if not present, expiring after `ttlSeconds`
     * (`2 * timestampWindowSeconds + 1`).
     * @returns `true` if inserted (request is fresh); `false` if the key already existed (replay detected).
     *
     * Implementation MUST be atomic (e.g. Redis `SET ... NX EX ttl`).
     * Non-atomic implementations are vulnerable to TOCTOU race conditions.
     *
     * @security Critical for replay protection — must be atomic.
     */
    setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>
  }
  /**
   * Optional message overrides for i18n. Keys not provided fall back to the
   * default English messages. An empty string `''` is respected as an explicit
   * override (D12 LOCKED).
   *
   * @example
   * ```ts
   * messages: {
   *   timestamp_expired: 'El timestamp está fuera del rango permitido',
   *   replay_detected: 'Firma ya utilizada',
   * }
   * ```
   */
  messages?: Partial<Record<S2SVerifyReason, string>>
}

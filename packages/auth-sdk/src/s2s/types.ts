/**
 * Tipos del módulo S2S (service-to-service).
 *
 * REQ-S2S-06 LOCKED.
 */

import type {
  AddEmpresaMemberRequest,
  AddGrupoEmpresaRequest,
  AutorizacionResponse,
  ContratacionResponse,
  ContratadoResponse,
  CreateAutorizacionRequest,
  CreateEmpresaRequest,
  CreateGrupoRequest,
  CreateSubscriptionRequest,
  CreateSucursalRequest,
  DeactivateSucursalRequest,
  DeleteAutorizacionRequest,
  DirectorioQuery,
  DirectorioResponse,
  EmpresaDetailResponse,
  EmpresaEstadoResponse,
  EmpresaMemberResponse,
  EmpresaRecortadaResponse,
  EmpresaResponse,
  GetEmpresaResponse,
  GrupoResponse,
  ListAutorizacionesQuery,
  ListAutorizacionesResponse,
  ListEmpresasQuery,
  ListEmpresasResponse,
  ProfileResponse,
  RemoveEmpresaMemberRequest,
  RemoveGrupoEmpresaRequest,
  RenameGrupoRequest,
  SetContratacionRequest,
  SucursalResponse,
  UpdateEmpresaMemberRequest,
  UpdateEmpresaRequest,
  UpdateSubscriptionRequest,
  UpdateSucursalRequest,
  UsersBatchRequest,
  UsersBatchResponse,
  VerificarAutorizacionQuery,
  VerificarAutorizacionResponse,
} from '@eva_solutions/auth-contracts'
import type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from '../webhooks/types'
import type { ServiceTokenSource } from './token-provider'

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
  /**
   * URL base del Auth Service API (sin trailing slash).
   * Validada en `createS2SClient`: se requiere https (o http con host loopback para tests).
   */
  baseUrl: string
  /**
   * Proveedor del token de servicio con audiencia `auth-api` (`createServiceTokenProvider`). El
   * cliente lo usa en cada llamada y, ante un 401, lo invalida y reintenta una vez.
   */
  tokenProvider: ServiceTokenSource
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
 * Resultado de `getUser` — perfil público del usuario (alias del `data` de la respuesta del
 * contrato). El wire es `{ data: perfil }` y `result.data` es el perfil directamente, sin
 * envoltorio. Un usuario inexistente o soft-deleted llega como error `user_not_found` (404).
 */
export type S2SGetUserResult = ProfileResponse['data']

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
 * Input para crear una subscription de webhook (alias del request del contrato): `url` donde el
 * Auth Service enviará los eventos, `eventCodes` a suscribir (al menos uno) y `enabled` (por
 * defecto `true` en el API).
 */
export type CreateWebhookSubscriptionInput = CreateSubscriptionRequest

/**
 * Input para actualizar una subscription de webhook (patch parcial; alias del request del
 * contrato).
 */
export type UpdateWebhookSubscriptionInput = UpdateSubscriptionRequest

/**
 * Query params para listar deliveries.
 *
 * Tipo propio del SDK, no alias del contrato: el query del contrato coacciona strings a números y
 * por eso su tipo de entrada es `unknown`; aquí `limit` y `offset` son `number`.
 */
export type ListWebhookDeliveriesQuery = {
  event_id?: string
  subscription_id?: string
  status?: 'pending' | 'delivering' | 'success' | 'expired'
  limit?: number
  offset?: number
}

/**
 * Toda acción de una persona sobre una empresa lleva su access token como `subjectToken`: el
 * backend del producto manda su token de servicio y, en el body, el token de la persona.
 */
export type SubjectTokenInput = RemoveEmpresaMemberRequest

/**
 * Input para crear una empresa (alias del request del contrato). La persona del `subjectToken`
 * queda como titular y el producto del actor queda en `prueba`.
 */
export type CreateEmpresaInput = CreateEmpresaRequest

/** Input para editar datos maestros, perfil y visibilidad (RUC y slug son inmutables). */
export type UpdateEmpresaInput = UpdateEmpresaRequest

/** Query de `listEmpresas`: `q` y `cursor` (la siguiente página sale de `nextCursor`). */
export type ListEmpresasInput = ListEmpresasQuery

/** Página de empresas contratadas por el producto del actor. */
export type ListEmpresasResult = ListEmpresasResponse['data']

/** Input para agregar un miembro (entra como `miembro`). */
export type AddEmpresaMemberInput = AddEmpresaMemberRequest

/** Input para cambiar el rol de un miembro (solo el titular). */
export type UpdateEmpresaMemberInput = UpdateEmpresaMemberRequest

/** Input para quitar un miembro; `userId` = la persona del token es salir por cuenta propia. */
export type RemoveEmpresaMemberInput = RemoveEmpresaMemberRequest

/** Input para crear una sucursal (alias del request del contrato). */
export type CreateSucursalInput = CreateSucursalRequest

/** Input para editar una sucursal. */
export type UpdateSucursalInput = UpdateSucursalRequest

/** Input para dar de baja lógica una sucursal (`activa = false`). */
export type DeactivateSucursalInput = DeactivateSucursalRequest

/** Empresa creada o editada (`data` de la respuesta). */
export type EmpresaResult = EmpresaResponse['data']

/** Vista completa de una empresa: el actor tiene su producto contratado (`vista: 'completa'`). */
export type EmpresaDetailResult = EmpresaDetailResponse['data']

/** Vista recortada para un actor sin producto: sin contacto ni miembros (`vista: 'recortada'`). */
export type EmpresaRecortadaResult = EmpresaRecortadaResponse['data']

/** Resultado de `getEmpresa`: una de las dos vistas, distinguidas por `vista`. */
export type GetEmpresaResult = GetEmpresaResponse['data']

/** Miembro agregado o con rol cambiado (`data` de la respuesta). */
export type EmpresaMemberResult = EmpresaMemberResponse['data']

/** Sucursal creada o editada (`data` de la respuesta). */
export type SucursalResult = SucursalResponse['data']

/** Estado de la empresa tras `bajaEmpresa` / `reactivarEmpresa`. */
export type EmpresaEstadoResult = EmpresaEstadoResponse['data']

/** Contratación de un producto por una empresa. */
export type ContratacionResult = ContratacionResponse['data']

/** Input de `setContratacion` (facturación y admin): estado y vencimiento. */
export type SetContratacionInput = SetContratacionRequest

/** `{ contratado }`: ¿la empresa tiene el producto en `prueba` o `activo` y sin vencer? */
export type ContratadoResult = ContratadoResponse['data']

/** Input para crear un grupo con una empresa de la persona. */
export type CreateGrupoInput = CreateGrupoRequest

/** Input para renombrar un grupo. */
export type RenameGrupoInput = RenameGrupoRequest

/** Input para agregar una empresa a un grupo. */
export type AddGrupoEmpresaInput = AddGrupoEmpresaRequest

/** Input para quitar una empresa de un grupo. */
export type RemoveGrupoEmpresaInput = RemoveGrupoEmpresaRequest

/** Grupo con los ids de sus empresas. */
export type GrupoResult = GrupoResponse['data']

/** Query del directorio: `q`, `rubro`, `ciudad` y `cursor`. */
export type SearchDirectorioInput = DirectorioQuery

/** Página del directorio: solo campos de perfil público. */
export type DirectorioResult = DirectorioResponse['data']

/** Input para conceder una autorización a otra empresa (solo permisos del catálogo entre empresas). */
export type CreateAutorizacionInput = CreateAutorizacionRequest

/** Input para revocar (otorgante) o renunciar (beneficiaria) a una autorización. */
export type DeleteAutorizacionInput = DeleteAutorizacionRequest

/** Input de `listAutorizaciones`: dirección y persona (viaja en el header `x-eva-subject-token`). */
export type ListAutorizacionesInput = ListAutorizacionesQuery & {
  subjectToken: string
}

/** Autorización vigente. */
export type AutorizacionResult = AutorizacionResponse['data']

/** Autorizaciones vigentes de una empresa. */
export type ListAutorizacionesResult = ListAutorizacionesResponse['data']

/** Input de `checkAutorizacion`: otorgante, beneficiaria y permiso. */
export type CheckAutorizacionInput = VerificarAutorizacionQuery

/** `{ autorizado }`. */
export type CheckAutorizacionResult = VerificarAutorizacionResponse['data']

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

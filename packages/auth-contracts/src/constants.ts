/**
 * PURE module: it must never reference `zod` or any schema module of this package. The SDK
 * `react` entry imports these values, and a schema module reached from there would drag its
 * load-time metadata registration into the react bundle (enforced by a test in this package and
 * by the SDK closure gate).
 *
 * Wire values only: error codes and header NAMES. Nothing here is configuration.
 */

/** Core error codes of the wire error body; each key equals its value. The catalog is open. */
export const ERROR_CODES = {
  account_state_locked: 'account_state_locked',
  unauthorized: 'unauthorized',
  validation_error: 'validation_error',
  not_found: 'not_found',
  conflict: 'conflict',
  forbidden: 'forbidden',
  rate_limited: 'rate_limited',
  gone: 'gone',
  unprocessable_entity: 'unprocessable_entity',
  bad_request: 'bad_request',
  internal_error: 'internal_error',
  service_unavailable: 'service_unavailable',
} as const

export type CoreErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Names of the session headers exchanged with browser clients. */
export const HEADERS = {
  AUTHORIZATION: 'authorization',
  REFRESH_TOKEN: 'x-eva-refresh-token',
  NEW_ACCESS_TOKEN: 'x-eva-new-access-token',
  NEW_REFRESH_TOKEN: 'x-eva-new-refresh-token',
} as const

/** Names of the headers of the service-to-service signed requests and responses. */
export const INTERNAL_HEADERS = {
  X_EVA_CLIENT_ID: 'x-eva-client-id',
  X_EVA_TIMESTAMP: 'x-eva-timestamp',
  X_EVA_NONCE: 'x-eva-nonce',
  X_EVA_SIGNATURE: 'x-eva-signature',
  X_EVA_SERVER_TIME: 'x-eva-server-time',
} as const

/**
 * Account states, as an OBJECT with each key equal to its value: it is the public shape of the SDK
 * (`ACCOUNT_STATES.suspendido`), unlike the two tuples below.
 */
export const ACCOUNT_STATES = {
  no_verificado: 'no_verificado',
  verificado: 'verificado',
  pendiente_de_verificacion: 'pendiente_de_verificacion',
  suspendido: 'suspendido',
  baneado: 'baneado',
  eliminado: 'eliminado',
} as const

/** Presence states of a user. A tuple so that schemas can build an enum straight from it. */
export const ACTIVITY_STATES = [
  'activo',
  'ausente',
  'ocupado',
  'desconectado',
] as const

/** Privacy states of a user profile. A tuple, like {@link ACTIVITY_STATES}. */
export const PRIVACY_STATES = ['publico', 'amigos', 'invisible'] as const

/**
 * Most ids accepted by one users batch call. The batch request schema does NOT carry this limit
 * (a schema maximum would change the published OpenAPI document): whoever applies the limit reads
 * this constant. It lives here, in a PURE module, so the SDK client can import it by value.
 */
export const USERS_BATCH_MAX_IDS = 100

/**
 * Event codes of the webhooks the service emits. Each key is the upper-case form of its value
 * (`user.created` -> `USER_CREATED`); the catalog is closed and the API owns what triggers each one.
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
  EMPRESA_CREATED: 'empresa.created',
  EMPRESA_MEMBER_ADDED: 'empresa.member_added',
  EMPRESA_MEMBER_REMOVED: 'empresa.member_removed',
  EMPRESA_BRANCH_CREATED: 'empresa.branch_created',
} as const

export type EventCode = (typeof EVENT_CODES)[keyof typeof EVENT_CODES]

/**
 * Names of the headers a webhook receiver reads (lower case, as receivers see them): the signature,
 * the event id and the timestamp. Names only, never values.
 */
export const WEBHOOK_HEADERS = {
  SIGNATURE: 'x-eva-webhook-signature',
  ID: 'x-eva-webhook-id',
  TIMESTAMP: 'x-eva-webhook-timestamp',
} as const

/** Seconds around "now" within which a receiver accepts the timestamp of a webhook. */
export const WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300

/**
 * Delivery states of a webhook. A tuple, like the other enums: the API database enum is checked
 * against it at compile time.
 */
export const DELIVERY_STATUSES = [
  'pending',
  'delivering',
  'success',
  'expired',
] as const

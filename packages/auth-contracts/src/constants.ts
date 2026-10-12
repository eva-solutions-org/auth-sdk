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

export { createEvaAuth } from './client'
export { createHttpClient, type EvaHttpClient } from './http-client'
export { verifyAccessToken } from './jwt'
export type { VerifyAccessTokenOptions } from './jwt'
export { getPublicKey, fetchJwks, clearJwksCache } from './jwks'
export { configureEvaAuth, type ConfigureEvaAuthOptions, getAuthUrl, getEvaEnv, getCookieDomain } from './config'
export type {
  EvaUser,
  EvaSession,
  EvaEmpresa,
  EvaTokenPayload,
  Result,
  DeviceInfo,
  TokenPair,
  ActivityState,
  PrivacyState,
  // Error types (D-02 v3 LOCKED — discriminated union)
  EvaApiError,
  EvaSdkError,
  EvaError,
} from './types'
export { HEADERS, COOKIES, COOKIE_MAX_AGE, JWT_CONFIG } from './constants'
// Estados de cuenta (G1 — Batch 14)
export { ACCOUNT_STATES } from './account-states'
export type { AccountState } from './account-states'
export { readTokensFromCookies } from './cookies'
export type { EvaErrorMessages } from './error-messages'
export { DEFAULT_ERROR_MESSAGES } from './error-messages'
// Error codes + reasons (D-07/D-08 LOCKED)
export {
  ERROR_CODES,
  SDK_ERROR_REASONS,
} from './error-codes'
export type {
  CoreErrorCode,
  ErrorCode,
  SdkErrorReason,
} from './error-codes'
// getMessage helper (migración gradual 0.x → 1.0.0)
export { getMessage } from './get-message'
// Error helpers semánticos (Batch 15 — ad-hoc post-archive v2)
export {
  isApiError,
  isSdkError,
  matchError,
  matchSdkReason,
  isNotFound,
  isUnauthorized,
  isForbidden,
  isConflict,
  isValidationError,
  isRateLimited,
  isGone,
  isUnprocessableEntity,
  isBadRequest,
  isInternalError,
  isServiceUnavailable,
  isAccountStateLocked,
  isNetworkError,
  isTokenInvalid,
  isAuthRequired,
  isRefreshNoTokens,
  isVerifyFailed,
  isMalformed,
} from './error-helpers'
// Módulo webhooks (REQ-EXPORTS-02 — accesible desde raíz)
export { verifyWebhookSignature, WEBHOOK_TIMESTAMP_WINDOW_SECONDS, EVENT_CODES, WEBHOOK_HEADERS } from './webhooks'
export type {
  EventCode,
  WebhookPayload,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
  VerifyWebhookSignatureParams,
} from './webhooks'
// Módulo admin (REQ-EXPORTS-02 — accesible desde raíz)
export { createAdminClient, ADMIN_ERROR_CODES } from './admin'
export type {
  AdminClient,
  AdminClientConfig,
  ServiceClientPublic,
  CreateServiceClientInput,
  CreateServiceClientResult,
  UpdateServiceClientInput,
  UpdateServiceClientResult,
  RotateSecretResult,
  RestoreUserResult,
  AdminErrorCode,
} from './admin'
// Módulo S2S (REQ-EXPORTS-02 — accesible desde raíz)
// Nota: WebhookSubscription/WebhookSubscriptionWithSecret/WebhookDelivery/RotateWebhookSecretResult
// se exportan desde ./webhooks arriba (s2s los re-exporta internamente desde ../webhooks/types).
// REQ-API-07 LOCKED: s2sAuth/requireScope NO se exportan desde raíz — son Hono-specific.
export {
  createS2SClient,
  signS2SRequest,
  buildS2SCanonicalString,
  EMPTY_BODY_SHA256_HEX,
  S2S_TIMESTAMP_WINDOW_SECONDS,
  USERS_BATCH_MAX_IDS,
  S2S_SCOPES,
  S2S_RESPONSE_HEADERS,
  verifyS2SRequest,
} from './s2s'
export type {
  S2SClient,
  S2SClientConfig,
  S2SCanonicalParts,
  S2SGetUserResult,
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  S2SScope,
  // v1.1.0: server-side verify types
  S2SVerifyReason,
  S2SVerifyError,
  S2SVerifyResult,
  S2SVerifyOptions,
} from './s2s'

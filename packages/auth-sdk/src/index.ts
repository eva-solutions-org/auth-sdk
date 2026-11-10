export { createEvaAuth } from './client'
export { createHttpClient, type EvaHttpClient } from './http-client'
export { verifyAccessToken } from './jwt'
export type { VerifyAccessTokenOptions } from './jwt'
export {
  configureEvaAuth,
  getConfiguredClientIpForwarder,
  readRequestHeader,
  type ConfigureEvaAuthServerOptions as ConfigureEvaAuthOptions,
  type ClientIpContext,
  type ServiceCredentials,
} from './client-ip-config'
export { getAuthUrl, getCookieDomain } from './config'
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
export {
  HEADERS,
  getCookieNames,
  COOKIE_MAX_AGE,
  JWT_CONFIG,
} from './constants'
// Estados de cuenta (G1 — Batch 14)
export { ACCOUNT_STATES } from './account-states'
export type { AccountState } from './account-states'
export { readTokensFromCookies } from './cookies'
export type { EvaErrorMessages } from './error-messages'
export { DEFAULT_ERROR_MESSAGES } from './error-messages'
// Error codes + reasons (D-07/D-08 LOCKED)
export { ERROR_CODES, SDK_ERROR_REASONS } from './error-codes'
export type { CoreErrorCode, ErrorCode, SdkErrorReason } from './error-codes'
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
export {
  verifyWebhookSignature,
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
  EVENT_CODES,
  WEBHOOK_HEADERS,
} from './webhooks'
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
  AdminContratacionResult,
  AdminEmpresaEstadoResult,
  AdminSetContratacionInput,
  ListServiceClientDelegationsResult,
  ProductoPermisosAutorizablesResult,
  ReassignEmpresaTitularInput,
  ReassignEmpresaTitularResult,
  ServiceClientDelegation,
  SetProductoPermisosAutorizablesInput,
  SetServiceClientDelegationInput,
  ServiceClientPublic,
  CreateServiceClientInput,
  CreateServiceClientResult,
  CreateProductoInput,
  UpdateProductoInput,
  ListProductosResult,
  ProductoResult,
  ServiceClientGrant,
  SetServiceClientGrantInput,
  ListServiceClientGrantsResult,
  UpdateServiceClientInput,
  UpdateServiceClientResult,
  RotateSecretResult,
  RestoreUserResult,
  MaintenanceCleanupQuery,
  MaintenanceCleanupResult,
  RepublishPendingWebhooksQuery,
  RepublishPendingWebhooksResult,
  AdminErrorCode,
} from './admin'
export type {
  ClientIpForwardingOptions,
  ClientIpForwardingErrorInfo,
  ClientIpForwardingErrorCode,
} from './client-ip-forwarding'
// Módulo S2S (REQ-EXPORTS-02 — accesible desde raíz)
// Nota: WebhookSubscription/WebhookSubscriptionWithSecret/WebhookDelivery/RotateWebhookSecretResult
// se exportan desde ./webhooks arriba (s2s los re-exporta internamente desde ../webhooks/types).
// REQ-API-07 LOCKED: s2sAuth/requireScope NO se exportan desde raíz — son Hono-specific.
export {
  createS2SClient,
  signS2SRequest,
  signS2SHeaders,
  generateS2SNonce,
  buildS2SCanonicalString,
  EMPTY_BODY_SHA256_HEX,
  S2S_TIMESTAMP_WINDOW_SECONDS,
  USERS_BATCH_MAX_IDS,
  S2S_SCOPES,
  S2S_RESPONSE_HEADERS,
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
  createClientIpForwarder,
  S2S_ERROR_CODES,
  verifyS2SRequest,
  createServiceTokenProvider,
  ServiceTokenRequestError,
  verifyServiceToken,
  verifyDelegatedToken,
  AUTORIZACION_CACHE_TTL_MS,
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
  AddEmpresaMemberInput,
  AddGrupoEmpresaInput,
  AutorizacionResult,
  CheckAutorizacionInput,
  CheckAutorizacionResult,
  ContratacionResult,
  ContratadoResult,
  CreateAutorizacionInput,
  CreateEmpresaInput,
  CreateGrupoInput,
  CreateSucursalInput,
  DeactivateSucursalInput,
  DeleteAutorizacionInput,
  DirectorioResult,
  EmpresaDetailResult,
  EmpresaEstadoResult,
  EmpresaMemberResult,
  EmpresaRecortadaResult,
  EmpresaResult,
  GetEmpresaResult,
  GrupoResult,
  ListAutorizacionesInput,
  ListAutorizacionesResult,
  ListEmpresasInput,
  ListEmpresasResult,
  RemoveEmpresaMemberInput,
  RemoveGrupoEmpresaInput,
  RenameGrupoInput,
  SearchDirectorioInput,
  SetContratacionInput,
  SubjectTokenInput,
  SucursalResult,
  UpdateEmpresaInput,
  UpdateEmpresaMemberInput,
  UpdateSucursalInput,
  DelegatedTokenGrant,
  ExchangeTokenInput,
  ServiceTokenProvider,
  ServiceTokenProviderConfig,
  ServiceTokenSource,
  DelegatedActor,
  DelegatedTokenClaims,
  DelegatedTokenVerifyError,
  DelegatedTokenVerifyOptions,
  DelegatedTokenVerifyReason,
  DelegatedTokenVerifyResult,
  ServiceTokenVerifyOptions,
  ServiceTokenVerifyResult,
  ServiceTokenVerifyError,
  ServiceTokenVerifyReason,
  ServiceTokenClaims,
  S2SScope,
  S2SErrorCode,
  // v1.1.0: server-side verify types
  S2SVerifyReason,
  S2SVerifyError,
  S2SVerifyResult,
  S2SVerifyOptions,
} from './s2s'

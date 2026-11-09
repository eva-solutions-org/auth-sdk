/**
 * Entry point del módulo S2S de @eva_solutions/auth-sdk.
 *
 * Importar desde '@eva_solutions/auth-sdk/s2s':
 *   import { createS2SClient } from '@eva_solutions/auth-sdk/s2s'
 *
 * REQ-EXPORTS-02 LOCKED.
 */

export { createS2SClient } from './client'
export type { S2SClient } from './client'

export {
  buildS2SCanonicalString,
  signS2SRequest,
  signS2SHeaders,
  generateS2SNonce,
  EMPTY_BODY_SHA256_HEX,
} from './sign'

export {
  AUTORIZACION_CACHE_TTL_MS,
  S2S_TIMESTAMP_WINDOW_SECONDS,
  USERS_BATCH_MAX_IDS,
  S2S_SCOPES,
  S2S_RESPONSE_HEADERS,
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
} from './constants'
export { createClientIpForwarder } from '../client-ip-forwarding'
export type {
  ClientIpForwardingOptions,
  ClientIpForwardingErrorInfo,
  ClientIpForwardingErrorCode,
} from '../client-ip-forwarding'
export type { S2SScope } from './constants'

export { S2S_ERROR_CODES } from './error-codes'
export type { S2SErrorCode } from './error-codes'

export type {
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
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from './types'

// S2S server-side verify (v1.1.0)
export { verifyS2SRequest } from './verify'
export type {
  S2SVerifyReason,
  S2SVerifyError,
  S2SVerifyResult,
  S2SVerifyOptions,
} from './types'

// Service token (client credentials): obtain and verify
export {
  createServiceTokenProvider,
  ServiceTokenRequestError,
  SERVICE_TOKEN_RENEW_MARGIN_MS,
} from './token-provider'
export type {
  DelegatedTokenGrant,
  ExchangeTokenInput,
  ServiceTokenProvider,
  ServiceTokenProviderConfig,
  ServiceTokenSource,
} from './token-provider'
export {
  verifyServiceToken,
  SERVICE_TOKEN_CLOCK_TOLERANCE_SECONDS,
} from './service-token'
export type {
  ServiceTokenVerifyOptions,
  ServiceTokenVerifyResult,
  ServiceTokenVerifyError,
  ServiceTokenVerifyReason,
  ServiceTokenClaims,
  ServiceTokenScopeRequirement,
} from './service-token'

// Token delegado (token exchange): verificar
export { verifyDelegatedToken } from './delegated-token'
export type {
  DelegatedActor,
  DelegatedTokenClaims,
  DelegatedTokenVerifyError,
  DelegatedTokenVerifyOptions,
  DelegatedTokenVerifyReason,
  DelegatedTokenVerifyResult,
} from './delegated-token'

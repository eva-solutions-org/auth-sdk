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

export { buildS2SCanonicalString, signS2SRequest, EMPTY_BODY_SHA256_HEX } from './sign'

export { S2S_TIMESTAMP_WINDOW_SECONDS, USERS_BATCH_MAX_IDS, S2S_SCOPES, S2S_RESPONSE_HEADERS } from './constants'
export type { S2SScope } from './constants'

export type {
  S2SClientConfig,
  S2SCanonicalParts,
  S2SGetUserResult,
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from './types'

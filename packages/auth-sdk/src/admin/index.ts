/**
 * Entry point del módulo Admin de @eva_solutions/auth-sdk.
 *
 * Importar desde '@eva_solutions/auth-sdk/admin':
 *   import { createAdminClient } from '@eva_solutions/auth-sdk/admin'
 *
 * REQ-EXPORTS-02 LOCKED.
 */

export { createAdminClient } from './client'
export type { AdminClient } from './client'

export type {
  AdminClientConfig,
  ServiceClientPublic,
  CreateServiceClientInput,
  CreateServiceClientResult,
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
} from './types'

export { ADMIN_ERROR_CODES } from './error-codes'
export type { AdminErrorCode } from './error-codes'

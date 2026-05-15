/**
 * Entry point del módulo Admin de @eva/auth-sdk.
 *
 * Importar desde '@eva/auth-sdk/admin':
 *   import { createAdminClient } from '@eva/auth-sdk/admin'
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
  UpdateServiceClientInput,
  UpdateServiceClientResult,
  RotateSecretResult,
  RestoreUserResult,
} from './types'

export { ADMIN_ERROR_CODES } from './error-codes'
export type { AdminErrorCode } from './error-codes'

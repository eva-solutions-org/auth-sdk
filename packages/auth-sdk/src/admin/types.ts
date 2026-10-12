/**
 * Tipos del módulo Admin para provisioning de service clients y gestión de usuarios.
 *
 * REQ-ADMIN-06 LOCKED.
 */

import type {
  CreateServiceClientResponse,
  RotateServiceClientSecretResponse,
  ServiceClientPublic as ContractServiceClientPublic,
  UpdateServiceClientResponse,
} from '@eva_solutions/auth-contracts'
import type { AccountState } from '../account-states'

/**
 * Configuración del cliente Admin.
 * La contraseña de admin se pasa en el header `X-Admin-Password`.
 */
export type AdminClientConfig = {
  /** Contraseña de administrador global del Auth Service. */
  adminPassword: string
  /**
   * URL base del Auth Service API (sin trailing slash).
   * Validada en `createAdminClient`: se requiere https (o http con host loopback para tests).
   */
  baseUrl: string
}

/**
 * Service client público (sin el plaintext del secret).
 * Shape del wire en GET /admin/service-clients/*.
 * Las fechas vienen serializadas como ISO strings en el wire.
 */
export type ServiceClientPublic = ContractServiceClientPublic

/**
 * Input para crear un nuevo service client.
 *
 * Tipo propio del SDK, no alias del contrato: `scopes` acepta cualquier string y es el API quien lo
 * valida contra el catálogo (`SERVICE_CLIENT_SCOPES`).
 */
export type CreateServiceClientInput = {
  /** Slug único del service client (lowercase, sin espacios). */
  slug: string
  /** Nombre descriptivo del service client. Opcional. */
  name?: string
  /** Lista de scopes a asignar. Default: [] en el API. */
  scopes?: string[]
}

/**
 * Resultado de crear un service client.
 * El `secret` solo se devuelve UNA VEZ — guardarlo de inmediato.
 */
export type CreateServiceClientResult = CreateServiceClientResponse['data']

/**
 * Input para actualizar un service client (patch parcial).
 * Al menos un campo debe estar presente. Tipo propio del SDK por la misma razón que
 * {@link CreateServiceClientInput}.
 */
export type UpdateServiceClientInput = {
  enabled?: boolean
  scopes?: string[]
  name?: string
}

/**
 * Resultado de actualizar un service client.
 * Incluye `warning` cuando se modifican los scopes.
 */
export type UpdateServiceClientResult = UpdateServiceClientResponse['data']

/**
 * Resultado de rotar el secret de un service client.
 * El `secret` nuevo solo se devuelve UNA VEZ.
 */
export type RotateSecretResult = RotateServiceClientSecretResponse['data']

/**
 * Resultado de restaurar una cuenta de usuario eliminada.
 * REQ-RESTORE-01 LOCKED.
 *
 * Tipo propio del SDK: `stateAccount` es la unión completa `AccountState`, y en el wire es el único
 * literal `no_verificado`.
 */
export type RestoreUserResult = {
  userId: string
  /** Estado de la cuenta tras la restauración. */
  stateAccount: AccountState
  previouslyDeletedAt: string | null
  restoredAt: string
}

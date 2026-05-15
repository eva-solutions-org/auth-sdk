/**
 * Tipos del módulo Admin para provisioning de service clients y gestión de usuarios.
 *
 * REQ-ADMIN-06 LOCKED.
 */

import type { AccountState } from '../account-states'

/**
 * Configuración del cliente Admin.
 * La contraseña de admin se pasa en el header `X-Admin-Password`.
 */
export type AdminClientConfig = {
  /** Contraseña de administrador global del Auth Service. */
  adminPassword: string
  /** URL base del Auth Service API (sin trailing slash). */
  baseUrl: string
}

/**
 * Service client público (sin secretHash).
 * Shape del wire en GET /admin/service-clients/*.
 * Las fechas vienen serializadas como ISO strings en el wire.
 */
export type ServiceClientPublic = {
  id: string
  slug: string
  name: string
  enabled: boolean
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Input para crear un nuevo service client.
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
export type CreateServiceClientResult = {
  id: string
  slug: string
  name: string
  scopes: string[]
  enabled: true
  secret: string
  warning: string
}

/**
 * Input para actualizar un service client (patch parcial).
 * Al menos un campo debe estar presente.
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
export type UpdateServiceClientResult = {
  cliente: ServiceClientPublic
  warning?: string
}

/**
 * Resultado de rotar el secret de un service client.
 * El `secret` nuevo solo se devuelve UNA VEZ.
 */
export type RotateSecretResult = {
  slug: string
  secret: string
  warning: string
}

/**
 * Resultado de restaurar una cuenta de usuario eliminada.
 * REQ-RESTORE-01 LOCKED.
 */
export type RestoreUserResult = {
  userId: string
  /** Estado de la cuenta tras la restauración. */
  stateAccount: AccountState
  previouslyDeletedAt: string | null
  restoredAt: string
}

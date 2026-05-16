/**
 * Códigos de error específicos del módulo Admin.
 *
 * Complementan a `ERROR_CODES` (core) para errores que solo ocurren
 * en operaciones de provisioning de service clients.
 *
 * @example
 * ```ts
 * import { ADMIN_ERROR_CODES } from '@eva_solutions/auth-sdk/admin'
 *
 * if (!result.ok && result.error.code === ADMIN_ERROR_CODES.service_client_already_exists) {
 *   return res.status(409).json({ error: 'El service client ya existe' })
 * }
 * ```
 */
export const ADMIN_ERROR_CODES = {
  service_client_already_exists: 'service_client_already_exists',
  service_client_not_found: 'service_client_not_found',
} as const

/** Unión de literales de los error codes específicos del módulo Admin. */
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES]

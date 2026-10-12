/**
 * Catálogo de estados de cuenta de usuario.
 *
 * Espejo del API `src/core/constants/account-states.ts`.
 * Usar para comparar el campo `stateAccount` sin magic strings.
 *
 * @example
 * ```ts
 * import { ACCOUNT_STATES } from '@eva_solutions/auth-sdk'
 *
 * if (user.stateAccount === ACCOUNT_STATES.suspendido) {
 *   return res.status(403).json({ error: 'Cuenta suspendida' })
 * }
 * ```
 */
export const ACCOUNT_STATES = {
  no_verificado: 'no_verificado',
  verificado: 'verificado',
  pendiente_de_verificacion: 'pendiente_de_verificacion',
  suspendido: 'suspendido',
  baneado: 'baneado',
  eliminado: 'eliminado',
} as const

/** Unión de literales de todos los estados de cuenta posibles. */
export type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

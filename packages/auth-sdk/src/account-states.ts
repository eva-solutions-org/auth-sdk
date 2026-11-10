import { ACCOUNT_STATES } from '@eva_solutions/auth-contracts'

/**
 * Catálogo de estados de cuenta de usuario.
 *
 * Re-export del contrato compartido (`ACCOUNT_STATES`, módulo PURO de constantes): mismo objeto,
 * misma forma (`key === value`), sin copia local. Regla R-8: este módulo puede alcanzarse desde
 * `src/react`, así que importa del contrato solo VALORES de módulos puros (nunca un módulo de
 * schemas) o `import type`.
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
export { ACCOUNT_STATES }

/** Unión de literales de todos los estados de cuenta posibles. */
export type AccountState = (typeof ACCOUNT_STATES)[keyof typeof ACCOUNT_STATES]

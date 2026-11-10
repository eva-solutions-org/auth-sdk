/**
 * Helper de conveniencia para extraer el mensaje de un EvaError.
 * Útil para migración gradual de 0.x → 1.0.0 donde result.error era string.
 *
 * Uso:
 *   import { getMessage } from '@eva_solutions/auth-sdk'
 *   if (!result.ok) {
 *     console.error(getMessage(result.error))  // equivale a result.error.message
 *   }
 */
import type { EvaError } from './types'

/**
 * Retorna el mensaje del EvaError independientemente de su kind.
 * Equivalente a `err.message` — helper para migración gradual desde 0.x.
 */
export function getMessage(err: EvaError): string {
  return err.message
}

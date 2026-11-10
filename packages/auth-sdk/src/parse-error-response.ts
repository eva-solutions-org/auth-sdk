/**
 * Parsea el body de una respuesta HTTP de error a EvaError.
 * Sync — el caller debe haber hecho `await res.json().catch(() => null)` antes de llamar.
 *
 * Módulo PURO (D-35): solo `import type`, sin zod ni schemas del contrato. Lo importa código
 * alcanzable desde `src/react/index.ts`; si importara un módulo SCHEMA, el closure de react
 * arrastraría sus `.meta()` (no puros) y rompería el tope de tamaño.
 *
 * Algoritmo (D-14 LOCKED):
 * - status === 0 → EvaSdkError reason:'network'
 * - body null/undefined → EvaSdkError reason:'malformed'
 * - body.error.{code,message} presentes → EvaApiError
 * - cualquier otro caso → EvaSdkError reason:'malformed'
 */
import type { EvaError, EvaApiError, EvaSdkError } from './types'

export function parseErrorResponse(status: number, body: unknown): EvaError {
  if (status === 0) {
    return {
      kind: 'sdk',
      reason: 'network',
      message: 'Network error',
      status: 0,
    } satisfies EvaSdkError
  }

  if (body === null || body === undefined) {
    return {
      kind: 'sdk',
      reason: 'malformed',
      message: 'Malformed response',
      status,
    } satisfies EvaSdkError
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as Record<string, unknown>).error === 'object' &&
    (body as Record<string, unknown>).error !== null &&
    typeof ((body as Record<string, unknown>).error as Record<string, unknown>)
      .code === 'string' &&
    typeof ((body as Record<string, unknown>).error as Record<string, unknown>)
      .message === 'string'
  ) {
    const err = (body as Record<string, unknown>).error as {
      code: string
      message: string
    }
    return {
      kind: 'api',
      code: err.code,
      message: err.message,
      status,
    } satisfies EvaApiError
  }

  return {
    kind: 'sdk',
    reason: 'malformed',
    message: 'Malformed error response',
    status,
  } satisfies EvaSdkError
}

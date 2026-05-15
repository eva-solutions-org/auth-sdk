/**
 * Schemas Zod 4 compartidos — fuente canónica (B1 confirmado por T-00 probe).
 * Usados por auth-handlers.ts (validación runtime) y hono-openapi/index.ts (OpenAPI doc).
 * Importar desde aquí evita duplicación y garantiza consistencia entre variantes.
 *
 * También contiene parseErrorResponse (sync) — D-14 LOCKED: cohesión con ErrorResponseSchema.
 */
import { z } from 'zod'
import type { EvaError, EvaApiError, EvaSdkError } from './types'

// === Request schemas ===

export const GetCodeSchema = z.object({
  phone: z.string().min(1),
})

export const LoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
})

/**
 * Schema para PATCH /me — record no vacío.
 * Validación extra con .refine() para rechazar body vacío.
 */
export const UpdateUserSchema = z.record(z.string(), z.unknown()).refine(
  obj => Object.keys(obj).length > 0,
  'Cuerpo de actualización vacío',
)

// === Response schemas ===

/**
 * Schema del wire de error del Auth Service.
 * D-13 v2 LOCKED: el API emite { error: { code: string, message: string } }.
 * Usado por hono-openapi/index.ts para generar la documentación OpenAPI.
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

/**
 * Parsea el body de una respuesta HTTP de error a EvaError.
 * Sync — el caller debe haber hecho `await res.json().catch(() => null)` antes de llamar.
 *
 * Algoritmo (D-14 LOCKED):
 * - status === 0 → EvaSdkError reason:'network'
 * - body null/undefined → EvaSdkError reason:'malformed'
 * - body.error.{code,message} presentes → EvaApiError
 * - cualquier otro caso → EvaSdkError reason:'malformed'
 */
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
    typeof ((body as Record<string, unknown>).error as Record<string, unknown>).code === 'string' &&
    typeof ((body as Record<string, unknown>).error as Record<string, unknown>).message === 'string'
  ) {
    const err = (body as Record<string, unknown>).error as { code: string; message: string }
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

export const UserIdSchema = z.object({
  id: z.string(),
})

export const LoginResponseSchema = z.object({
  data: z.object({
    user: UserIdSchema,
  }),
})

export const RefreshResponseSchema = z.object({
  data: z.object({
    user: UserIdSchema,
  }),
})

// === Inferred types ===

export type GetCodeInput = z.infer<typeof GetCodeSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>

/**
 * Schemas Zod 4 compartidos — fuente canónica (B1 confirmado por T-00 probe).
 * Usados por auth-handlers.ts (validación runtime) y hono-openapi/index.ts (OpenAPI doc).
 * Importar desde aquí evita duplicación y garantiza consistencia entre variantes.
 *
 * `parseErrorResponse` vive en `parse-error-response.ts` (módulo puro, D-35): este archivo no es
 * alcanzable desde `src/react/index.ts`.
 */
import { z } from 'zod'
import {
  errorResponseSchema,
  getCodeResponseSchema,
  loginResponseSchema,
} from '@eva_solutions/auth-contracts'

// === Request schemas ===

export const GetCodeSchema = z.object({
  phone: z.string().min(1),
})

/**
 * Cuerpo de POST /login. `challengeId` es el identificador opaco que devolvió
 * POST /get-code para este código: el navegador lo conserva en memoria y lo
 * reenvía junto con el código. Sin él, /login responde 400 (`malformed`).
 */
export const LoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
  challengeId: z.string().min(1),
})

/**
 * Schema para PATCH /me — record no vacío.
 * Validación extra con .refine() para rechazar body vacío.
 */
export const UpdateUserSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length > 0, 'Cuerpo de actualización vacío')

// === Response schemas ===

/*
 * Los schemas de respuesta son alias del contrato compartido (D-28: el tipo es idéntico al que
 * este archivo definía antes). Se usan solo para documentar OpenAPI: `http-client` no los parsea en
 * runtime. Este módulo registra metadatos de zod al cargarse, así que NO debe ser alcanzable desde
 * `src/react` (regla D-35: ahí solo se importan valores de módulos puros o `import type`).
 */

/** Wire de error `{ error: { code, message } }` (componente `ErrorBody`). */
export const ErrorResponseSchema = errorResponseSchema

/** Wire de POST /login/get-code (200). `challengeId` es opaco; cada get-code nuevo invalida el anterior. */
export const GetCodeResponseSchema = getCodeResponseSchema

/** Wire de POST /login (200). */
export const LoginResponseSchema = loginResponseSchema

/** Wire de POST /login/refresh (200): el contrato reutiliza la respuesta de login. */
export const RefreshResponseSchema = loginResponseSchema

// === Inferred types ===

export type GetCodeInput = z.infer<typeof GetCodeSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>

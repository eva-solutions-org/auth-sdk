import { z } from 'zod'
import { SERVICE_TOKEN_ERROR_CODES } from './tokens'

/**
 * SCHEMA module: the service token endpoint. Unlike the rest of the API its bodies are NOT wrapped
 * in `{ data }` nor `{ error: { code, message } }`: they follow RFC 6749 (5.1 success, 5.2 errors),
 * so any OAuth-aware client can read them.
 *
 * `audience` is a plain string on purpose: an unknown audience is answered with `invalid_target`
 * (RFC 8707), not with a validation error. The API checks it against the audience catalog.
 */

export const serviceTokenRequestSchema = z
  .object({
    audience: z.string().min(1).max(64).meta({
      description: 'Servicio destino del token (audiencia del catálogo)',
      example: 'whatsapp-api',
    }),
    scope: z.string().min(1).max(512).optional().meta({
      description:
        'Permisos pedidos separados por espacio; si falta se conceden todos los concedidos para la audiencia',
    }),
  })
  .strict()

export const serviceTokenResponseSchema = z
  .object({
    access_token: z.string().meta({ description: 'JWT de servicio firmado' }),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().positive().meta({
      description: 'Segundos de vida desde la respuesta',
    }),
    scope: z
      .string()
      .meta({ description: 'Permisos concedidos separados por espacio' }),
  })
  .meta({ id: 'ServiceTokenResponse' })

export const serviceTokenErrorSchema = z
  .object({
    error: z.enum(SERVICE_TOKEN_ERROR_CODES),
    error_description: z.string().optional(),
  })
  .meta({ id: 'ServiceTokenError' })

export type ServiceTokenRequest = z.input<typeof serviceTokenRequestSchema>
export type ServiceTokenResponse = z.output<typeof serviceTokenResponseSchema>
export type ServiceTokenError = z.output<typeof serviceTokenErrorSchema>

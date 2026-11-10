import { z } from 'zod'
import {
  ACCESS_TOKEN_TYPE,
  TOKEN_EXCHANGE_ERROR_CODES,
  TOKEN_EXCHANGE_GRANT_TYPE,
} from './tokens'

/**
 * SCHEMA module: the token exchange endpoint (RFC 8693), authenticated with the service token of
 * the actor (`Bearer`, `aud: auth-api`, permission `tokens:exchange`). Like the service token
 * endpoint, its bodies are NOT wrapped in `{ data }` nor `{ error: { code, message } }`: they
 * follow the RFCs so any OAuth-aware client can read them.
 *
 * `audience` is a plain string on purpose: an unknown audience, `auth-api` or one the actor has no
 * delegation edge to is answered with `invalid_target`, not with a validation error.
 */

/** Longest `subject_token` accepted (a JWT with its claims is far below this). */
const SUBJECT_TOKEN_MAX_LENGTH = 4096

export const tokenExchangeRequestSchema = z
  .object({
    grant_type: z.literal(TOKEN_EXCHANGE_GRANT_TYPE),
    subject_token: z.string().min(1).max(SUBJECT_TOKEN_MAX_LENGTH).meta({
      description:
        'Access token del usuario (aud = producto del actor) o token delegado (aud = audiencia del actor)',
    }),
    subject_token_type: z.literal(ACCESS_TOKEN_TYPE),
    audience: z.string().min(1).max(64).meta({
      description: 'Servicio destino del token delegado (una sola audiencia)',
      example: 'whatsapp-api',
    }),
    scope: z.string().min(1).max(512).optional().meta({
      description:
        'Permisos pedidos separados por espacio; si falta se emite todo lo delegable para esa arista',
    }),
  })
  .strict()

export const tokenExchangeResponseSchema = z
  .object({
    access_token: z.string().meta({ description: 'JWT delegado firmado' }),
    issued_token_type: z.literal(ACCESS_TOKEN_TYPE),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().positive().meta({
      description: 'Segundos de vida desde la respuesta',
    }),
    scope: z
      .string()
      .meta({ description: 'Permisos emitidos separados por espacio' }),
  })
  .meta({ id: 'TokenExchangeResponse' })

export const tokenExchangeErrorSchema = z
  .object({
    error: z.enum(TOKEN_EXCHANGE_ERROR_CODES),
    error_description: z.string().optional(),
  })
  .meta({ id: 'TokenExchangeError' })

export type TokenExchangeRequest = z.input<typeof tokenExchangeRequestSchema>
export type TokenExchangeResponse = z.output<typeof tokenExchangeResponseSchema>
export type TokenExchangeError = z.output<typeof tokenExchangeErrorSchema>

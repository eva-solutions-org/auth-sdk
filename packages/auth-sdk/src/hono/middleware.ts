import { createMiddleware } from 'hono/factory'
import type { ZodType } from 'zod'
import { verifyAccessToken } from '../jwt'
import {
  readTokensFromCookies,
  setTokenCookies,
  clearTokenCookies,
} from '../cookies'
import type { Context } from 'hono'
import {
  createClientIpForwarder,
  type ClientIpForwardingOptions,
} from '../client-ip-forwarding'
import { createHttpClient } from '../http-client'
import { deduplicateRefresh } from '../refresh-dedup'
import { isDefinitiveRejection } from '../refresh-dedup'
import { isTransientVerifyFailure } from '../verify-failure'
import type { EvaTokenPayload } from '../types'
import { resolveErrorMessages, type EvaErrorMessages } from '../error-messages'
import {
  getErrorMessages,
  getErrorWire,
  validateErrorMessagesInput,
} from '../config'

const client = createHttpClient()

export type EvaAuthOptions<TExtra extends Record<string, unknown>> = {
  extraClaimsSchema?: ZodType<TExtra>
  errorMessages?: Partial<EvaErrorMessages>
  /**
   * Solo backends: reenvía la IP real del usuario en el auto-refresh (ver `evaAuthRoutes`). Sin
   * IP, o ante cualquier fallo, el refresh sigue sin esos headers.
   */
  clientIpForwarding?: ClientIpForwardingOptions<Context>
}

export type EvaAuthVariables<TExtra extends Record<string, unknown>> = {
  evaPayload: EvaTokenPayload<TExtra>
}

function unavailable(c: Context, retryAfterSeconds?: number): Response {
  const message = 'Servicio de autenticación no disponible'
  if (retryAfterSeconds !== undefined) {
    c.header('Retry-After', String(retryAfterSeconds))
  }
  if (getErrorWire() === 'api') {
    return c.json({ error: { code: 'service_unavailable', message } }, 503)
  }
  return c.json({ error: message }, 503)
}

export function evaAuth<TExtra extends Record<string, unknown> = {}>(
  opts: EvaAuthOptions<TExtra> = {},
) {
  if (opts.errorMessages !== undefined) {
    validateErrorMessagesInput(opts.errorMessages)
  }
  const forwardingHeaders = createClientIpForwarder(opts.clientIpForwarding)
  return createMiddleware<{ Variables: EvaAuthVariables<TExtra> }>(
    async (c, next) => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken, refreshToken } = readTokensFromCookies(cookieHeader)

      if (accessToken) {
        const result = await verifyAccessToken<TExtra>(accessToken, {
          extraClaimsSchema: opts.extraClaimsSchema,
        })
        if (result.ok) {
          c.set('evaPayload', result.data)
          await next()
          return
        }
        // No se pudo VERIFICAR (JWKS inaccesible): refrescar gastaría una rotación sin motivo y
        // podría hacer que Auth cierre la sesión. Sin refresh y sin tocar cookies.
        if (isTransientVerifyFailure(result.error)) return unavailable(c)
      }

      if (refreshToken) {
        const headers = await forwardingHeaders(c)
        const refreshResult = await deduplicateRefresh(refreshToken, () =>
          client.refresh({ refreshToken }, headers),
        )
        if (refreshResult.ok && refreshResult.data.tokens) {
          const verifyResult = await verifyAccessToken<TExtra>(
            refreshResult.data.tokens.accessToken,
            {
              extraClaimsSchema: opts.extraClaimsSchema,
            },
          )
          if (verifyResult.ok) {
            c.set('evaPayload', verifyResult.data)
            const cookieHeaders = setTokenCookies(refreshResult.data.tokens)
            for (const cookie of cookieHeaders) {
              c.header('Set-Cookie', cookie, { append: true })
            }
            await next()
            return
          }
          // Auth ya rotó los tokens: si no se pudo VERIFICAR el nuevo (JWKS inaccesible) no se
          // pierden ni se borran; se guardan y el cliente reintenta con ellos.
          if (isTransientVerifyFailure(verifyResult.error)) {
            for (const cookie of setTokenCookies(refreshResult.data.tokens)) {
              c.header('Set-Cookie', cookie, { append: true })
            }
            return unavailable(c)
          }
        }
        // Un fallo transitorio (red, 408, 429, 5xx) no prueba que la sesión murió: no se borran
        // las cookies y se responde 503 para que el cliente reintente.
        if (!refreshResult.ok && !isDefinitiveRejection(refreshResult.error)) {
          return unavailable(c, refreshResult.error.retryAfterSeconds)
        }
        const clearHeaders = clearTokenCookies()
        for (const cookie of clearHeaders) {
          c.header('Set-Cookie', cookie, { append: true })
        }
      }

      const messages = resolveErrorMessages(
        opts.errorMessages,
        getErrorMessages(),
      )
      const wire = getErrorWire()
      if (wire === 'api') {
        return c.json(
          { error: { code: 'unauthorized', message: messages.authRequired } },
          401,
        )
      }
      return c.json({ error: messages.authRequired }, 401)
    },
  )
}

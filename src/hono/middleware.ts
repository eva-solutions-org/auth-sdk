import { createMiddleware } from 'hono/factory'
import type { ZodType } from 'zod'
import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'
import { deduplicateRefresh } from '../refresh-dedup'
import type { EvaTokenPayload } from '../types'
import { resolveErrorMessages, type EvaErrorMessages } from '../error-messages'
import { getErrorMessages, getErrorWire, validateErrorMessagesInput } from '../config'

const client = createHttpClient()

export type EvaAuthOptions<TExtra extends Record<string, unknown>> = {
  extraClaimsSchema?: ZodType<TExtra>
  errorMessages?: Partial<EvaErrorMessages>
}

export type EvaAuthVariables<TExtra extends Record<string, unknown>> = {
  evaPayload: EvaTokenPayload<TExtra>
}

export function evaAuth<TExtra extends Record<string, unknown> = {}>(
  opts: EvaAuthOptions<TExtra> = {},
) {
  if (opts.errorMessages !== undefined) {
    validateErrorMessagesInput(opts.errorMessages)
  }
  return createMiddleware<{ Variables: EvaAuthVariables<TExtra> }>(async (c, next) => {
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
    }

    if (refreshToken) {
      const refreshResult = await deduplicateRefresh(refreshToken, () => client.refresh({ refreshToken }))
      if (refreshResult.ok && refreshResult.data.tokens) {
        const verifyResult = await verifyAccessToken<TExtra>(refreshResult.data.tokens.accessToken, {
          extraClaimsSchema: opts.extraClaimsSchema,
        })
        if (verifyResult.ok) {
          c.set('evaPayload', verifyResult.data)
          const cookieHeaders = setTokenCookies(refreshResult.data.tokens)
          for (const cookie of cookieHeaders) {
            c.header('Set-Cookie', cookie, { append: true })
          }
          await next()
          return
        }
      }
      const clearHeaders = clearTokenCookies()
      for (const cookie of clearHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
    }

    const messages = resolveErrorMessages(opts.errorMessages, getErrorMessages())
    const wire = getErrorWire()
    if (wire === 'api') {
      return c.json({ error: { code: 'unauthorized', message: messages.authRequired } }, 401)
    }
    return c.json({ error: messages.authRequired }, 401)
  })
}

import type { MiddlewareHandler } from 'hono'
import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'

export function evaAuth(): MiddlewareHandler {
  const client = createHttpClient()

  return async (c, next) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken, refreshToken } = readTokensFromCookies(cookieHeader)

    if (accessToken) {
      const result = await verifyAccessToken(accessToken)
      if (result.ok) {
        c.set('evaPayload', result.data)
        await next()
        return
      }
    }

    if (refreshToken) {
      const refreshResult = await client.refresh({ refreshToken })
      if (refreshResult.ok && refreshResult.data.tokens) {
        const verifyResult = await verifyAccessToken(refreshResult.data.tokens.accessToken)
        if (verifyResult.ok) {
          c.set('evaPayload', verifyResult.data)
          await next()
          const cookieHeaders = setTokenCookies(refreshResult.data.tokens)
          for (const cookie of cookieHeaders) {
            c.header('Set-Cookie', cookie, { append: true })
          }
          return
        }
      }
      const clearHeaders = clearTokenCookies()
      for (const cookie of clearHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
    }

    return c.json({ error: 'Autenticación requerida' }, 401)
  }
}

import type { MiddlewareHandler } from 'hono'
import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'
import type { Result, TokenPair } from '../types'

const pendingRefreshes = new Map<string, Promise<Result<{ user: { id: string }; tokens: TokenPair }>>>()

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
      if (!pendingRefreshes.has(refreshToken)) {
        const promise = client.refresh({ refreshToken }).finally(() => {
          pendingRefreshes.delete(refreshToken)
        })
        pendingRefreshes.set(refreshToken, promise)
      }
      const refreshResult = await pendingRefreshes.get(refreshToken)!
      if (refreshResult.ok && refreshResult.data.tokens) {
        const verifyResult = await verifyAccessToken(refreshResult.data.tokens.accessToken)
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

    return c.json({ error: 'Autenticación requerida' }, 401)
  }
}

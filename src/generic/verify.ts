import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'
import type { EvaTokenPayload, Result, TokenPair } from '../types'

type VerifyResult = {
  payload: EvaTokenPayload
  newCookies?: string[]
}

const client = createHttpClient()
const pendingRefreshes = new Map<string, Promise<Result<{ user: { id: string }; tokens: TokenPair }>>>()

export async function verifyRequest(request: Request): Promise<Result<VerifyResult>> {
  const cookieHeader = request.headers.get('cookie')
  const { accessToken, refreshToken } = readTokensFromCookies(cookieHeader)

  if (accessToken) {
    const result = await verifyAccessToken(accessToken)
    if (result.ok) return { ok: true, data: { payload: result.data } }
  }

  if (!refreshToken) {
    return { ok: false, error: 'Tokens no válidos', status: 401 }
  }

  if (!pendingRefreshes.has(refreshToken)) {
    const promise = client.refresh({ refreshToken }).finally(() => {
      pendingRefreshes.delete(refreshToken)
    })
    pendingRefreshes.set(refreshToken, promise)
  }

  const refreshResult = await pendingRefreshes.get(refreshToken)!

  if (!refreshResult.ok) {
    return { ok: false, error: refreshResult.error, status: 401 }
  }

  const { tokens } = refreshResult.data
  if (!tokens) {
    return { ok: false, error: 'El refresco no retornó nuevos tokens', status: 401 }
  }

  const verifyResult = await verifyAccessToken(tokens.accessToken)

  if (!verifyResult.ok) {
    return { ok: false, error: verifyResult.error, status: 401 }
  }

  return {
    ok: true,
    data: {
      payload: verifyResult.data,
      newCookies: setTokenCookies(tokens),
    },
  }
}

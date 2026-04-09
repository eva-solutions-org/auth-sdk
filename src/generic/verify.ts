import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'
import type { EvaTokenPayload, Result } from '../types'

type VerifyResult = {
  payload: EvaTokenPayload
  newCookies?: string[]
}

export async function verifyRequest(request: Request): Promise<Result<VerifyResult>> {
  const cookieHeader = request.headers.get('cookie')
  const { accessToken, refreshToken } = readTokensFromCookies(cookieHeader)

  if (accessToken) {
    const result = await verifyAccessToken(accessToken)
    if (result.ok) return { ok: true, data: { payload: result.data } }
  }

  if (!refreshToken) {
    return { ok: false, error: 'No valid tokens', status: 401 }
  }

  const refreshResult = await createHttpClient().refresh({ refreshToken })

  if (!refreshResult.ok) {
    return { ok: false, error: refreshResult.error, status: 401 }
  }

  const { tokens } = refreshResult.data
  if (!tokens) {
    return { ok: false, error: 'Refresh did not return new tokens', status: 401 }
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

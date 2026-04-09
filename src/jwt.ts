import { jwtVerify } from 'jose'
import { getPublicKey } from './jwks'
import { JWT_CONFIG } from './constants'
import type { EvaTokenPayload, Result } from './types'

export async function verifyAccessToken(token: string): Promise<Result<EvaTokenPayload>> {
  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_CONFIG.ISSUER,
      audience: JWT_CONFIG.AUDIENCE,
    })

    const id = payload.sub
    const sessionId = payload.sessionId as string | undefined

    if (!id || !sessionId) {
      return { ok: false, error: 'Invalid token payload', status: 401 }
    }

    return { ok: true, data: { id, sessionId } }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token verification failed'
    return { ok: false, error: message, status: 401 }
  }
}

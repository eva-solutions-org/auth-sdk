import { jwtVerify } from 'jose'
import { z } from 'zod'
import { getPublicKey } from './jwks'
import { JWT_CONFIG } from './constants'
import type { EvaTokenPayload, Result } from './types'

const JwtPayloadSchema = z.object({
  sub: z.string(),
  sessionId: z.string(),
})

export async function verifyAccessToken(token: string): Promise<Result<EvaTokenPayload>> {
  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_CONFIG.ISSUER,
      audience: JWT_CONFIG.AUDIENCE,
    })

    const parsed = JwtPayloadSchema.safeParse(payload)

    if (!parsed.success) {
      return { ok: false, error: 'Payload del token inválido', status: 401 }
    }

    return { ok: true, data: { id: parsed.data.sub, sessionId: parsed.data.sessionId } }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verificación de token fallida'
    return { ok: false, error: message, status: 401 }
  }
}

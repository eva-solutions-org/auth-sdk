/**
 * RFC compliance: ningún claim reservado debe aparecer en EvaTokenPayload.
 * Parametrizado sobre RESERVED_JWT_CLAIMS (RFC 7519 §4.1 + OIDC Core 1.0 §2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { verifyAccessToken } from '../src/jwt'
import { RESERVED_JWT_CLAIMS } from '../src/jwt-claims'

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
}))

vi.mock('../src/jwks', () => ({
  getPublicKey: vi.fn().mockResolvedValue('mock-key'),
}))

import { jwtVerify } from 'jose'
import { getPublicKey } from '../src/jwks'

const jwtVerifyMock = vi.mocked(jwtVerify)
const getPublicKeyMock = vi.mocked(getPublicKey)

beforeEach(() => {
  vi.clearAllMocks()
  getPublicKeyMock.mockResolvedValue('mock-key' as any)
})

// ───── Sin schema: ningún claim reservado aparece en payload ─────

describe('RESERVED_JWT_CLAIMS — sin schema', () => {
  for (const claim of RESERVED_JWT_CLAIMS) {
    it(`claim "${claim}": NO aparece en payload cuando no hay schema`, async () => {
      // 'sub' es especial: es la fuente de 'id' en el SDK (REQ-TE-022).
      // Cuando el JWT tiene solo { sub: 'u1', sessionId: 's1' } y no hay extras,
      // el payload retornado es { id: 'u1', sessionId: 's1' } — 'sub' no aparece.
      // Para cualquier otro reserved claim, el valor del claim no aparece en payload.
      const jwtPayload: Record<string, unknown> =
        claim === 'sub'
          ? { sub: 'u1', sessionId: 's1' }           // sub ya está en el payload base
          : { sub: 'u1', sessionId: 's1', [claim]: 'valor-reservado' }

      jwtVerifyMock.mockResolvedValue({
        payload: jwtPayload,
        protectedHeader: { alg: 'ES256' },
      } as any)

      const result = await verifyAccessToken('token-reserved')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      // El claim reservado NO aparece como propiedad en el payload.
      expect(result.data).not.toHaveProperty(claim)
      // El payload es exactamente { id, sessionId } (REQ-TE-012).
      expect(result.data).toEqual({ id: 'u1', sessionId: 's1' })
    })
  }
})

// ───── Con schema vacío: ningún claim reservado aparece en payload ─────

describe('RESERVED_JWT_CLAIMS — con schema z.object({})', () => {
  for (const claim of RESERVED_JWT_CLAIMS) {
    it(`claim "${claim}": NO aparece en payload con schema z.object({})`, async () => {
      const jwtPayload: Record<string, unknown> = {
        sub: 'u1',
        sessionId: 's1',
        [claim]: 'valor-reservado',
      }

      jwtVerifyMock.mockResolvedValue({
        payload: jwtPayload,
        protectedHeader: { alg: 'ES256' },
      } as any)

      const schema = z.object({})
      const result = await verifyAccessToken('token-reserved-schema', { extraClaimsSchema: schema })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data).not.toHaveProperty(claim)
    })
  }
})

// ───── Schema declarando un claim reservado → fail-fast (REQ-TE-021) ─────

describe('RESERVED_JWT_CLAIMS — schema que declara claim reservado → fail-fast', () => {
  for (const claim of RESERVED_JWT_CLAIMS) {
    it(`schema con "${claim}": lanza error con mensaje sobre claim reservado`, async () => {
      jwtVerifyMock.mockResolvedValue({
        payload: { sub: 'u1', sessionId: 's1' },
        protectedHeader: { alg: 'ES256' },
      } as any)

      const schema = z.object({ [claim]: z.unknown() })
      const result = await verifyAccessToken('any-token', { extraClaimsSchema: schema })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toMatch(/claim reservado/i)
      expect(result.error.message).toContain(claim)
    })
  }
})

// ───── Claims similares a reservados pero NO reservados → permitidos ─────

describe('Claims similares a reservados — NO son reservados', () => {
  it('claim "expirationTime" (no reservado): permitido en schema', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', expirationTime: 1800000000 },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ expirationTime: z.number() })
    const result = await verifyAccessToken('token-custom', { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: 'u1', sessionId: 's1', expirationTime: 1800000000 })
  })

  it('claim "issuer" (no reservado): permitido en schema', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', issuer: 'custom-issuer' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ issuer: z.string() })
    const result = await verifyAccessToken('token-issuer', { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: 'u1', sessionId: 's1', issuer: 'custom-issuer' })
  })
})

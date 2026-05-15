import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { verifyAccessToken } from '../src/jwt'
import { JWT_CONFIG } from '../src/constants'

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

describe('verifyAccessToken', () => {
  // ───── Casos existentes (backward compat — REQ-TE-030..033) ─────

  it('retorna ok con payload cuando el token es válido', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-123', sessionId: 'sess-456' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('valid-token')

    expect(result).toEqual({
      ok: true,
      data: { id: 'user-123', sessionId: 'sess-456' },
    })
  })

  it('retorna error cuando sub está ausente en el payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sessionId: 'sess-456' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-sin-sub')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Payload del token inválido')
    expect(result.error.status).toBe(401)
  })

  it('retorna error cuando sessionId está ausente en el payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-123' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-sin-session')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Payload del token inválido')
    expect(result.error.status).toBe(401)
  })

  it('retorna error cuando jwtVerify lanza excepción', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'))

    const result = await verifyAccessToken('token-invalido')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('signature verification failed')
    expect(result.error.status).toBe(401)
  })

  it('retorna error genérico cuando jwtVerify lanza excepción no-Error', async () => {
    jwtVerifyMock.mockRejectedValue('algo inesperado')

    const result = await verifyAccessToken('token-raro')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Verificación de token fallida')
    expect(result.error.status).toBe(401)
  })

  it('pasa issuer y audience correctos a jwtVerify', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', sessionId: 'sess-1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    await verifyAccessToken('any-token')

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'any-token',
      'mock-key',
      {
        issuer: JWT_CONFIG.ISSUER,
        audience: JWT_CONFIG.AUDIENCE,
      },
    )
  })

  it('llama getPublicKey una vez por invocación', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', sessionId: 'sess-1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    await verifyAccessToken('token')

    expect(getPublicKeyMock).toHaveBeenCalledOnce()
  })

  // ───── Sin schema: drop everything excepto id/sessionId (REQ-TE-012) ─────

  it('sin schema: JWT con claims extra (phone, empresaId) — NO se exponen en payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', phone: '+543412345', empresaId: 'emp-99' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-with-extras')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: 'u1', sessionId: 's1' })
    expect(result.data).not.toHaveProperty('phone')
    expect(result.data).not.toHaveProperty('empresaId')
  })

  it('sin schema: JWT con claims estándar (iss, aud, iat, nbf, jti) — NO se exponen en payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'u1',
        sessionId: 's1',
        iss: 'auth.x.com',
        aud: 'api',
        iat: 1700000000,
        nbf: 1700000000,
        jti: 'abc',
        exp: 1800000000,
      },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-standard-claims')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: 'u1', sessionId: 's1' })
  })

  // ───── Con schema válido ─────

  it('con schema válido: extras parseados y mergeados en payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', phone: '+543412345' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ phone: z.string() })
    const result = await verifyAccessToken('token-with-phone', { extraClaimsSchema: schema })

    expect(result).toEqual({
      ok: true,
      data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
    })
  })

  // ───── Schema mismatch ─────

  it('schema mismatch (claim ausente): retorna error 401', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ phone: z.string() })
    const result = await verifyAccessToken('token-missing-phone', { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Payload del token inválido (claims extra)')
    expect(result.error.status).toBe(401)
  })

  it('schema mismatch (tipo incorrecto): retorna error 401', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', phone: 12345 },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ phone: z.string() })
    const result = await verifyAccessToken('token-phone-wrong-type', { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Payload del token inválido (claims extra)')
    expect(result.error.status).toBe(401)
  })

  // ───── Claim reservado en schema (fail-fast — REQ-TE-021) ─────

  it('schema con claim reservado (exp): lanza error fail-fast', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ exp: z.number() })
    const result = await verifyAccessToken('any-token', { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toMatch(/claim reservado/i)
    expect(result.error.message).toContain('exp')
    expect(result.error.status).toBe(401)
  })

  it('schema con claim "id": lanza error fail-fast (colisión con shape base)', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ id: z.string() })
    const result = await verifyAccessToken('any-token', { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toMatch(/claim reservado/i)
    expect(result.error.status).toBe(401)
  })

  it('schema con claim "sessionId": lanza error fail-fast (colisión con shape base)', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ sessionId: z.string() })
    const result = await verifyAccessToken('any-token', { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toMatch(/claim reservado/i)
    expect(result.error.status).toBe(401)
  })

  // ───── Schema con campo opcional (REQ-TE-012 + scenario "optional props") ─────

  it('schema con campo opcional: JWT sin ese campo no falla', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ phone: z.string().optional() })
    const result = await verifyAccessToken('token-no-phone', { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe('u1')
    expect(result.data.sessionId).toBe('s1')
  })

  // ───── Schema async (safeParseAsync — design nota #4) ─────

  it('schema async (refine async): safeParseAsync funciona correctamente', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'u1', sessionId: 's1', phone: '+543412345' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({
      phone: z.string().refine(async (v) => v.startsWith('+'), 'debe comenzar con +'),
    })
    const result = await verifyAccessToken('token-async', { extraClaimsSchema: schema })

    expect(result).toEqual({
      ok: true,
      data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
    })
  })

  // ───── Claim 'id' en JWT distinto a sub (REQ-TE-022) ─────

  it('JWT con claim "id" distinto a sub: SDK usa sub como id, descarta claim "id"', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'real-id', sessionId: 's1', id: 'fake-id' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-id-collision')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe('real-id')
  })

  // ───── Reserved claims drop con schema — solo extras válidos se exponen ─────

  it('con schema: claims reservados (iat, exp, iss, aud, jti, nbf) NO aparecen en payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'u1',
        sessionId: 's1',
        iss: 'auth.x.com',
        aud: 'api',
        iat: 1700000000,
        nbf: 1700000000,
        jti: 'abc',
        exp: 1800000000,
        phone: '+543412345',
      },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const schema = z.object({ phone: z.string() })
    const result = await verifyAccessToken('token-full-claims', { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ id: 'u1', sessionId: 's1', phone: '+543412345' })
    expect(result.data).not.toHaveProperty('iss')
    expect(result.data).not.toHaveProperty('aud')
    expect(result.data).not.toHaveProperty('iat')
    expect(result.data).not.toHaveProperty('jti')
  })
})

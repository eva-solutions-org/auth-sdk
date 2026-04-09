import { describe, it, expect, vi, beforeEach } from 'vitest'
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

    expect(result).toEqual({
      ok: false,
      error: 'Invalid token payload',
      status: 401,
    })
  })

  it('retorna error cuando sessionId está ausente en el payload', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-123' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    const result = await verifyAccessToken('token-sin-session')

    expect(result).toEqual({
      ok: false,
      error: 'Invalid token payload',
      status: 401,
    })
  })

  it('retorna error cuando jwtVerify lanza excepción', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'))

    const result = await verifyAccessToken('token-invalido')

    expect(result).toEqual({
      ok: false,
      error: 'signature verification failed',
      status: 401,
    })
  })

  it('retorna error genérico cuando jwtVerify lanza excepción no-Error', async () => {
    jwtVerifyMock.mockRejectedValue('algo inesperado')

    const result = await verifyAccessToken('token-raro')

    expect(result).toEqual({
      ok: false,
      error: 'Token verification failed',
      status: 401,
    })
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
})

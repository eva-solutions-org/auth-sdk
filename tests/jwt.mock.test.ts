import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { verifyAccessToken } from '../src/jwt'
import { JWT_CONFIG } from '../src/constants'

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
}))

vi.mock('../src/jwks', () => ({
  // getJwksKeyFn es sync y retorna una función (JwksKeyFn — async key resolver)
  getJwksKeyFn: vi.fn().mockReturnValue(vi.fn()),
}))

import { jwtVerify } from 'jose'
import { getJwksKeyFn } from '../src/jwks'
import { getAuthUrl } from '../src/config'

const jwtVerifyMock = vi.mocked(jwtVerify)
const getJwksKeyFnMock = vi.mocked(getJwksKeyFn)

beforeEach(() => {
  vi.clearAllMocks()
  getJwksKeyFnMock.mockReturnValue(vi.fn() as any)
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

  it('pasa issuer, audience y algorithms correctos a jwtVerify', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', sessionId: 'sess-1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    await verifyAccessToken('any-token')

    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'any-token',
      expect.any(Function), // getJwksKeyFn() retorna función (JwksKeyFn), no CryptoKey
      {
        issuer: JWT_CONFIG.ISSUER,
        audience: JWT_CONFIG.AUDIENCE,
        algorithms: [JWT_CONFIG.ALGORITHM],
      },
    )
  })

  it('pasa algorithms: [ES256] a jwtVerify (P4 — defense-in-depth)', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', sessionId: 'sess-1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    await verifyAccessToken('any-token')

    const [, , options] = jwtVerifyMock.mock.calls[0]
    expect(options).toHaveProperty('algorithms', [JWT_CONFIG.ALGORITHM])
    expect(options).toHaveProperty('algorithms', ['ES256'])
  })

  it('llama getJwksKeyFn una vez por invocación', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', sessionId: 'sess-1' },
      protectedHeader: { alg: 'ES256' },
    } as any)

    await verifyAccessToken('token')

    expect(getJwksKeyFnMock).toHaveBeenCalledOnce()
  })

  it('retorna token_invalid cuando jwtVerify lanza JWKSNoMatchingKey (REQ-JWKS-08)', async () => {
    const err = new Error('no applicable keys found in the JSON Web Key Set')
    err.name = 'JWKSNoMatchingKey'
    jwtVerifyMock.mockRejectedValue(err)

    const result = await verifyAccessToken('token-kid-inexistente')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.reason).toBe('token_invalid')
    expect(result.error.status).toBe(401)
  })

  it('retorna token_invalid cuando jwtVerify lanza JWKSTimeout (REQ-JWKS-09)', async () => {
    const err = new Error('request timed out')
    err.name = 'JWKSTimeout'
    jwtVerifyMock.mockRejectedValue(err)

    const result = await verifyAccessToken('token-timeout')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.status).toBe(401)
  })

  // ───── Algorithm confusion — REQ-JWT-02 (test dedicado) ─────
  //
  // Este test verifica que un token cuyo header declara un algoritmo distinto de ES256
  // es RECHAZADO por verifyAccessToken con reason: 'token_invalid'.
  //
  // Capa que lo rechaza: jose, en la fase de validación del algoritmo del header JWS
  // ANTES de intentar verificar la firma. Cuando jwtVerify recibe options.algorithms: ['ES256']
  // y el token tiene alg: 'RS256' (u otro), lanza JOSEAlgorithmNotAllowed con el mensaje
  // '"RS256" alg not allowed'. Este error ocurre en el header parsing de jose, no en la
  // verificación criptográfica. Fuente: jose v6 src/lib/check_key_type.ts + jose/src/jws/flattened/verify.ts.
  //
  // Anti-regresión: si se eliminara `algorithms: ['ES256']` de la call a jwtVerify,
  // jose NO lanzaría JOSEAlgorithmNotAllowed — intentaría verificar la firma con la
  // CryptoKey ES256 y fallaría con JWSSignatureVerificationFailed (error diferente).
  // El nombre del error en el mock es el discriminador: este test solo pasa cuando
  // jose alcanza el check de algoritmo declarativo, que requiere algorithms: ['ES256'].
  //
  // Escenarios cubiertos por error.name diferente: RS256, HS256, alg 'none' → todos
  // producen JOSEAlgorithmNotAllowed cuando algorithms: ['ES256'] está configurado.

  it('rechaza token con alg distinto de ES256 — algorithm confusion → token_invalid (REQ-JWT-02)', async () => {
    // Fixture: jose lanza JOSEAlgorithmNotAllowed cuando el header del token
    // declara alg: 'RS256' pero options.algorithms solo permite 'ES256'.
    const err = new Error('"RS256" alg not allowed')
    err.name = 'JOSEAlgorithmNotAllowed'
    jwtVerifyMock.mockRejectedValue(err)

    // Acción: intentar verificar un token con alg inválido
    const result = await verifyAccessToken('rs256-token')

    // Assert 1: el result es falla con reason token_invalid y status 401
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.reason).toBe('token_invalid')
    expect(result.error.status).toBe(401)

    // Assert 2 (anti-regresión): jwtVerify fue llamado con algorithms: ['ES256'] explícito.
    // Si se quitara algorithms del call site, jose no lanzaría JOSEAlgorithmNotAllowed
    // y el test fallaría al no recibir el error esperado del mock.
    const [, , options] = jwtVerifyMock.mock.calls[0]
    expect(options).toHaveProperty('algorithms', ['ES256'])
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

describe('verifyAccessToken — errores de configuración', () => {
  it('verify_rethrows_config_error: sin authUrl rechaza con el error de config, no token_invalid', async () => {
    // getAuthUrl REAL sin configurar: lanza el EvaAuthConfigError verdadero (config no está mockeado).
    getJwksKeyFnMock.mockImplementation(() => {
      getAuthUrl()
      return vi.fn() as any
    })

    await expect(verifyAccessToken('any-token')).rejects.toMatchObject({ name: 'EvaAuthConfigError' })
    expect(jwtVerifyMock).not.toHaveBeenCalled()
  })

  it('verify_maps_malformed_to_token_invalid: un token malformado sigue siendo 401 token_invalid', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('Invalid Compact JWS'))

    const result = await verifyAccessToken('not-a-jwt')

    expect(result).toEqual({
      ok: false,
      error: { kind: 'sdk', reason: 'token_invalid', message: 'Invalid Compact JWS', status: 401 },
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock PRIMERO — antes de cualquier import del módulo bajo test.
// createRemoteJWKSet es sync, retorna una función (JwksKeyFn). El mock debe reflejarlo.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
}))

vi.mock('../src/constants', () => ({
  getAuthServiceUrl: vi.fn().mockReturnValue('http://auth.test'),
}))

import { createRemoteJWKSet } from 'jose'
import { getJwksKeyFn, _resetJwksForTesting } from '../src/jwks'

const createRemoteJWKSetMock = vi.mocked(createRemoteJWKSet)

beforeEach(() => {
  vi.clearAllMocks()
  _resetJwksForTesting() // reset singleton entre tests
  // createRemoteJWKSet es sync y retorna una función (JwksKeyFn — async key resolver)
  createRemoteJWKSetMock.mockReturnValue(vi.fn() as any)
})

describe('getJwksKeyFn', () => {
  it('llama createRemoteJWKSet con la URL correcta al inicializar', () => {
    getJwksKeyFn()

    expect(createRemoteJWKSetMock).toHaveBeenCalledOnce()
    const [urlArg] = createRemoteJWKSetMock.mock.calls[0]
    expect(urlArg).toBeInstanceOf(URL)
    expect((urlArg as URL).href).toBe('http://auth.test/.well-known/jwks.json')
  })

  it('llama createRemoteJWKSet con cacheMaxAge: 86_400_000 (24h)', () => {
    getJwksKeyFn()

    const [, options] = createRemoteJWKSetMock.mock.calls[0]
    expect((options as Record<string, unknown>).cacheMaxAge).toBe(86_400_000)
  })

  it('llama createRemoteJWKSet con cooldownDuration: 30_000 (30s)', () => {
    getJwksKeyFn()

    const [, options] = createRemoteJWKSetMock.mock.calls[0]
    expect((options as Record<string, unknown>).cooldownDuration).toBe(30_000)
  })

  it('llama createRemoteJWKSet con timeoutDuration: 5_000 (5s)', () => {
    getJwksKeyFn()

    const [, options] = createRemoteJWKSetMock.mock.calls[0]
    expect((options as Record<string, unknown>).timeoutDuration).toBe(5_000)
  })

  it('inicialización lazy: createRemoteJWKSet NO se llama al importar el módulo', () => {
    // Al importar sin llamar getJwksKeyFn(), createRemoteJWKSet no debe ejecutarse.
    // El módulo ya fue importado arriba — si hubiera init eagerly, el mock ya tendría 0 calls
    // PERO afterBeforeEach clearAllMocks ya reseteó los contadores.
    // El estado de _jwks también fue reseteado por _resetJwksForTesting().
    // Por ende, si no llamamos getJwksKeyFn(), el mock debe tener 0 calls.
    expect(createRemoteJWKSetMock).toHaveBeenCalledTimes(0)
  })

  it('retorna la misma instancia en llamadas sucesivas (singleton)', () => {
    const first = getJwksKeyFn()
    const second = getJwksKeyFn()
    const third = getJwksKeyFn()

    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('createRemoteJWKSet se llama EXACTAMENTE 1 vez aunque getJwksKeyFn se llame N veces', () => {
    getJwksKeyFn()
    getJwksKeyFn()
    getJwksKeyFn()

    expect(createRemoteJWKSetMock).toHaveBeenCalledTimes(1)
  })

  it('retorna una función (JwksKeyFn)', () => {
    const keyFn = getJwksKeyFn()

    expect(typeof keyFn).toBe('function')
  })
})

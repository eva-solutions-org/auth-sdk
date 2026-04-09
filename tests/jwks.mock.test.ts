import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('jose', () => ({
  importJWK: vi.fn().mockResolvedValue('mock-crypto-key'),
}))

vi.mock('../src/constants', () => ({
  getAuthServiceUrl: vi.fn().mockReturnValue('http://auth.test'),
}))

class MockCryptoKey {}
vi.stubGlobal('CryptoKey', MockCryptoKey)
const mockKey = new MockCryptoKey() as unknown as CryptoKey

import { fetchJwks, getPublicKey, clearJwksCache } from '../src/jwks'
import { importJWK } from 'jose'

const importJWKMock = vi.mocked(importJWK)

const fakeJwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' }

function mockFetchResponse(opts: {
  ok?: boolean
  status?: number
  json?: unknown
  etag?: string | null
} = {}) {
  const { ok = true, status = 200, json = { keys: [fakeJwk] }, etag = null } = opts
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(json),
    headers: {
      get: vi.fn((h: string) => h === 'etag' ? etag : null),
    },
  } as unknown as Response)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearJwksCache()
  importJWKMock.mockResolvedValue(mockKey)
})

describe('fetchJwks', () => {
  it('hace fetch a la URL correcta (.well-known/jwks.json)', async () => {
    const fetchMock = mockFetchResponse()
    vi.stubGlobal('fetch', fetchMock)

    await fetchJwks()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth.test/.well-known/jwks.json',
      expect.objectContaining({ headers: {} }),
    )
  })

  it('envía If-None-Match cuando hay ETag cacheado', async () => {
    const fetchMock = mockFetchResponse({ etag: '"etag-123"' })
    vi.stubGlobal('fetch', fetchMock)

    // Primera llamada para cachear con etag
    await fetchJwks()
    fetchMock.mockClear()

    // Segunda llamada debe enviar If-None-Match
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ keys: [fakeJwk] }),
      headers: { get: vi.fn(() => '"etag-123"') },
    } as unknown as Response)

    await fetchJwks()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth.test/.well-known/jwks.json',
      expect.objectContaining({
        headers: { 'If-None-Match': '"etag-123"' },
      }),
    )
  })

  it('en 304 con key cacheada, no importa nueva key', async () => {
    // Primero cacheamos una key
    const fetchMock = mockFetchResponse({ etag: '"etag-1"' })
    vi.stubGlobal('fetch', fetchMock)
    await fetchJwks()

    importJWKMock.mockClear()

    // Ahora simulamos 304
    fetchMock.mockResolvedValue({
      ok: false,
      status: 304,
      json: vi.fn(),
      headers: { get: vi.fn(() => null) },
    } as unknown as Response)

    await fetchJwks()

    expect(importJWKMock).not.toHaveBeenCalled()
  })

  it('lanza error si fetch falla y no hay cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(fetchJwks()).rejects.toThrow('Error al obtener JWKS y no hay clave en caché')
  })

  it('usa cache si fetch falla pero hay key cacheada (no lanza)', async () => {
    // Primero cacheamos
    const fetchMock = mockFetchResponse()
    vi.stubGlobal('fetch', fetchMock)
    await fetchJwks()

    // Ahora fetch falla
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(fetchJwks()).resolves.toBeUndefined()
  })

  it('lanza error si respuesta no-ok y no hay cache', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ ok: false, status: 500 }))

    await expect(fetchJwks()).rejects.toThrow('Error al obtener JWKS con estado 500')
  })

  it('usa cache si respuesta no-ok pero hay key cacheada', async () => {
    // Primero cacheamos
    const fetchMock = mockFetchResponse()
    vi.stubGlobal('fetch', fetchMock)
    await fetchJwks()

    // Ahora respuesta no-ok
    vi.stubGlobal('fetch', mockFetchResponse({ ok: false, status: 503 }))

    await expect(fetchJwks()).resolves.toBeUndefined()
  })

  it('lanza error si JWKS no contiene keys', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ json: { keys: [] } }))

    await expect(fetchJwks()).rejects.toThrow('Formato de respuesta JWKS inválido')
  })

  it('importa correctamente el primer JWK y actualiza cache', async () => {
    vi.stubGlobal('fetch', mockFetchResponse({ etag: '"etag-new"' }))

    await fetchJwks()

    expect(importJWKMock).toHaveBeenCalledWith(fakeJwk, 'ES256')
    const key = await getPublicKey()
    expect(key).toBe(mockKey)
  })
})

describe('getPublicKey', () => {
  it('llama fetchJwks cuando no hay cache', async () => {
    vi.stubGlobal('fetch', mockFetchResponse())

    const key = await getPublicKey()

    expect(fetch).toHaveBeenCalled()
    expect(key).toBe(mockKey)
  })

  it('retorna key cacheada cuando no está stale', async () => {
    vi.stubGlobal('fetch', mockFetchResponse())

    // Poblar cache
    await getPublicKey()
    vi.mocked(fetch).mockClear()

    // Segunda llamada — no debe hacer fetch
    const key = await getPublicKey()

    expect(fetch).not.toHaveBeenCalled()
    expect(key).toBe(mockKey)
  })

  it('lanza error si después de fetchJwks no hay key', async () => {
    // fetch ok pero sin keys y sin cache
    vi.stubGlobal('fetch', mockFetchResponse({ json: { keys: [] } }))

    await expect(getPublicKey()).rejects.toThrow()
  })
})

describe('clearJwksCache', () => {
  it('limpia el cache (getPublicKey llama fetchJwks de nuevo)', async () => {
    vi.stubGlobal('fetch', mockFetchResponse())

    // Poblar cache
    await getPublicKey()
    vi.mocked(fetch).mockClear()

    // Limpiar cache
    clearJwksCache()

    // Debe hacer fetch de nuevo
    vi.stubGlobal('fetch', mockFetchResponse())
    await getPublicKey()

    expect(fetch).toHaveBeenCalled()
  })
})

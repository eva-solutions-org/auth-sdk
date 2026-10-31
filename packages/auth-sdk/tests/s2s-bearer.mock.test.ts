/**
 * createS2SClient with a token provider: Bearer on every call, ONE retry after a 401 with a fresh
 * token, provider failures as Results, and the companies API methods.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createS2SClient } from '../src/s2s/client'
import { ServiceTokenRequestError } from '../src/s2s/token-provider'
import {
  createServiceTokenProvider,
  type ServiceTokenProvider,
} from '../src/s2s/token-provider'

const BASE_URL = 'https://auth.test'
const UUID = '550e8400-e29b-41d4-a716-446655440000'

let fetchMock: ReturnType<typeof vi.fn>

const ok = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => ({ data }),
})
const apiError = (status: number, code: string, message = 'm') => ({
  ok: false,
  status,
  json: async () => ({ error: { code, message } }),
})

/** Provider that hands out tok-1, tok-2, … and counts its invalidations. */
function sequentialProvider() {
  let n = 0
  const provider = {
    getToken: vi.fn(async () => `tok-${++n}`),
    invalidate: vi.fn(),
  } satisfies ServiceTokenProvider
  return provider
}

const bearerOf = (call: number) =>
  (
    (fetchMock.mock.calls[call] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >
  ).authorization

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('401 handling', () => {
  it('invalidates the token and retries ONCE with a fresh one', async () => {
    fetchMock
      .mockResolvedValueOnce(apiError(401, 'unauthorized'))
      .mockResolvedValueOnce(ok({ id: 'u1' }))
    const provider = sequentialProvider()

    const result = await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: provider,
    }).getUser('u1')

    expect(result).toEqual({ ok: true, data: { id: 'u1' } })
    expect(provider.invalidate).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect([bearerOf(0), bearerOf(1)]).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })

  it('does not retry a second time: a repeated 401 is the final answer', async () => {
    fetchMock.mockResolvedValue(apiError(401, 'unauthorized'))
    const provider = sequentialProvider()

    const result = await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: provider,
    }).getUser('u1')

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'api', status: 401, code: 'unauthorized' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(provider.invalidate).toHaveBeenCalledTimes(1)
  })

  it.each([403, 404, 409, 500])(
    'does not retry or invalidate on %i',
    async (status) => {
      fetchMock.mockResolvedValue(apiError(status, 'x'))
      const provider = sequentialProvider()

      await createS2SClient({
        baseUrl: BASE_URL,
        tokenProvider: provider,
      }).getUser('u1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(provider.invalidate).not.toHaveBeenCalled()
    },
  )

  it('resends the same body on the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(apiError(401, 'unauthorized'))
      .mockResolvedValueOnce(ok({ users: [] }))

    await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: sequentialProvider(),
    }).batchUsers({ ids: ['a', 'b'] })

    const bodies = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body)
    expect(bodies).toEqual(['{"ids":["a","b"]}', '{"ids":["a","b"]}'])
  })
})

describe('provider failures become Results', () => {
  it('maps a rejected token request to an api error carrying the RFC code', async () => {
    const provider: ServiceTokenProvider = {
      getToken: async () => {
        throw new ServiceTokenRequestError('invalid_client', 401, 'disabled')
      },
      invalidate() {},
    }

    const result = await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: provider,
    }).getUser('u1')

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'api',
        code: 'invalid_client',
        message: 'disabled',
        status: 401,
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a provider network failure to an sdk network error', async () => {
    const provider: ServiceTokenProvider = {
      getToken: async () => {
        throw new Error('ECONNREFUSED')
      },
      invalidate() {},
    }

    const result = await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: provider,
    }).getUser('u1')

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'network',
        message: 'ECONNREFUSED',
        status: 0,
      },
    })
  })
})

describe('companies API', () => {
  const client = () =>
    createS2SClient({ baseUrl: BASE_URL, tokenProvider: sequentialProvider() })
  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return { url, method: init.method, body: init.body }
  }

  it('createEmpresa posts the body and returns the 201 company', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1', slug: 'gym' }, 201))
    const input = {
      ruc: '20123456789',
      razonSocial: 'Gym SAC',
      slug: 'gym',
      primerMiembroUserId: UUID,
    }

    const result = await client().createEmpresa(input)

    expect(result).toEqual({ ok: true, data: { id: 'e1', slug: 'gym' } })
    expect(lastCall()).toEqual({
      url: `${BASE_URL}/api/v1/internal/empresas`,
      method: 'POST',
      body: JSON.stringify(input),
    })
  })

  it('createEmpresa surfaces the 409 conflict', async () => {
    fetchMock.mockResolvedValue(apiError(409, 'conflict', 'ruc already exists'))

    const result = await client().createEmpresa({
      ruc: '1',
      razonSocial: 'r',
      slug: 'gym',
      primerMiembroUserId: UUID,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { status: 409, code: 'conflict', message: 'ruc already exists' },
    })
  })

  it('getEmpresa gets the detail by id', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1', sucursales: [], miembros: [] }))

    const result = await client().getEmpresa('e1')

    expect(result.ok).toBe(true)
    expect(lastCall()).toMatchObject({
      url: `${BASE_URL}/api/v1/internal/empresas/e1`,
      method: 'GET',
    })
  })

  it('addEmpresaMember posts { userId }', async () => {
    fetchMock.mockResolvedValue(ok({ empresaId: 'e1', userId: UUID }, 201))

    const result = await client().addEmpresaMember('e1', UUID)

    expect(result).toEqual({
      ok: true,
      data: { empresaId: 'e1', userId: UUID },
    })
    expect(lastCall()).toEqual({
      url: `${BASE_URL}/api/v1/internal/empresas/e1/miembros`,
      method: 'POST',
      body: JSON.stringify({ userId: UUID }),
    })
  })

  it('removeEmpresaMember deletes and treats 204 as success without data', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 })

    const result = await client().removeEmpresaMember('e1', UUID)

    expect(result).toEqual({ ok: true, data: undefined })
    expect(lastCall()).toMatchObject({
      url: `${BASE_URL}/api/v1/internal/empresas/e1/miembros/${UUID}`,
      method: 'DELETE',
    })
  })

  it('removeEmpresaMember surfaces 404 when the person is not a member', async () => {
    fetchMock.mockResolvedValue(apiError(404, 'not_found'))

    const result = await client().removeEmpresaMember('e1', UUID)

    expect(result).toMatchObject({ ok: false, error: { status: 404 } })
  })

  it('createSucursal posts the branch to the company', async () => {
    fetchMock.mockResolvedValue(ok({ id: 's1', nombre: 'Centro' }, 201))

    const result = await client().createSucursal('e1', { nombre: 'Centro' })

    expect(result.ok).toBe(true)
    expect(lastCall()).toEqual({
      url: `${BASE_URL}/api/v1/internal/empresas/e1/sucursales`,
      method: 'POST',
      body: JSON.stringify({ nombre: 'Centro' }),
    })
  })

  it.each(['', '.', '..'])(
    'rejects the id %j without calling out',
    async (bad) => {
      const c = client()

      for (const result of [
        await c.getEmpresa(bad),
        await c.addEmpresaMember(bad, UUID),
        await c.removeEmpresaMember('e1', bad),
        await c.createSucursal(bad, { nombre: 'x' }),
      ]) {
        expect(result).toMatchObject({
          ok: false,
          error: { kind: 'sdk', reason: 'malformed' },
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('encodes a company id as one path segment', async () => {
    fetchMock.mockResolvedValue(ok({}))

    await client().getEmpresa('a/b?c')

    expect(lastCall().url).toBe(
      `${BASE_URL}/api/v1/internal/empresas/a%2Fb%3Fc`,
    )
  })
})

describe('401 stampede with the real provider', () => {
  it('20 concurrent requests rejected with the same token cause ONE new token request', async () => {
    let tokenRequests = 0
    fetchMock.mockImplementation(async (url: unknown, init: RequestInit) => {
      if (String(url).endsWith('/internal/token')) {
        tokenRequests += 1
        const n = tokenRequests
        // Slow enough for every concurrent 401 to land while the renewal is in flight.
        await new Promise((r) => setTimeout(r, 20))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `tok-${n}`,
            token_type: 'Bearer',
            expires_in: 300,
            scope: 'users:read',
          }),
        }
      }
      // The API rejects tok-1 (revoked) and accepts anything newer.
      const bearer = (init.headers as Record<string, string>).authorization
      return bearer === 'Bearer tok-1'
        ? apiError(401, 'unauthorized')
        : ok({ id: 'u1' })
    })
    const provider = createServiceTokenProvider({
      authUrl: BASE_URL,
      clientId: 'svc',
      secretHex: 'ab'.repeat(32),
      audience: 'auth-api',
    })
    const s2s = createS2SClient({ baseUrl: BASE_URL, tokenProvider: provider })
    await provider.getToken() // tok-1 is cached and about to be rejected
    expect(tokenRequests).toBe(1)

    const results = await Promise.all(
      Array.from({ length: 20 }, () => s2s.getUser('u1')),
    )

    expect(results.every((r) => r.ok)).toBe(true)
    expect(tokenRequests).toBe(2) // the first one + ONE renewal, not 20
  })
})

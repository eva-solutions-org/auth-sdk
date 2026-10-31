/**
 * createServiceTokenProvider: the HMAC request to the token endpoint, caching by `expires_in`,
 * renewal 30 s early, de-duplication of concurrent requests and `invalidate()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ServiceTokenRequestError,
  createServiceTokenProvider,
  type ServiceTokenProviderConfig,
} from '../src/s2s/token-provider'
import { verifyS2SRequest } from '../src/s2s/verify'

const SECRET_HEX = 'deadbeef'.repeat(8)
const CLIENT_ID = 'gym-backend'

const config: ServiceTokenProviderConfig = {
  authUrl: 'https://auth.test',
  clientId: CLIENT_ID,
  secretHex: SECRET_HEX,
  audience: 'whatsapp-api',
}

const tokenResponse = (token: string, expiresIn = 300) => ({
  ok: true,
  status: 200,
  json: async () => ({
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: 'messages:send:text',
  }),
})

const errorResponse = (
  status: number,
  error: string,
  description?: string,
) => ({
  ok: false,
  status,
  json: async () => ({ error, error_description: description }),
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  // Only the clock is faked: the provider measures expiry with Date.now().
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (seconds: number) =>
  vi.setSystemTime(Date.now() + seconds * 1000)

describe('the request to the token endpoint', () => {
  it('posts audience and scope, signed with HMAC that the real verifier accepts', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok-1'))
    const provider = createServiceTokenProvider({
      ...config,
      scope: 'messages:send:text',
    })

    const token = await provider.getToken()

    expect(token).toBe('tok-1')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://auth.test/api/v1/internal/token')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      audience: 'whatsapp-api',
      scope: 'messages:send:text',
    })
    const verified = await verifyS2SRequest(
      new Request(url, {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      }),
      { secretStore: async (id) => (id === CLIENT_ID ? SECRET_HEX : null) },
    )
    expect(verified).toEqual({ ok: true, data: { clientId: CLIENT_ID } })
  })

  it('signs the final pathname when authUrl carries a path prefix', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok-1'))

    await createServiceTokenProvider({
      ...config,
      authUrl: 'https://auth.test/auth/',
    }).getToken()

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://auth.test/auth/api/v1/internal/token')
    const verified = await verifyS2SRequest(
      new Request(url, {
        method: 'POST',
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      }),
      { secretStore: async () => SECRET_HEX },
    )
    expect(verified.ok).toBe(true)
  })

  it('omits scope from the body when none was configured', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok-1'))

    await createServiceTokenProvider(config).getToken()

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      audience: 'whatsapp-api',
    })
  })

  it('rejects a non-loopback http authUrl when created', () => {
    expect(() =>
      createServiceTokenProvider({ ...config, authUrl: 'http://auth.example' }),
    ).toThrow(/ServiceTokenProviderConfig\.authUrl/)
  })
})

describe('caching and renewal', () => {
  it('serves the cached token without another request', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok-1'))
    const provider = createServiceTokenProvider(config)

    const first = await provider.getToken()
    advance(100)
    const second = await provider.getToken()

    expect([first, second]).toEqual(['tok-1', 'tok-1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renews 30 seconds before the expires_in deadline, not before', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-1', 300))
      .mockResolvedValueOnce(tokenResponse('tok-2', 300))
    const provider = createServiceTokenProvider(config)
    await provider.getToken()

    advance(269)
    expect(await provider.getToken()).toBe('tok-1')
    advance(2) // 271 s: inside the 30 s margin
    expect(await provider.getToken()).toBe('tok-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('measures expiry from expires_in, whatever the token itself says', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('short', 60))
      .mockResolvedValueOnce(tokenResponse('next', 60))
    const provider = createServiceTokenProvider(config)
    await provider.getToken()

    advance(29)
    expect(await provider.getToken()).toBe('short')
    advance(2) // 31 s of a 60 s token: 30 s margin reached
    expect(await provider.getToken()).toBe('next')
  })

  it('invalidate() discards the cached token', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(tokenResponse('tok-2'))
    const provider = createServiceTokenProvider(config)
    await provider.getToken()

    provider.invalidate()

    expect(await provider.getToken()).toBe('tok-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('de-duplication of simultaneous requests', () => {
  it('makes ONE request for concurrent getToken() calls with an empty cache', async () => {
    let release!: () => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(tokenResponse('tok-1'))
        }),
    )
    const provider = createServiceTokenProvider(config)

    const pending = [1, 2, 3, 4, 5].map(() => provider.getToken())
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    release()

    expect(await Promise.all(pending)).toEqual(Array(5).fill('tok-1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one request when the cached token is due for renewal', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1', 300))
    const provider = createServiceTokenProvider(config)
    await provider.getToken()
    advance(280)
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2', 300))

    const tokens = await Promise.all([provider.getToken(), provider.getToken()])

    expect(tokens).toEqual(['tok-2', 'tok-2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidate(rejected) never discards a request already in flight', async () => {
    const releases: Array<() => void> = []
    let n = 0
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          const token = `tok-${++n}`
          releases.push(() => resolve(tokenResponse(token)))
        }),
    )
    const provider = createServiceTokenProvider(config)
    const first = provider.getToken()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // A 401 for an older token arrives while the renewal is already in flight.
    provider.invalidate('tok-old')
    const second = provider.getToken()
    releases[0]!()

    expect(await first).toBe('tok-1')
    expect(await second).toBe('tok-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// Waits until `fetch` has been called `n` times. The HMAC signing before the fetch is real async
// work (thread pool), so a fixed number of event loop turns is not enough under load. It yields
// with `setImmediate` (not faked) and never touches the fake clock (`vi.waitFor` would advance it).
const fetchCalled = async (n: number) => {
  const deadline = performance.now() + 5_000
  while (fetchMock.mock.calls.length < n) {
    if (performance.now() > deadline)
      throw new Error(`fetch not called ${n} times`)
    await new Promise((r) => setImmediate(r))
  }
}

describe('an orphaned in-flight request (Workers cancel it when its request ends)', () => {
  it('a joiner stops waiting after one request duration and makes its own request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    // First fetch never settles (its request ended); the second answers normally.
    fetchMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(tokenResponse('tok-own'))
    const provider = createServiceTokenProvider(config)
    void provider.getToken() // the initiator, never awaited

    const joiner = provider.getToken()
    await fetchCalled(1)
    await vi.advanceTimersByTimeAsync(10_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)

    expect(await joiner).toBe('tok-own')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a joiner that gets its answer in time never makes a second request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let release!: () => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(tokenResponse('tok-1'))
        }),
    )
    const provider = createServiceTokenProvider(config)
    void provider.getToken()
    const joiner = provider.getToken()
    await fetchCalled(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()

    expect(await joiner).toBe('tok-1')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('invalidate(rejectedToken)', () => {
  it('discards the cached token only when it is the rejected one', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(tokenResponse('tok-2'))
    const provider = createServiceTokenProvider(config)
    await provider.getToken()

    provider.invalidate('some-other-token')
    expect(await provider.getToken()).toBe('tok-1')

    provider.invalidate('tok-1')
    expect(await provider.getToken()).toBe('tok-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('configuration is validated when the provider is created', () => {
  it.each([
    [{ audience: 'whatsapp-panel' }, /audiencia de servicio/],
    [{ audience: 'whatsapp-api', scope: 'users:read' }, /no es un permiso/],
    [{ audience: 'auth-api', scope: 'admin' }, /no es un permiso/],
    [{ secretHex: 'not-hex' }, /secretHex/],
    [{ secretHex: 'abc' }, /secretHex/],
  ])('rejects %j', (over, message) => {
    expect(() => createServiceTokenProvider({ ...config, ...over })).toThrow(
      message,
    )
  })

  it('accepts several permissions of the audience', () => {
    expect(() =>
      createServiceTokenProvider({
        ...config,
        scope: 'messages:send:text messages:send:media',
      }),
    ).not.toThrow()
  })
})

describe('failures', () => {
  it('rejects with the RFC 6749 error and does not cache the failure', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(401, 'invalid_client', 'bad signature'),
      )
      .mockResolvedValueOnce(tokenResponse('tok-1'))
    const provider = createServiceTokenProvider(config)

    const failure = await provider.getToken().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ServiceTokenRequestError)
    expect(failure).toMatchObject({
      code: 'invalid_client',
      status: 401,
      message: 'bad signature',
    })

    expect(await provider.getToken()).toBe('tok-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    [400, 'invalid_target'],
    [400, 'invalid_scope'],
    [503, 'temporarily_unavailable'],
  ])('surfaces %i %s', async (status, code) => {
    fetchMock.mockResolvedValue(errorResponse(status, code))

    await expect(
      createServiceTokenProvider(config).getToken(),
    ).rejects.toMatchObject({ code, status })
  })

  it('rejects a 200 without a usable token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: '', expires_in: 300 }),
    })

    await expect(
      createServiceTokenProvider(config).getToken(),
    ).rejects.toBeInstanceOf(ServiceTokenRequestError)
  })

  it('rejects a 200 whose expires_in is not positive', async () => {
    fetchMock.mockResolvedValue(tokenResponse('tok', 0))

    await expect(
      createServiceTokenProvider(config).getToken(),
    ).rejects.toBeInstanceOf(ServiceTokenRequestError)
  })

  it('maps a bare 429 to temporarily_unavailable and keeps Retry-After', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '7' }),
      json: async () => null,
    })

    await expect(
      createServiceTokenProvider(config).getToken(),
    ).rejects.toMatchObject({
      code: 'temporarily_unavailable',
      status: 429,
      retryAfterSeconds: 7,
    })
  })

  it.each([
    ['no Retry-After header', new Headers()],
    ['an empty Retry-After', new Headers({ 'retry-after': '' })],
    ['a non numeric Retry-After', new Headers({ 'retry-after': 'soon' })],
  ])('leaves retryAfterSeconds undefined with %s', async (_n, headers) => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers,
      json: async () => null,
    })

    const err = await createServiceTokenProvider(config)
      .getToken()
      .catch((e: unknown) => e)

    expect(err).toMatchObject({ code: 'temporarily_unavailable', status: 429 })
    expect(
      (err as { retryAfterSeconds?: number }).retryAfterSeconds,
    ).toBeUndefined()
  })

  it('lets a network failure through as a plain error', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))

    await expect(createServiceTokenProvider(config).getToken()).rejects.toThrow(
      'socket hang up',
    )
  })
})

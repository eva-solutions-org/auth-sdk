/**
 * Forwarding in the auto-refresh (evaAuth, verifyRequest), every createHttpClient method with
 * extra headers, and the cookie policy of evaAuth when the refresh fails (only a definitive
 * rejection clears them). Real http-client and cookies; only fetch and the JWT check are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import {
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
} from '@eva_solutions/auth-contracts'
import { createHttpClient } from '../src/http-client'
import { evaAuth } from '../src/hono/middleware'
import { verifyRequest } from '../src/generic/verify'
import { verifyAccessToken } from '../src/jwt'
import { markTransientVerifyFailure } from '../src/verify-failure'
import { evaAuthRoutes } from '../src/hono/auth-routes'
import { createAuthServiceResponse, createTokenPair } from './helpers/fixtures'

vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
  getCookieDomain: () => undefined,
  getProduct: () => 'whatsapp-panel',
}))
vi.mock('../src/jwt', () => ({ verifyAccessToken: vi.fn() }))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const IP = '203.0.113.7'
const TOKEN = 'service-token-secret'
const COOKIE = 'eva_whatsapp-panel_refresh_token=r1'

const forwarding = {
  getClientIp: () => IP,
  getServiceToken: async () => TOKEN,
}

const sentHeaders = (): Record<string, string> =>
  (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>

beforeEach(() => {
  mockFetch.mockReset()
  vi.mocked(verifyAccessToken).mockReset()
})

const refreshOk = () => {
  mockFetch.mockResolvedValueOnce(
    createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
  )
  vi.mocked(verifyAccessToken).mockResolvedValueOnce({
    ok: true,
    data: { id: 'u1', sessionId: 's1' },
  } as never)
}

type H = Record<string, string> | undefined

describe('createHttpClient extra headers', () => {
  const X = { 'x-test': '1' }
  const c = createHttpClient()
  const call: Record<string, (h?: H) => Promise<unknown>> = {
    getCode: (h) => c.getCode({ phone: '5491155551234' }, h),
    refresh: (h) => c.refresh({ refreshToken: 'r' }, h),
    logout: (h) => c.logout({ refreshToken: 'r' }, h),
    deleteAllSessions: (h) => c.deleteAllSessions({ refreshToken: 'r' }, h),
    getUser: (h) => c.getUser({ accessToken: 'a' }, h),
    updateUser: (h) => c.updateUser({ accessToken: 'a', data: {} }, h),
    deleteUser: (h) => c.deleteUser({ accessToken: 'a' }, h),
    getUserEmpresas: (h) => c.getUserEmpresas({ accessToken: 'a' }, h),
    setActiveEmpresa: (h) =>
      c.setActiveEmpresa({ accessToken: 'a', empresaId: null }, h),
    getDirectorio: (h) => c.getDirectorio({ accessToken: 'a' }, h),
    getSessions: (h) => c.getSessions({ accessToken: 'a' }, h),
    deleteSession: (h) =>
      c.deleteSession({ accessToken: 'a', sessionId: 's1' }, h),
  }

  it.each(Object.keys(call))('%s sends the extra headers', async (name) => {
    mockFetch.mockResolvedValue(createAuthServiceResponse({}))
    await call[name]!(X)
    expect(sentHeaders()['x-test']).toBe('1')
  })

  it.each(Object.keys(call))(
    '%s changes nothing without them',
    async (name) => {
      mockFetch.mockResolvedValue(createAuthServiceResponse({}))
      await call[name]!()
      expect(sentHeaders()['x-test']).toBeUndefined()
    },
  )

  it('extra headers cannot replace the user credential', async () => {
    mockFetch.mockResolvedValue(createAuthServiceResponse({}))
    await call.getUser!({ authorization: 'Bearer evil' })
    expect(sentHeaders().authorization).toBe('Bearer a')
  })
})

describe('evaAuth auto-refresh', () => {
  const app = (opts = {}) => {
    const a = new Hono()
    a.use('/*', evaAuth(opts))
    a.get('/t', (ctx) => ctx.json({ ok: true }))
    return a
  }

  it('forwards the IP in the refresh', async () => {
    refreshOk()
    const res = await app({ clientIpForwarding: forwarding }).request('/t', {
      headers: { cookie: COOKIE },
    })
    expect(res.status).toBe(200)
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBe(TOKEN)
    expect(sentHeaders()[CLIENT_IP_HEADER]).toBe(IP)
  })

  it('refreshes without headers when the token provider fails', async () => {
    refreshOk()
    const res = await app({
      clientIpForwarding: {
        ...forwarding,
        getServiceToken: async () => {
          throw new Error('down')
        },
      },
    }).request('/t', { headers: { cookie: COOKIE } })
    expect(res.status).toBe(200)
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBeUndefined()
  })

  it('sends no forwarding headers without the option', async () => {
    refreshOk()
    await app().request('/t', { headers: { cookie: COOKIE } })
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBeUndefined()
  })

  const apiError = (status: number) =>
    new Response(JSON.stringify({ error: { code: 'x', message: 'm' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  it.each([400, 401, 403, 404, 409])(
    'definitive rejection %i: 401 and the cookies are cleared',
    async (status) => {
      mockFetch.mockResolvedValueOnce(apiError(status))
      const res = await app().request('/t', { headers: { cookie: COOKIE } })
      expect(res.status).toBe(401)
      expect(res.headers.getSetCookie().join(';')).toContain('Max-Age=0')
    },
  )

  it.each([408, 429, 500, 502, 503])(
    'transient %i: 503 and the cookies are kept',
    async (status) => {
      mockFetch.mockResolvedValueOnce(apiError(status))
      const res = await app().request('/t', { headers: { cookie: COOKIE } })
      expect(res.status).toBe(503)
      expect(res.headers.getSetCookie()).toEqual([])
      expect(await res.json()).toMatchObject({
        error: { code: 'service_unavailable' },
      })
    },
  )

  it('network failure: 503 and the cookies are kept', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))
    const res = await app().request('/t', { headers: { cookie: COOKIE } })
    expect(res.status).toBe(503)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('verifyRequest auto-refresh', () => {
  const req = () =>
    new Request('http://localhost/x', { headers: { cookie: COOKIE } })

  it('forwards the IP in the refresh, reading it from the Request', async () => {
    refreshOk()
    const getClientIp = vi.fn((r: Request) => r.headers.get('cf-connecting-ip'))
    const request = new Request('http://localhost/x', {
      headers: { cookie: COOKIE, 'cf-connecting-ip': IP },
    })
    const result = await verifyRequest(request, {
      clientIpForwarding: { ...forwarding, getClientIp },
    })
    expect(result.ok).toBe(true)
    expect(getClientIp).toHaveBeenCalledWith(request)
    expect(sentHeaders()[CLIENT_IP_HEADER]).toBe(IP)
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBe(TOKEN)
  })

  it('keeps the 30 s back-off across calls with the same option object', async () => {
    const getServiceToken = vi.fn(async (): Promise<string> => {
      throw new Error('down')
    })
    const clientIpForwarding = { ...forwarding, getServiceToken }
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}))
      await verifyRequest(req(), { clientIpForwarding })
    }
    expect(getServiceToken).toHaveBeenCalledTimes(1)
  })

  it('has no cookie-clearing defect: a failed refresh is returned as is, no newCookies', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))
    const result = await verifyRequest(req())
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'sdk', reason: 'network' },
    })
    expect('newCookies' in result).toBe(false)
  })
})

describe('shared state per options object', () => {
  it('one failing token provider is asked once across routes, evaAuth and verifyRequest', async () => {
    const getServiceToken = vi.fn(async (): Promise<string> => {
      throw new Error('down')
    })
    const clientIpForwarding = { ...forwarding, getServiceToken }
    mockFetch.mockImplementation(async () => createAuthServiceResponse({}))

    await evaAuthRoutes({ clientIpForwarding }).request('/get-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '5491155551234' }),
    })
    const a = new Hono()
    a.use('/*', evaAuth({ clientIpForwarding }))
    a.get('/t', (ctx) => ctx.json({ ok: true }))
    await a.request('/t', { headers: { cookie: COOKIE } })
    await verifyRequest(
      new Request('http://localhost/x', { headers: { cookie: COOKIE } }),
      { clientIpForwarding },
    )

    expect(getServiceToken).toHaveBeenCalledTimes(1)
  })
})

describe('evaAuth: refresh answered 200 but the new token cannot be verified', () => {
  const app = () => {
    const a = new Hono()
    a.use('/*', evaAuth())
    a.get('/t', (ctx) => ctx.json({ ok: true }))
    return a
  }
  const failure = (transient: boolean) => {
    const error = {
      kind: 'sdk',
      reason: 'token_invalid',
      message: 'x',
      status: 401,
    }
    return {
      ok: false,
      error: transient ? markTransientVerifyFailure(error) : error,
    }
  }

  it('transient failure (JWKS unreachable): writes the rotated cookies, keeps nothing cleared, 503', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(failure(true) as never)
    const res = await app().request('/t', { headers: { cookie: COOKIE } })
    expect(res.status).toBe(503)
    const cookies = res.headers.getSetCookie().join(';')
    expect(cookies).toContain(createTokenPair().refreshToken)
    expect(cookies).not.toContain('Max-Age=0')
  })

  it('a really invalid new token still clears the cookies and answers 401', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(failure(false) as never)
    const res = await app().request('/t', { headers: { cookie: COOKIE } })
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie().join(';')).toContain('Max-Age=0')
  })
})

describe('Retry-After', () => {
  const unavailable = (retryAfter?: string) =>
    new Response(JSON.stringify({ error: { code: 'x', message: 'm' } }), {
      status: 503,
      headers: {
        'content-type': 'application/json',
        ...(retryAfter !== undefined && { 'retry-after': retryAfter }),
      },
    })
  const app = () => {
    const a = new Hono()
    a.use('/*', evaAuth())
    a.get('/t', (ctx) => ctx.json({ ok: true }))
    return a
  }

  it('the http-client keeps a numeric Retry-After on the error', async () => {
    mockFetch.mockResolvedValueOnce(unavailable('7'))
    const result = await createHttpClient().refresh({ refreshToken: 'r' })
    expect(result).toMatchObject({ ok: false, error: { retryAfterSeconds: 7 } })
  })

  it('evaAuth propagates Retry-After on its 503', async () => {
    mockFetch.mockResolvedValueOnce(unavailable('7'))
    const res = await app().request('/t', { headers: { cookie: COOKIE } })
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('7')
  })

  it.each([undefined, 'soon', ''])(
    'no usable Retry-After (%j): none is sent',
    async (value) => {
      mockFetch.mockResolvedValueOnce(unavailable(value))
      const res = await app().request('/t', { headers: { cookie: COOKIE } })
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBeNull()
    },
  )
})

describe('transient failure of the first access-token check', () => {
  const transient = () => ({
    ok: false,
    error: markTransientVerifyFailure({
      kind: 'sdk',
      reason: 'token_invalid',
      message: 'x',
      status: 401,
    }),
  })
  const BOTH =
    'eva_whatsapp-panel_access_token=a; eva_whatsapp-panel_refresh_token=r1'

  it('evaAuth answers 503 without refreshing and without touching the cookies', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(transient() as never)
    const a = new Hono()
    a.use('/*', evaAuth())
    a.get('/t', (ctx) => ctx.json({ ok: true }))
    const res = await a.request('/t', { headers: { cookie: BOTH } })
    expect(res.status).toBe(503)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('verifyRequest returns 503 without refreshing', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(transient() as never)
    const result = await verifyRequest(
      new Request('http://localhost/x', { headers: { cookie: BOTH } }),
    )
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { status: 503 } })
    expect('newCookies' in result).toBe(false)
  })

  it('a really invalid access token still refreshes', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'token_invalid',
        message: 'x',
        status: 401,
      },
    } as never)
    refreshOk()
    const result = await verifyRequest(
      new Request('http://localhost/x', { headers: { cookie: BOTH } }),
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })
})

describe('verifyRequest: refresh answered 200 but the new token cannot be verified', () => {
  const req = () =>
    new Request('http://localhost/x', { headers: { cookie: COOKIE } })
  const fail = (transient: boolean) => {
    const error = {
      kind: 'sdk',
      reason: 'token_invalid',
      message: 'x',
      status: 401,
    }
    return {
      ok: false,
      error: transient ? markTransientVerifyFailure(error) : error,
    }
  }

  it('transient: keeps the rotated tokens in newCookies and reports 503', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(fail(true) as never)
    const result = await verifyRequest(req())
    expect(result).toMatchObject({ ok: false, error: { status: 503 } })
    const cookies = (result as { newCookies?: string[] }).newCookies ?? []
    expect(cookies.join(';')).toContain(createTokenPair().refreshToken)
  })

  it('really invalid: the current verify_failed result, no cookies', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )
    vi.mocked(verifyAccessToken).mockResolvedValueOnce(fail(false) as never)
    const result = await verifyRequest(req())
    expect(result).toMatchObject({
      ok: false,
      error: { reason: 'verify_failed', status: 401 },
    })
    expect('newCookies' in result).toBe(false)
  })
})

/**
 * `configureEvaAuth({ serviceCredentials })` on the server entries: the client IP forwarding works
 * by default in every route, `evaAuth` and `verifyRequest`, sharing one state. Real modules; only
 * `fetch` (and the JWT check) are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET_HEX = 'deadbeef'.repeat(8)
const CREDS = { clientId: 'ventas-backend', secretHex: SECRET_HEX }
const IP = '203.0.113.7'
const TOKEN_URL = 'https://auth.test/api/v1/internal/token'
const PHONE = { phone: '5491155551234' }

type Call = { url: string; init: RequestInit }
let calls: Call[]
let tokenAnswer: () => Response | Promise<Response>

const jsonResponse = (status: number, body: unknown, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const tokenOk = (token = 'svc-token-1') =>
  jsonResponse(200, {
    access_token: token,
    token_type: 'Bearer',
    expires_in: 300,
    scope: 'login:client-ip',
  })

beforeEach(() => {
  vi.resetModules()
  // The default getClientIp (cf-connecting-ip) is only valid in Cloudflare Workers.
  vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
  calls = []
  tokenAnswer = () => tokenOk()
  globalThis.fetch = vi.fn(async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url) === TOKEN_URL) return tokenAnswer()
    return jsonResponse(200, { data: { message: 'ok', challengeId: 'c1' } })
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.doUnmock('../src/jwt')
})

const tokenCalls = () => calls.filter((c) => c.url === TOKEN_URL)
const apiCalls = () => calls.filter((c) => c.url !== TOKEN_URL)
const apiHeaders = (i = 0) =>
  apiCalls()[i]!.init.headers as Record<string, string>

const load = async () => {
  const sdk = await import('../src/index')
  const hono = await import('../src/hono')
  return { sdk, hono }
}

const configure = async (extra: Record<string, unknown> = {}) => {
  const { sdk, hono } = await load()
  sdk.configureEvaAuth({
    authUrl: 'https://auth.test',
    product: 'whatsapp-panel',
    serviceCredentials: CREDS,
    ...extra,
  } as never)
  return { sdk, hono }
}

const getCode = (
  app: { request: Function },
  headers: Record<string, string> = {},
) =>
  app.request('/get-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(PHONE),
  })

describe('serviceCredentials is mandatory on the server entries', () => {
  it('throws a clear error when it is undefined, without values, and changes nothing', async () => {
    const { sdk } = await load()
    let message = ''
    try {
      sdk.configureEvaAuth({
        authUrl: 'https://auth.test',
        product: 'whatsapp-panel',
      } as never)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('serviceCredentials')
    expect(message).toContain('obligatorio')
    expect(message).not.toContain('auth.test')
    expect(() => sdk.getAuthUrl()).toThrow() // atomic: nothing was configured
  })

  it.each([
    [{ clientId: '', secretHex: SECRET_HEX }],
    [{ clientId: 'x', secretHex: 'not-hex-zz' }],
    [{ clientId: 'x' }],
    ['a-string'],
  ])(
    'rejects invalid credentials %j without echoing the secret',
    async (bad) => {
      const { sdk } = await load()
      let message = ''
      try {
        sdk.configureEvaAuth({
          authUrl: 'https://auth.test',
          serviceCredentials: bad,
        } as never)
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toContain('serviceCredentials')
      expect(message).not.toContain('not-hex-zz')
    },
  )

  it('null is the explicit discard: no default forwarding', async () => {
    const { sdk, hono } = await configure({ serviceCredentials: null })
    const res = await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(res.status).toBe(200)
    expect(tokenCalls()).toHaveLength(0)
    expect(apiHeaders()['x-eva-service-token']).toBeUndefined()
    expect(
      await sdk.getConfiguredClientIpForwarder()(
        new Request('http://x', { headers: { 'cf-connecting-ip': IP } }),
      ),
    ).toBeUndefined()
  })
})

describe('forwarding by default', () => {
  it('evaAuthRoutes forwards cf-connecting-ip with a token asked for auth-api / login:client-ip', async () => {
    const { hono } = await configure()
    const res = await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(res.status).toBe(200)
    expect(tokenCalls()).toHaveLength(1)
    expect(JSON.parse(tokenCalls()[0]!.init.body as string)).toEqual({
      audience: 'auth-api',
      scope: 'login:client-ip',
    })
    expect(apiHeaders()['x-eva-service-token']).toBe('svc-token-1')
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
  })

  it('evaAuthOpenAPIRoutes forwards too', async () => {
    const { sdk } = await configure()
    const { evaAuthOpenAPIRoutes } = await import('../src/hono-openapi')
    const res = await getCode(evaAuthOpenAPIRoutes(), {
      'cf-connecting-ip': IP,
    })
    expect(res.status).toBe(200)
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
    void sdk
  })

  it('never reads x-forwarded-for', async () => {
    const { hono } = await configure()
    await getCode(hono.evaAuthRoutes(), { 'x-forwarded-for': '1.2.3.4' })
    expect(tokenCalls()).toHaveLength(0)
    expect(apiHeaders()['x-eva-client-ip']).toBeUndefined()
  })

  it('an explicit clientIpForwarding wins over the configured one', async () => {
    const { hono } = await configure()
    const getServiceToken = vi.fn(async () => 'explicit-token')
    await getCode(
      hono.evaAuthRoutes({
        clientIpForwarding: {
          getClientIp: () => '198.51.100.9',
          getServiceToken,
        },
      }),
      { 'cf-connecting-ip': IP },
    )
    expect(tokenCalls()).toHaveLength(0)
    expect(apiHeaders()['x-eva-service-token']).toBe('explicit-token')
    expect(apiHeaders()['x-eva-client-ip']).toBe('198.51.100.9')
  })

  it('a custom getClientIp (Node behind a proxy) replaces the default', async () => {
    const { hono } = await configure({
      getClientIp: (c: { req: { header(n: string): string | undefined } }) =>
        c.req.header('x-real-ip'),
    })
    await getCode(hono.evaAuthRoutes(), {
      'x-real-ip': '198.51.100.9',
      'cf-connecting-ip': IP,
    })
    expect(apiHeaders()['x-eva-client-ip']).toBe('198.51.100.9')
  })

  it('verifyRequest refreshes with the default forwarding', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'token_invalid',
          message: 'x',
          status: 401,
        },
      })
      .mockResolvedValue({
        ok: true,
        data: { id: 'u1', sessionId: 's1', clientId: 'whatsapp-panel' },
      })
    vi.doMock('../src/jwt', () => ({ verifyAccessToken: verify }))
    await configure()
    globalThis.fetch = vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url) === TOKEN_URL) return tokenOk()
      return new Response(JSON.stringify({ data: { user: { id: 'u1' } } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-eva-new-access-token': 'a2',
          'x-eva-new-refresh-token': 'r2',
        },
      })
    }) as unknown as typeof fetch
    const { verifyRequest } = await import('../src/generic/verify')
    const cookie =
      'eva_whatsapp-panel_access_token=a; eva_whatsapp-panel_refresh_token=r'
    const result = await verifyRequest(
      new Request('http://localhost/x', {
        headers: { cookie, 'cf-connecting-ip': IP },
      }),
    )
    expect(result.ok).toBe(true)
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
    expect(apiHeaders()['x-eva-service-token']).toBe('svc-token-1')
  })

  it('evaAuth refreshes with the default forwarding', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'token_invalid',
          message: 'x',
          status: 401,
        },
      })
      .mockResolvedValue({
        ok: true,
        data: { id: 'u1', sessionId: 's1', clientId: 'whatsapp-panel' },
      })
    vi.doMock('../src/jwt', () => ({ verifyAccessToken: verify }))
    const { hono } = await configure()
    globalThis.fetch = vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url) === TOKEN_URL) return tokenOk()
      return new Response(JSON.stringify({ data: { user: { id: 'u1' } } }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-eva-new-access-token': 'a2',
          'x-eva-new-refresh-token': 'r2',
        },
      })
    }) as unknown as typeof fetch
    const { Hono } = await import('hono')
    const app = new Hono()
    app.use('/*', hono.evaAuth())
    app.get('/t', (c) => c.json({ ok: true }))
    const res = await app.request('/t', {
      headers: {
        cookie:
          'eva_whatsapp-panel_access_token=a; eva_whatsapp-panel_refresh_token=r',
        'cf-connecting-ip': IP,
      },
    })
    expect(res.status).toBe(200)
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
    expect(apiHeaders()['x-eva-service-token']).toBe('svc-token-1')
  })
})

describe('failures and shared state', () => {
  it('one failing token endpoint is asked once across routes and a direct forwarder', async () => {
    tokenAnswer = () => jsonResponse(503, { error: 'temporarily_unavailable' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sdk, hono } = await configure()
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    const headers = await sdk.getConfiguredClientIpForwarder()(
      new Request('http://x', { headers: { 'cf-connecting-ip': IP } }),
    )
    expect(headers).toBeUndefined()
    expect(tokenCalls()).toHaveLength(1)
    expect(apiHeaders()['x-eva-service-token']).toBeUndefined() // the login still went through
  })

  it('without onClientIpForwardingError it warns with code and status, never the token or the IP', async () => {
    tokenAnswer = () => jsonResponse(503, { error: 'temporarily_unavailable' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { hono } = await configure()
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('service_token_failed')
    expect(logged).toContain('503')
    expect(logged).not.toContain(IP)
    expect(logged).not.toContain(SECRET_HEX)
  })

  it('a custom onClientIpForwardingError replaces the warning', async () => {
    tokenAnswer = () => jsonResponse(503, { error: 'temporarily_unavailable' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onClientIpForwardingError = vi.fn()
    const { hono } = await configure({ onClientIpForwardingError })
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(onClientIpForwardingError).toHaveBeenCalledWith({
      code: 'service_token_failed',
      status: 503,
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('reconfiguring with the same credentials keeps the object and the back-off', async () => {
    tokenAnswer = () => jsonResponse(503, { error: 'temporarily_unavailable' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sdk, hono } = await configure()
    const before = sdk.getConfiguredClientIpForwarder()
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(tokenCalls()).toHaveLength(1)

    sdk.configureEvaAuth({
      authUrl: 'https://auth.test',
      serviceCredentials: { ...CREDS },
    } as never)
    expect(sdk.getConfiguredClientIpForwarder()).toBe(before)
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(tokenCalls()).toHaveLength(1) // back-off not reset
  })

  it('other credentials get a new object and a fresh state', async () => {
    tokenAnswer = () => jsonResponse(503, { error: 'temporarily_unavailable' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sdk, hono } = await configure()
    const before = sdk.getConfiguredClientIpForwarder()
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })

    sdk.configureEvaAuth({
      authUrl: 'https://auth.test',
      serviceCredentials: { clientId: 'other', secretHex: 'ab'.repeat(32) },
    } as never)
    expect(sdk.getConfiguredClientIpForwarder()).not.toBe(before)
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(tokenCalls()).toHaveLength(2)
  })

  it('createHttpClient callers get the headers from getConfiguredClientIpForwarder()', async () => {
    const { sdk } = await configure()
    const request = new Request('http://x', {
      headers: { 'cf-connecting-ip': IP },
    })
    const headers = await sdk.getConfiguredClientIpForwarder()(request)
    expect(headers).toEqual({
      'x-eva-service-token': 'svc-token-1',
      'x-eva-client-ip': IP,
    })
    await sdk.createHttpClient().getUser({ accessToken: 'a' }, headers)
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
  })
})

describe('the react entry', () => {
  it('does not accept serviceCredentials (a secret never goes to the browser)', async () => {
    const react = await import('../src/react/index')
    expect(() =>
      react.configureEvaAuth({
        authUrl: 'https://auth.test',
        serviceCredentials: CREDS,
      } as never),
    ).toThrow(/serviceCredentials/)
    expect(() =>
      react.configureEvaAuth({
        authUrl: 'https://auth.test',
        product: 'whatsapp-panel',
      }),
    ).not.toThrow()
  })
})

describe('the default getClientIp only exists in Cloudflare Workers', () => {
  const asNode = () => vi.stubGlobal('navigator', { userAgent: 'Node.js/22' })

  it('Workers: serviceCredentials without getClientIp uses cf-connecting-ip', async () => {
    const { hono } = await configure()
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(apiHeaders()['x-eva-client-ip']).toBe(IP)
  })

  it('Node without getClientIp throws at configure time, clearly and without values', async () => {
    asNode()
    const { sdk } = await load()
    let message = ''
    try {
      sdk.configureEvaAuth({
        authUrl: 'https://auth.test',
        product: 'whatsapp-panel',
        serviceCredentials: CREDS,
      } as never)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('getClientIp')
    expect(message).toContain('Cloudflare')
    expect(message).not.toContain(SECRET_HEX)
    expect(message).not.toContain('ventas-backend')
    expect(() => sdk.getAuthUrl()).toThrow() // atomic: nothing was configured
  })

  it('Node without any navigator throws too', async () => {
    vi.stubGlobal('navigator', undefined)
    const { sdk } = await load()
    expect(() =>
      sdk.configureEvaAuth({
        authUrl: 'https://auth.test',
        serviceCredentials: CREDS,
      } as never),
    ).toThrow(/getClientIp/)
  })

  it('Node with getClientIp works and forwards what it returns', async () => {
    asNode()
    const { hono } = await configure({
      getClientIp: (c: { req: { header(n: string): string | undefined } }) =>
        c.req.header('x-real-ip'),
    })
    await getCode(hono.evaAuthRoutes(), {
      'x-real-ip': '198.51.100.9',
      'cf-connecting-ip': IP,
    })
    expect(apiHeaders()['x-eva-client-ip']).toBe('198.51.100.9')
  })

  it('Node with null does not throw and forwards nothing', async () => {
    asNode()
    const { hono } = await configure({ serviceCredentials: null })
    await getCode(hono.evaAuthRoutes(), { 'cf-connecting-ip': IP })
    expect(apiHeaders()['x-eva-client-ip']).toBeUndefined()
  })

  it('reconfiguring on Node keeps a previous getClientIp', async () => {
    asNode()
    const { sdk } = await configure({ getClientIp: () => IP })
    expect(() =>
      sdk.configureEvaAuth({
        authUrl: 'https://auth.test',
        serviceCredentials: CREDS,
      } as never),
    ).not.toThrow()
  })
})

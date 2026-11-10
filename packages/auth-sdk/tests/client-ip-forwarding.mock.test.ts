/**
 * `clientIpForwarding`: the BFF forwards the real client IP to Auth on get-code and login only,
 * with a service Bearer token. Real http-client and BFF routes, only `fetch` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
} from '@eva_solutions/auth-contracts'
import { createHttpClient } from '../src/http-client'
import { evaAuthRoutes } from '../src/hono/auth-routes'
import { evaAuthOpenAPIRoutes } from '../src/hono-openapi'
import {
  createAuthServiceResponse,
  createDeviceInfo,
  createTokenPair,
} from './helpers/fixtures'

vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
  getCookieDomain: () => undefined,
  getProduct: () => 'whatsapp-panel',
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const CHALLENGE_ID = '9f86d081884c7d659a2feaa0c55ad015'
const IP = '203.0.113.7'
const TOKEN = 'service-token-secret'

const sentHeaders = (): Record<string, string> =>
  (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>

const post = (
  app: {
    request: (path: string, init: RequestInit) => Response | Promise<Response>
  },
  path: string,
  body: Record<string, unknown>,
) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
    },
    body: JSON.stringify(body),
  })

const getCodeBody = { phone: '5491155551234' }
const loginBody = { ...getCodeBody, code: 'A1B2C3', challengeId: CHALLENGE_ID }

const okGetCode = () =>
  createAuthServiceResponse({ message: 'ok', challengeId: CHALLENGE_ID })
const okLogin = () =>
  createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair())

describe('http-client extra headers', () => {
  it('getCode and login merge the extra headers', async () => {
    mockFetch.mockResolvedValueOnce(okGetCode())
    await createHttpClient().getCode(getCodeBody, { 'x-test': '1' })
    expect(sentHeaders()['x-test']).toBe('1')
    expect(sentHeaders()['content-type']).toBe('application/json')

    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce(okLogin())
    await createHttpClient().login(
      { ...loginBody, ...createDeviceInfo() },
      { 'x-test': '2' },
    )
    expect(sentHeaders()['x-test']).toBe('2')
  })

  it('sends only the content type when no extra headers are given', async () => {
    mockFetch.mockResolvedValueOnce(okGetCode())
    await createHttpClient().getCode(getCodeBody)
    expect(sentHeaders()).toEqual({ 'content-type': 'application/json' })
  })
})

describe.each([
  ['evaAuthRoutes', evaAuthRoutes],
  ['evaAuthOpenAPIRoutes', evaAuthOpenAPIRoutes],
] as const)('%s clientIpForwarding', (_name, build) => {
  const forwarding = (
    over: Partial<{
      getClientIp: () => string | null | undefined
      getServiceToken: () => Promise<string>
    }> = {},
  ) => ({
    getClientIp: () => IP,
    getServiceToken: async () => TOKEN,
    ...over,
  })

  const cases = [
    ['/get-code', getCodeBody, okGetCode],
    ['/login', loginBody, okLogin],
  ] as const

  describe.each(cases)('%s', (path, body, ok) => {
    it('sends Authorization and the client IP together', async () => {
      mockFetch.mockResolvedValueOnce(ok())
      const res = await post(
        build({ clientIpForwarding: forwarding() }),
        path,
        body,
      )
      expect(res.status).toBe(200)
      expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBe(TOKEN)
      expect(sentHeaders().authorization).toBeUndefined()
      expect(sentHeaders()[CLIENT_IP_HEADER]).toBe(IP)
    })

    it.each([null, undefined, ''])(
      'sends neither header when the IP is %j (token not requested)',
      async (ip) => {
        const getServiceToken = vi.fn(async () => TOKEN)
        mockFetch.mockResolvedValueOnce(ok())
        await post(
          build({
            clientIpForwarding: forwarding({
              getClientIp: () => ip,
              getServiceToken,
            }),
          }),
          path,
          body,
        )
        expect(sentHeaders().authorization).toBeUndefined()
        expect(sentHeaders()[CLIENT_IP_HEADER]).toBeUndefined()
        expect(getServiceToken).not.toHaveBeenCalled()
      },
    )

    it('continues without headers when getServiceToken throws, leaking nothing', async () => {
      mockFetch.mockResolvedValueOnce(ok())
      const spies = [
        vi.spyOn(console, 'error').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
        vi.spyOn(console, 'log').mockImplementation(() => {}),
      ]
      const res = await post(
        build({
          clientIpForwarding: forwarding({
            getServiceToken: async () => {
              throw new Error(`boom ${TOKEN} ${IP}`)
            },
          }),
        }),
        path,
        body,
      )
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
      spies.forEach((s) => s.mockRestore())
      expect(res.status).toBe(200)
      expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBeUndefined()
      expect(sentHeaders()[CLIENT_IP_HEADER]).toBeUndefined()
      expect(logged).not.toContain(TOKEN)
      expect(logged).not.toContain(IP)
    })

    it('continues without headers when getClientIp throws', async () => {
      mockFetch.mockResolvedValueOnce(ok())
      const res = await post(
        build({
          clientIpForwarding: forwarding({
            getClientIp: () => {
              throw new Error('no ip')
            },
          }),
        }),
        path,
        body,
      )
      expect(res.status).toBe(200)
      expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBeUndefined()
      expect(sentHeaders()[CLIENT_IP_HEADER]).toBeUndefined()
    })

    it('behaves as before without the option', async () => {
      mockFetch.mockResolvedValueOnce(ok())
      await post(build(), path, body)
      expect(sentHeaders()).toEqual({ 'content-type': 'application/json' })
    })
  })

  it.each([
    ['POST', '/refresh'],
    ['POST', '/logout'],
    ['GET', '/me'],
    ['PATCH', '/me'],
    ['DELETE', '/me'],
    ['GET', '/empresas'],
    ['POST', '/empresa-activa'],
    ['GET', '/sessions'],
    ['DELETE', '/sessions/abc'],
    ['DELETE', '/sessions'],
  ] as const)('forwards both headers on %s %s', async (method, path) => {
    mockFetch.mockResolvedValue(
      createAuthServiceResponse(
        { id: 'u1', user: { id: 'u1' } },
        createTokenPair(),
      ),
    )
    const cookie =
      'eva_whatsapp-panel_access_token=a; eva_whatsapp-panel_refresh_token=r'
    const body =
      path === '/empresa-activa'
        ? { empresaId: '550e8400-e29b-41d4-a716-446655440000' }
        : { name: 'x' }
    await build({ clientIpForwarding: forwarding() }).request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(method === 'POST' || method === 'PATCH'
        ? { body: JSON.stringify(body) }
        : {}),
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBe(TOKEN)
    expect(sentHeaders()[CLIENT_IP_HEADER]).toBe(IP)
  })

  it('the user Authorization is untouched by the forwarding headers', async () => {
    mockFetch.mockResolvedValue(createAuthServiceResponse({ id: 'u1' }))
    await build({ clientIpForwarding: forwarding() }).request('/me', {
      headers: { cookie: 'eva_whatsapp-panel_access_token=a' },
    })
    expect(sentHeaders().authorization).toBe('Bearer a')
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBe(TOKEN)
  })

  it('never lets the token provider fail a session route', async () => {
    mockFetch.mockResolvedValue(createAuthServiceResponse({ id: 'u1' }))
    const res = await build({
      clientIpForwarding: forwarding({
        getServiceToken: async () => {
          throw new Error('down')
        },
      }),
    }).request('/me', {
      headers: { cookie: 'eva_whatsapp-panel_access_token=a' },
    })
    expect(res.status).toBe(200)
    expect(sentHeaders()[SERVICE_TOKEN_HEADER]).toBeUndefined()
    expect(sentHeaders().authorization).toBe('Bearer a')
  })
})

/**
 * The login sends the configured `producto` (never one from the browser), forwards the optional
 * `empresaId`, and the company switch posts to the contract route. Real http-client and BFF routes,
 * only `fetch` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '../src/http-client'
import { evaAuthRoutes } from '../src/hono/auth-routes'
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
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440000'

const sentBody = () =>
  JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string)

describe('http-client login', () => {
  it('sends the configured producto', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )

    await createHttpClient().login({
      phone: '5491155551234',
      code: 'A1B2C3',
      challengeId: CHALLENGE_ID,
      ...createDeviceInfo(),
    })

    expect(sentBody().producto).toBe('whatsapp-panel')
    expect('empresaId' in sentBody()).toBe(false)
  })

  it('forwards empresaId when given', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )

    await createHttpClient().login({
      phone: '5491155551234',
      code: 'A1B2C3',
      challengeId: CHALLENGE_ID,
      empresaId: EMPRESA_ID,
      ...createDeviceInfo(),
    })

    expect(sentBody()).toMatchObject({
      producto: 'whatsapp-panel',
      empresaId: EMPRESA_ID,
    })
  })
})

describe('BFF POST /login', () => {
  const loginRequest = (extra: Record<string, unknown>) =>
    evaAuthRoutes().request('/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
      },
      body: JSON.stringify({
        phone: '5491155551234',
        code: 'A1B2C3',
        challengeId: CHALLENGE_ID,
        ...extra,
      }),
    })

  it('ignores a producto sent by the browser', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )

    const res = await loginRequest({ producto: 'gym-panel' })

    expect(res.status).toBe(200)
    expect(sentBody().producto).toBe('whatsapp-panel')
  })

  it('passes the empresaId chosen in the browser to Auth', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ user: { id: 'u1' } }, createTokenPair()),
    )

    await loginRequest({ empresaId: EMPRESA_ID })

    expect(sentBody().empresaId).toBe(EMPRESA_ID)
  })

  it('does not send producto or empresaId on get-code', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ message: 'ok', challengeId: CHALLENGE_ID }),
    )

    await evaAuthRoutes().request('/get-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: '5491155551234',
        producto: 'gym-panel',
        empresaId: EMPRESA_ID,
      }),
    })

    expect(sentBody()).toEqual({ phone: '5491155551234' })
  })
})

describe('http-client setActiveEmpresa', () => {
  // Real Auth answer: ONLY the access token is re-issued (the refresh token does not rotate).
  const accessOnlyResponse = (data: unknown, accessToken: string) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-eva-new-access-token': accessToken,
      },
    })

  it('posts the empresaId with the access token and returns the re-issued access token', async () => {
    mockFetch.mockResolvedValueOnce(
      accessOnlyResponse({ empresaId: EMPRESA_ID }, 'new-access'),
    )

    const result = await createHttpClient().setActiveEmpresa({
      accessToken: 'old-access',
      empresaId: EMPRESA_ID,
    })

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://auth.test/api/v1/auth/empresa-activa')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer old-access',
    )
    expect(JSON.parse(init.body as string)).toEqual({ empresaId: EMPRESA_ID })
    expect(result).toEqual({
      ok: true,
      data: { empresaId: EMPRESA_ID, accessToken: 'new-access' },
    })
  })

  it('sends null to leave the session without an active company', async () => {
    mockFetch.mockResolvedValueOnce(
      accessOnlyResponse({ empresaId: null }, 'new-access'),
    )

    const result = await createHttpClient().setActiveEmpresa({
      accessToken: 'a',
      empresaId: null,
    })

    expect(sentBody()).toEqual({ empresaId: null })
    expect(result).toMatchObject({
      ok: true,
      data: { accessToken: 'new-access' },
    })
  })
})

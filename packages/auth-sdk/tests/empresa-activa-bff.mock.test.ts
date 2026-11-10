/**
 * BFF POST /empresa-activa in both variants (plain and OpenAPI). Real http-client, cookies and
 * handlers; only `fetch` is mocked, and it answers like the real Auth: ONLY the access token is
 * re-issued (`x-eva-new-access-token`), the refresh token does not rotate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaAuthRoutes } from '../src/hono/auth-routes'
import { evaAuthOpenAPIRoutes } from '../src/hono-openapi'

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

const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440000'
const COOKIE =
  'eva_whatsapp-panel_access_token=old-access; eva_whatsapp-panel_refresh_token=sess:refresh'

const authAnswer = (data: unknown, accessToken?: string) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(accessToken && { 'x-eva-new-access-token': accessToken }),
    },
  })

const authError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: 'denied' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const variants = [
  ['plain', () => evaAuthRoutes()],
  ['openapi', () => evaAuthOpenAPIRoutes()],
] as const

describe.each(variants)('POST /empresa-activa (%s)', (_name, build) => {
  const post = (body: unknown, cookie: string | null = COOKIE) =>
    build().request('/empresa-activa', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie && { cookie }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  it('calls Auth with the session access token and rewrites ONLY the access cookie', async () => {
    mockFetch.mockResolvedValueOnce(
      authAnswer({ empresaId: EMPRESA_ID }, 'new-access'),
    )

    const res = await post({ empresaId: EMPRESA_ID })

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://auth.test/api/v1/auth/empresa-activa')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer old-access',
    )
    expect(JSON.parse(init.body as string)).toEqual({ empresaId: EMPRESA_ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { empresaId: EMPRESA_ID } })
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatch(/^eva_whatsapp-panel_access_token=new-access;/)
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[0]).toContain('Secure')
    expect(cookies[0]).toContain('Max-Age=900')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('accepts null to leave the session without an active company', async () => {
    mockFetch.mockResolvedValueOnce(
      authAnswer({ empresaId: null }, 'new-access'),
    )

    const res = await post({ empresaId: null })

    expect(
      JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string),
    ).toEqual({
      empresaId: null,
    })
    expect(await res.json()).toEqual({ data: { empresaId: null } })
  })

  it('answers 401 without the access cookie and does not call Auth', async () => {
    const res = await post({ empresaId: EMPRESA_ID }, null)

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([{}, { empresaId: '' }, { empresaId: 5 }])(
    'answers 400 for the invalid body %j without calling Auth',
    async (body) => {
      const res = await post(body)

      expect(res.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    },
  )

  it('propagates a 403 from Auth with the BFF error format and sets no cookie', async () => {
    mockFetch.mockResolvedValueOnce(authError(403, 'forbidden'))

    const res = await post({ empresaId: EMPRESA_ID })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'denied' },
    })
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('propagates a 401 from Auth', async () => {
    mockFetch.mockResolvedValueOnce(authError(401, 'unauthorized'))

    const res = await post({ empresaId: EMPRESA_ID })

    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('does not report success when Auth forgot to re-issue the access token', async () => {
    mockFetch.mockResolvedValueOnce(authAnswer({ empresaId: EMPRESA_ID }))

    const res = await post({ empresaId: EMPRESA_ID })

    expect(res.status).toBe(502)
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('the plain router mounts the route under its prefix', () => {
  it('exposes /empresa-activa next to the other routes', async () => {
    mockFetch.mockResolvedValueOnce(
      authAnswer({ empresaId: null }, 'new-access'),
    )

    const res = await evaAuthRoutes().request('/empresa-activa', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: COOKIE },
      body: '{"empresaId":null}',
    })

    expect(res.status).toBe(200)
  })
})

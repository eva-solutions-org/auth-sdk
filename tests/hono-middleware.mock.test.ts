import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { evaAuth } from '../src/hono/middleware'
import { verifyAccessToken } from '../src/jwt'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../src/cookies'
import { createHttpClient } from '../src/http-client'

vi.mock('../src/jwt', () => ({
  verifyAccessToken: vi.fn(),
}))

vi.mock('../src/cookies', () => ({
  readTokensFromCookies: vi.fn(),
  setTokenCookies: vi.fn().mockReturnValue(['cookie1', 'cookie2']),
  clearTokenCookies: vi.fn().mockReturnValue(['clear1', 'clear2']),
}))

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}))

vi.mock('../src/http-client', () => ({
  createHttpClient: vi.fn().mockReturnValue({
    refresh: mockRefresh,
  }),
}))

function createTestApp() {
  const app = new Hono()
  app.use('/*', evaAuth())
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.EVA_AUTH_URL = 'http://auth.test'
})

describe('evaAuth middleware', () => {
  it('retorna 401 sin cookies', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Autenticación requerida' })
  })

  it('permite acceso con access token válido', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'valid',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: true,
      data: { id: 'user-1', sessionId: 'sess-1' },
    } as any)

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('intenta refresh cuando access token es inválido y refresh existe', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'expired',
      refreshToken: 'refresh-tok',
    } as any)

    vi.mocked(verifyAccessToken)
      .mockResolvedValueOnce({ ok: false, error: 'expired', status: 401 } as any)
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'user-1', sessionId: 'sess-1' },
      } as any)

    mockRefresh.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 'user-1' },
        tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      },
    })

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(verifyAccessToken).toHaveBeenCalledWith('new-access')
    expect(setTokenCookies).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })

    const setCookieHeaders = res.headers.getSetCookie()
    expect(setCookieHeaders).toContain('cookie1')
    expect(setCookieHeaders).toContain('cookie2')
  })

  it('retorna 401 y limpia cookies cuando refresh falla', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({
      refreshToken: 'bad-refresh',
    } as any)

    mockRefresh.mockResolvedValue({
      ok: false,
      error: 'invalid',
      status: 401,
    })

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(clearTokenCookies).toHaveBeenCalled()

    const setCookieHeaders = res.headers.getSetCookie()
    expect(setCookieHeaders).toContain('clear1')
    expect(setCookieHeaders).toContain('clear2')
  })

  it('retorna 401 cuando solo hay access token inválido (sin refresh)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'bad',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: false,
    } as any)

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Autenticación requerida' })
  })
})

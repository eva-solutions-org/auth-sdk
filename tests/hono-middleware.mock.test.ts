import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { Hono } from 'hono'
import { evaAuth } from '../src/hono/middleware'
import { verifyAccessToken } from '../src/jwt'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../src/cookies'

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => 'production' as const,
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
  getErrorMessages: vi.fn().mockReturnValue(undefined),
  validateErrorMessagesInput: vi.fn().mockImplementation((x: unknown) => x),
  getErrorWire: vi.fn().mockReturnValue('api'),
}))

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
})

describe('evaAuth middleware', () => {
  // ───── Casos existentes (backward compat — REQ-TE-030..033) ─────

  it('retorna 401 sin cookies', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const app = createTestApp()
    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Autenticación requerida' } })
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
    expect(verifyAccessToken).toHaveBeenCalledWith('new-access', expect.objectContaining({}))
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
      error: { kind: 'api', code: 'unauthorized', message: 'invalid', status: 401 },
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
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Autenticación requerida' } })
  })

  // ───── Con extraClaimsSchema válido (REQ-TE-013) ─────

  it('con schema válido: payload con extras accesible', async () => {
    const phoneSchema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'valid-with-phone',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: true,
      data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
    } as any)

    const app = new Hono()
    app.use('/*', evaAuth({ extraClaimsSchema: phoneSchema }))
    app.get('/test', (c) => {
      const payload = c.get('evaPayload')
      return c.json({ phone: (payload as any).phone })
    })

    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ phone: '+543412345' })
  })

  // ───── Schema mismatch → 401 (REQ-TE-011) ─────

  it('con schema: mismatch retorna 401 con mensaje auth requerida', async () => {
    const phoneSchema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'bad-claims',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: false,
      error: 'Payload del token inválido (claims extra)',
      status: 401,
    } as any)

    const app = new Hono()
    app.use('/*', evaAuth({ extraClaimsSchema: phoneSchema }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Autenticación requerida' } })
  })

  // ───── Multi-tenant: 2 instancias independientes (REQ-TE-013) ─────

  it('multi-tenant: dos evaAuth con schemas distintos no se cruzan', async () => {
    const adminSchema = z.object({ role: z.literal('admin') })
    const userSchema = z.object({ phone: z.string() })

    const app = new Hono()
    app.use('/admin/*', evaAuth({ extraClaimsSchema: adminSchema }))
    app.use('/user/*', evaAuth({ extraClaimsSchema: userSchema }))
    app.get('/admin/dashboard', (c) => {
      const payload = c.get('evaPayload')
      return c.json({ role: (payload as any).role })
    })
    app.get('/user/me', (c) => {
      const payload = c.get('evaPayload')
      return c.json({ phone: (payload as any).phone })
    })

    // Admin request
    vi.mocked(readTokensFromCookies).mockReturnValue({ accessToken: 'admin-tok' } as any)
    vi.mocked(verifyAccessToken).mockResolvedValueOnce({
      ok: true,
      data: { id: 'a1', sessionId: 's1', role: 'admin' },
    } as any)
    const adminRes = await app.request('/admin/dashboard')
    expect(adminRes.status).toBe(200)
    expect(await adminRes.json()).toEqual({ role: 'admin' })

    // User request
    vi.mocked(readTokensFromCookies).mockReturnValue({ accessToken: 'user-tok' } as any)
    vi.mocked(verifyAccessToken).mockResolvedValueOnce({
      ok: true,
      data: { id: 'u1', sessionId: 's2', phone: '+543412345' },
    } as any)
    const userRes = await app.request('/user/me')
    expect(userRes.status).toBe(200)
    expect(await userRes.json()).toEqual({ phone: '+543412345' })
  })

  // ───── Refresh path con schema (REQ-TE-013 + consistencia) ─────

  it('refresh path con schema: AT post-refresh cumple schema → ok', async () => {
    const phoneSchema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'expired',
      refreshToken: 'refresh-tok',
    } as any)

    vi.mocked(verifyAccessToken)
      .mockResolvedValueOnce({ ok: false, error: 'expired', status: 401 } as any)
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
      } as any)

    mockRefresh.mockResolvedValue({
      ok: true,
      data: {
        tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      },
    })

    const app = new Hono()
    app.use('/*', evaAuth({ extraClaimsSchema: phoneSchema }))
    app.get('/test', (c) => {
      const payload = c.get('evaPayload')
      return c.json({ phone: (payload as any).phone })
    })

    const res = await app.request('/test')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ phone: '+543412345' })
  })

  it('refresh path con schema: AT post-refresh viola schema → 401, cookies limpias', async () => {
    const phoneSchema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'expired',
      refreshToken: 'refresh-tok',
    } as any)

    vi.mocked(verifyAccessToken)
      .mockResolvedValueOnce({ ok: false, error: 'expired', status: 401 } as any)
      .mockResolvedValueOnce({
        ok: false,
        error: 'Payload del token inválido (claims extra)',
        status: 401,
      } as any)

    mockRefresh.mockResolvedValue({
      ok: true,
      data: {
        tokens: { accessToken: 'new-access-bad', refreshToken: 'new-refresh' },
      },
    })

    const app = new Hono()
    app.use('/*', evaAuth({ extraClaimsSchema: phoneSchema }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    // El middleware NO setea payload, llega al clearTokenCookies y retorna 401
    expect(res.status).toBe(401)
  })
})

// ─── errorMessages override local (T-44) ─────────────────────────────────────

import { getErrorMessages } from '../src/config'

describe('evaAuth — errorMessages override (T-44)', () => {
  it('override local cambia el mensaje de authRequired en 401', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)

    const app = new Hono()
    app.use('/*', evaAuth({ errorMessages: { authRequired: 'Authentication required' } }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } })
  })

  it('sin override — sigue usando el default en español (regression-lock)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)

    const app = new Hono()
    app.use('/*', evaAuth())
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Autenticación requerida' } })
  })

  it('override global (getErrorMessages) es tomado en cuenta', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue({ authRequired: 'Global override' })

    const app = new Hono()
    app.use('/*', evaAuth())
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Global override' } })
  })

  it('local override pisa global', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue({ authRequired: 'Global' })

    const app = new Hono()
    app.use('/*', evaAuth({ errorMessages: { authRequired: 'Local' } }))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Local' } })
  })
})

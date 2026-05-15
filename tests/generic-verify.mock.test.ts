import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { verifyRequest } from '../src/generic/verify'
import { verifyAccessToken } from '../src/jwt'
import { readTokensFromCookies, setTokenCookies } from '../src/cookies'

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => 'production' as const,
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
  getErrorMessages: vi.fn().mockReturnValue(undefined),
  validateErrorMessagesInput: vi.fn().mockImplementation((x: unknown) => x),
}))

vi.mock('../src/jwt', () => ({
  verifyAccessToken: vi.fn(),
}))

vi.mock('../src/cookies', () => ({
  readTokensFromCookies: vi.fn(),
  setTokenCookies: vi.fn().mockReturnValue(['new-cookie']),
  clearTokenCookies: vi.fn().mockReturnValue([]),
}))

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}))

vi.mock('../src/http-client', () => ({
  createHttpClient: vi.fn().mockReturnValue({
    refresh: mockRefresh,
  }),
}))

function makeRequest(cookie?: string): Request {
  return new Request('http://localhost/api/me', {
    headers: cookie ? { cookie } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('verifyRequest', () => {
  // ───── Sin schema: drop everything excepto id/sessionId (REQ-TE-012) ─────

  it('sin schema: JWT con extras — payload = { id, sessionId } solamente', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'valid',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: true,
      data: { id: 'u1', sessionId: 's1' },
    } as any)

    const result = await verifyRequest(makeRequest('access=valid'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.payload).toEqual({ id: 'u1', sessionId: 's1' })
  })

  // ───── Con schema válido ─────

  it('con schema válido: payload incluye extras parseados', async () => {
    const schema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'valid-with-phone',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: true,
      data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
    } as any)

    const result = await verifyRequest(makeRequest('access=valid'), { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.payload).toEqual({ id: 'u1', sessionId: 's1', phone: '+543412345' })
  })

  // ───── Schema mismatch → error 401 ─────

  it('schema mismatch: retorna error 401', async () => {
    const schema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      accessToken: 'bad-claims',
    } as any)
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: false,
      error: 'Payload del token inválido (claims extra)',
      status: 401,
    } as any)

    const result = await verifyRequest(makeRequest('access=bad'), { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.status).toBe(401)
  })

  // ───── Sin tokens → error 401 ─────

  it('sin tokens: retorna error 401', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const result = await verifyRequest(makeRequest())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.status).toBe(401)
  })

  // ───── Refresh path con schema ─────

  it('refresh path con schema: AT post-refresh cumple schema → ok con newCookies', async () => {
    const schema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      refreshToken: 'refresh-tok',
    } as any)

    mockRefresh.mockResolvedValue({
      ok: true,
      data: {
        tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      },
    })

    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: true,
      data: { id: 'u1', sessionId: 's1', phone: '+543412345' },
    } as any)

    const result = await verifyRequest(makeRequest('refresh=tok'), { extraClaimsSchema: schema })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.payload).toEqual({ id: 'u1', sessionId: 's1', phone: '+543412345' })
    expect(result.data.newCookies).toBeDefined()
    expect(setTokenCookies).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    })
  })

  it('refresh path con schema: AT post-refresh viola schema → error', async () => {
    const schema = z.object({ phone: z.string() })

    vi.mocked(readTokensFromCookies).mockReturnValue({
      refreshToken: 'refresh-tok',
    } as any)

    mockRefresh.mockResolvedValue({
      ok: true,
      data: {
        tokens: { accessToken: 'new-access-bad', refreshToken: 'new-refresh' },
      },
    })

    vi.mocked(verifyAccessToken).mockResolvedValue({
      ok: false,
      error: 'Payload del token inválido (claims extra)',
      status: 401,
    } as any)

    const result = await verifyRequest(makeRequest('refresh=tok'), { extraClaimsSchema: schema })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.status).toBe(401)
  })
})

// ─── errorMessages override local (T-44) ─────────────────────────────────────

import { getErrorMessages } from '../src/config'

describe('verifyRequest — errorMessages override (T-44)', () => {
  it('override local authRequired — sin tokens en cookies', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)

    const result = await verifyRequest(makeRequest(), {
      errorMessages: { authRequired: 'Bad token — custom' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('Bad token — custom')
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('auth_required')
    expect(result.error.status).toBe(401)
  })

  it('sin override — default authRequired en español (regression-lock)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)

    const result = await verifyRequest(makeRequest())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('Autenticación requerida')
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('auth_required')
    expect(result.error.status).toBe(401)
  })

  it('override refreshNoNewTokens — refresh sin tokens', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'tok' } as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)
    mockRefresh.mockResolvedValue({ ok: true, data: {} }) // sin tokens

    const result = await verifyRequest(makeRequest(), {
      errorMessages: { refreshNoNewTokens: 'No new tokens custom' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('No new tokens custom')
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('refresh_no_tokens')
    expect(result.error.status).toBe(401)
  })

  it('override verifyFailedAfterRefresh con placeholder {0} reemplazado', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'tok' } as any)
    vi.mocked(getErrorMessages).mockReturnValue(undefined)
    mockRefresh.mockResolvedValue({ ok: true, data: { tokens: { accessToken: 'new', refreshToken: 'new-r' } } })
    vi.mocked(verifyAccessToken).mockResolvedValue({ ok: false, error: 'expired signature' } as any)

    const result = await verifyRequest(makeRequest(), {
      errorMessages: { verifyFailedAfterRefresh: 'Verify failed: {0}' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('Verify failed: expired signature')
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('verify_failed')
    expect(result.error.status).toBe(401)
  })
})

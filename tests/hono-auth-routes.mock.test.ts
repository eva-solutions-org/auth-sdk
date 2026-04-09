import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../src/cookies'
import { createTokenPair, createUser } from './helpers/fixtures'

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => 'production' as const,
  AUTH_URL: 'http://auth.test',
  ENV: 'production',
}))

const { mockGetCode, mockLogin, mockRefresh, mockLogout, mockGetUser, mockUpdateUser, mockDeleteUser, mockGetUserEmpresas, mockGetSessions, mockDeleteSession, mockDeleteAllSessions } = vi.hoisted(() => ({
  mockGetCode: vi.fn(),
  mockLogin: vi.fn(),
  mockRefresh: vi.fn(),
  mockLogout: vi.fn(),
  mockGetUser: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockGetUserEmpresas: vi.fn(),
  mockGetSessions: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockDeleteAllSessions: vi.fn(),
}))

vi.mock('../src/http-client', () => ({
  createHttpClient: vi.fn().mockReturnValue({
    getCode: mockGetCode,
    login: mockLogin,
    refresh: mockRefresh,
    logout: mockLogout,
    getUser: mockGetUser,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
    getUserEmpresas: mockGetUserEmpresas,
    getSessions: mockGetSessions,
    deleteSession: mockDeleteSession,
    deleteAllSessions: mockDeleteAllSessions,
  }),
}))

vi.mock('../src/cookies', () => ({
  readTokensFromCookies: vi.fn(),
  setTokenCookies: vi.fn().mockReturnValue(['access-cookie', 'refresh-cookie']),
  clearTokenCookies: vi.fn().mockReturnValue(['clear-access', 'clear-refresh']),
}))

vi.mock('../src/hono/device-info', () => ({
  parseDeviceInfo: vi.fn().mockReturnValue({
    deviceType: 'desktop',
    os: 'Windows',
    browser: 'Chrome',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  }),
}))

import { evaAuthRoutes } from '../src/hono/auth-routes'

let app: ReturnType<typeof evaAuthRoutes>

beforeEach(() => {
  vi.clearAllMocks()
  app = evaAuthRoutes()
})

describe('POST /get-code', () => {
  it('retorna data cuando Auth Service responde ok', async () => {
    mockGetCode.mockResolvedValue({ ok: true, data: { message: 'Código enviado' } })

    const res = await app.request('/get-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+51999999999' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { message: 'Código enviado' } })
    expect(mockGetCode).toHaveBeenCalledWith({ phone: '+51999999999' })
  })

  it('retorna error cuando Auth Service responde error', async () => {
    mockGetCode.mockResolvedValue({ ok: false, error: 'Teléfono inválido', status: 400 })

    const res = await app.request('/get-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'invalid' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Teléfono inválido' })
  })
})

describe('POST /login', () => {
  const loginBody = { phone: '+51999999999', code: '123456' }
  const tokens = createTokenPair()
  const user = createUser()

  it('envía device info extraído del request', async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      data: { user, tokens },
    })

    await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody),
    })

    expect(mockLogin).toHaveBeenCalledWith({
      ...loginBody,
      deviceType: 'desktop',
      os: 'Windows',
      browser: 'Chrome',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
  })

  it('setea cookies con tokens exitosos', async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      data: { user, tokens },
    })

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody),
    })

    expect(res.status).toBe(200)
    expect(setTokenCookies).toHaveBeenCalledWith(tokens)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toContain('access-cookie')
    expect(setCookies).toContain('refresh-cookie')
    expect(await res.json()).toEqual({ data: { user: { id: user.id } } })
  })

  it('retorna error si login falla', async () => {
    mockLogin.mockResolvedValue({ ok: false, error: 'Código incorrecto', status: 401 })

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginBody),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Código incorrecto' })
  })
})

describe('POST /refresh', () => {
  it('retorna 401 si no hay refresh cookie', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const res = await app.request('/refresh', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Token de refresco no encontrado' })
  })

  it('rota cookies cuando refresh es exitoso', async () => {
    const newTokens = createTokenPair({ accessToken: 'new-access', refreshToken: 'new-refresh' })
    const user = createUser()

    vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'old-refresh' } as any)
    mockRefresh.mockResolvedValue({
      ok: true,
      data: { user, tokens: newTokens },
    })

    const res = await app.request('/refresh', {
      method: 'POST',
      headers: { cookie: 'eva_refresh_token=old-refresh' },
    })

    expect(res.status).toBe(200)
    expect(mockRefresh).toHaveBeenCalledWith({ refreshToken: 'old-refresh' })
    expect(setTokenCookies).toHaveBeenCalledWith(newTokens)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toContain('access-cookie')
    expect(setCookies).toContain('refresh-cookie')
    expect(await res.json()).toEqual({ data: { user: { id: user.id } } })
  })
})

describe('POST /logout', () => {
  it('limpia cookies en logout exitoso', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'refresh-tok' } as any)
    mockLogout.mockResolvedValue({ ok: true, data: { message: 'Sesión cerrada' } })

    const res = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: 'eva_refresh_token=refresh-tok' },
    })

    expect(res.status).toBe(200)
    expect(mockLogout).toHaveBeenCalledWith({ refreshToken: 'refresh-tok' })
    expect(clearTokenCookies).toHaveBeenCalled()
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toContain('clear-access')
    expect(setCookies).toContain('clear-refresh')
    expect(await res.json()).toEqual({ data: { message: 'Sesión cerrada' } })
  })
})

describe('GET /me', () => {
  it('retorna user data con access token válido', async () => {
    const user = createUser()
    vi.mocked(readTokensFromCookies).mockReturnValue({ accessToken: 'valid-token' } as any)
    mockGetUser.mockResolvedValue({ ok: true, data: user })

    const res = await app.request('/me', {
      headers: { cookie: 'eva_access_token=valid-token' },
    })

    expect(res.status).toBe(200)
    expect(mockGetUser).toHaveBeenCalledWith({ accessToken: 'valid-token' })
    expect(await res.json()).toEqual({ data: user })
  })

  it('retorna 401 sin access token', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const res = await app.request('/me')

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Token de acceso no encontrado' })
  })
})

describe('DELETE /sessions', () => {
  it('usa refresh token y limpia cookies', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({ refreshToken: 'refresh-tok' } as any)
    mockDeleteAllSessions.mockResolvedValue({ ok: true, data: { message: 'Todas las sesiones cerradas' } })

    const res = await app.request('/sessions', {
      method: 'DELETE',
      headers: { cookie: 'eva_refresh_token=refresh-tok' },
    })

    expect(res.status).toBe(200)
    expect(mockDeleteAllSessions).toHaveBeenCalledWith({ refreshToken: 'refresh-tok' })
    expect(clearTokenCookies).toHaveBeenCalled()
    const setCookies = res.headers.getSetCookie()
    expect(setCookies).toContain('clear-access')
    expect(setCookies).toContain('clear-refresh')
    expect(await res.json()).toEqual({ data: { message: 'Todas las sesiones cerradas' } })
  })
})

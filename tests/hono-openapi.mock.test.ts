/**
 * T-42: Tests de evaAuthOpenAPIRoutes — smoke OpenAPI doc + cross-variant HTTP parity.
 * - Verifica que /doc genera OpenAPI 3.1 válido con los 11 endpoints y tag 'Auth'
 * - Verifica que el comportamiento HTTP es idéntico al de evaAuthRoutes() (parametrizado)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAPIHono } from '@hono/zod-openapi'
import { readTokensFromCookies } from '../src/cookies'
import { createTokenPair, createUser } from './helpers/fixtures'

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => 'production' as const,
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
  getErrorMessages: vi.fn().mockReturnValue(undefined),
  validateErrorMessagesInput: vi.fn().mockImplementation((x: unknown) => x),
  getErrorWire: vi.fn().mockReturnValue('api'),
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

import { evaAuthOpenAPIRoutes } from '../src/hono-openapi/index'
import { evaAuthRoutes } from '../src/hono/auth-routes'

function makeOpenAPIApp() {
  const parent = new OpenAPIHono()
  parent.route('/auth', evaAuthOpenAPIRoutes())
  parent.doc('/doc', { openapi: '3.1.0', info: { title: 'Test API', version: '1.0' } })
  return parent
}

let openApiApp: ReturnType<typeof makeOpenAPIApp>
let flatApp: ReturnType<typeof evaAuthRoutes>

beforeEach(() => {
  vi.clearAllMocks()
  openApiApp = makeOpenAPIApp()
  flatApp = evaAuthRoutes()
})

// ==============================
// SMOKE: OpenAPI doc generation
// ==============================

describe('evaAuthOpenAPIRoutes — OpenAPI doc smoke', () => {
  it('GET /doc retorna OpenAPI 3.1 válido', async () => {
    const res = await openApiApp.fetch(new Request('http://localhost/doc'))
    expect(res.status).toBe(200)
    const doc = await res.json() as Record<string, unknown>
    expect(doc['openapi']).toBe('3.1.0')
    expect(doc['info']).toMatchObject({ title: 'Test API' })
  })

  it('doc incluye los 11 endpoints bajo /auth', async () => {
    const res = await openApiApp.fetch(new Request('http://localhost/doc'))
    const doc = await res.json() as Record<string, unknown>
    const paths = Object.keys(doc['paths'] as Record<string, unknown>)
    expect(paths).toContain('/auth/get-code')
    expect(paths).toContain('/auth/login')
    expect(paths).toContain('/auth/refresh')
    expect(paths).toContain('/auth/logout')
    expect(paths).toContain('/auth/me')
    expect(paths).toContain('/auth/empresas')
    expect(paths).toContain('/auth/sessions')
    expect(paths).toContain('/auth/sessions/{id}')
    expect(paths.filter(p => p.startsWith('/auth'))).toHaveLength(8) // paths únicos (me y sessions tienen múltiples métodos)
  })

  it('doc incluye tag Auth en los endpoints', async () => {
    const res = await openApiApp.fetch(new Request('http://localhost/doc'))
    const doc = await res.json() as Record<string, unknown>
    const paths = doc['paths'] as Record<string, Record<string, unknown>>
    const loginPath = paths['/auth/login']
    const postLogin = loginPath?.['post'] as Record<string, unknown>
    expect(postLogin?.['tags']).toContain('Auth')
  })

  it('doc incluye schemas de request en login', async () => {
    const res = await openApiApp.fetch(new Request('http://localhost/doc'))
    const doc = await res.json() as Record<string, unknown>
    const paths = doc['paths'] as Record<string, Record<string, unknown>>
    const loginPost = paths['/auth/login']?.['post'] as Record<string, unknown>
    expect(loginPost?.['requestBody']).toBeDefined()
  })
})

// ==============================
// CROSS-VARIANT: HTTP parity
// ==============================

describe('cross-variant HTTP parity — evaAuthRoutes vs evaAuthOpenAPIRoutes', () => {
  it('POST /get-code — respuesta idéntica (200 success)', async () => {
    mockGetCode.mockResolvedValue({ ok: true, data: { message: 'Código enviado' } })

    const req = () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+51999999999' }),
    })

    const flatRes = await flatApp.request('/get-code', req())
    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/get-code', req()))

    expect(openRes.status).toBe(flatRes.status)
    expect(await openRes.json()).toEqual(await flatRes.json())
  })

  it('POST /get-code — body inválido retorna 400 (idéntico)', async () => {
    const req = () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad json{',
    })

    const flatRes = await flatApp.request('/get-code', req())
    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/get-code', req()))

    expect(openRes.status).toBe(flatRes.status)
    expect(openRes.status).toBe(400)
  })

  it('POST /login — success con cookies (idéntico)', async () => {
    const tokens = createTokenPair()
    const user = createUser()
    mockLogin.mockResolvedValue({ ok: true, data: { user, tokens } })

    const req = () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+51999999999', code: '123456' }),
    })

    const flatRes = await flatApp.request('/login', req())
    vi.clearAllMocks()
    mockLogin.mockResolvedValue({ ok: true, data: { user, tokens } })

    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/login', req()))

    expect(openRes.status).toBe(flatRes.status)
    expect(await openRes.json()).toEqual(await flatRes.json())
    expect(openRes.headers.getSetCookie()).toContain('access-cookie')
  })

  it('GET /me — 401 sin token (idéntico)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const flatRes = await flatApp.request('/me')
    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/me'))

    expect(openRes.status).toBe(flatRes.status)
    expect(openRes.status).toBe(401)
    const flatBody = await flatRes.json() as Record<string, string>
    const openBody = await openRes.json() as Record<string, string>
    expect(openBody['error']).toStrictEqual(flatBody['error'])
  })

  it('POST /refresh — 401 sin refresh token (idéntico)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({} as any)

    const flatRes = await flatApp.request('/refresh', { method: 'POST' })
    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/refresh', { method: 'POST' }))

    expect(openRes.status).toBe(flatRes.status)
    expect(openRes.status).toBe(401)
  })

  it('DELETE /sessions/:id — 400 con sessionId inválido (idéntico)', async () => {
    vi.mocked(readTokensFromCookies).mockReturnValue({ accessToken: 'tok' } as any)

    const flatRes = await flatApp.request('/sessions/invalid id with spaces', { method: 'DELETE' })
    const openRes = await openApiApp.fetch(new Request('http://localhost/auth/sessions/invalid id with spaces', { method: 'DELETE' }))

    expect(openRes.status).toBe(flatRes.status)
  })
})

import type { EvaUser, EvaSession, EvaEmpresa, TokenPair, DeviceInfo } from '../../src/types'

export const createTokenPair = (overrides: Partial<TokenPair> = {}): TokenPair => ({
  accessToken: 'fake-access-token',
  refreshToken: 'session-uuid:fake-refresh-token',
  ...overrides,
})

export const createUser = (overrides: Partial<EvaUser> = {}): EvaUser => ({
  id: 'user-1',
  phone: '+51999999999',
  name: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  dni: '12345678',
  stateActivity: 'activo',
  statePrivacy: 'publico',
  createdAt: '2025-01-01T00:00:00Z',
  ...overrides,
})

export const createSession = (overrides: Partial<EvaSession> = {}): EvaSession => ({
  sessionId: 'session-1',
  deviceType: 'desktop',
  os: 'Windows',
  browser: 'Chrome',
  ipAddress: '127.0.0.1',
  createdAt: '2025-01-01T00:00:00Z',
  current: true,
  ...overrides,
})

export const createEmpresa = (overrides: Partial<EvaEmpresa> = {}): EvaEmpresa => ({
  id: 'empresa-1',
  ruc: '20123456789',
  razonSocial: 'Test Corp SAC',
  slug: 'test-corp',
  direccion: 'Av Test 123',
  celular: '+51999999999',
  email: 'info@test.com',
  img: null,
  ...overrides,
})

export const createDeviceInfo = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
  deviceType: 'desktop',
  os: 'Windows',
  browser: 'Chrome',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  ...overrides,
})

export const createCookieHeader = (tokens: Partial<TokenPair> = createTokenPair()) => {
  const parts: string[] = []
  if (tokens.accessToken) parts.push(`eva_access_token=${tokens.accessToken}`)
  if (tokens.refreshToken) parts.push(`eva_refresh_token=${tokens.refreshToken}`)
  return parts.join('; ')
}

export const createJsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

export const createAuthServiceResponse = (
  data: unknown,
  tokens?: TokenPair,
) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (tokens) {
    headers['x-eva-new-access-token'] = tokens.accessToken
    headers['x-eva-new-refresh-token'] = tokens.refreshToken
  }
  return new Response(JSON.stringify({ data }), { status: 200, headers })
}

export const createErrorResponse = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

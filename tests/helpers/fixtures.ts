import type { EvaUser, TokenPair, DeviceInfo } from '../../src/types'

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

export const createDeviceInfo = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
  deviceType: 'desktop',
  os: 'Windows',
  browser: 'Chrome',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  ...overrides,
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

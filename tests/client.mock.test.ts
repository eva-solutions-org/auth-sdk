import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpClient } from '../src/http-client'
import { HEADERS } from '../src/constants'
import {
  createTokenPair,
  createUser,
  createDeviceInfo,
  createAuthServiceResponse,
  createErrorResponse,
} from './helpers/fixtures'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
  process.env.EVA_AUTH_URL = 'http://auth.test'
})

const client = createHttpClient()

describe('createHttpClient', () => {
  it('genera un objeto con todos los métodos', () => {
    const methods = Object.keys(client)
    expect(methods).toEqual(
      expect.arrayContaining([
        'getCode',
        'login',
        'refresh',
        'logout',
        'getUser',
        'updateUser',
        'deleteUser',
        'getUserEmpresas',
        'getSessions',
        'deleteSession',
        'deleteAllSessions',
        'health',
      ]),
    )
  })
})

describe('getCode', () => {
  it('envía POST a login/get-code con phone en body', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}))

    await client.getCode({ phone: '+51999999999' })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://auth.test/login/get-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+51999999999' }),
      }),
    )
  })

  it('retorna ok con data del Auth Service', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({ message: 'code sent' }),
    )

    const result = await client.getCode({ phone: '+51999999999' })

    expect(result).toEqual({
      ok: true,
      data: { message: 'code sent' },
    })
  })

  it('retorna error cuando Auth Service responde 429', async () => {
    mockFetch.mockResolvedValueOnce(
      createErrorResponse('Too many requests', 429),
    )

    const result = await client.getCode({ phone: '+51999999999' })

    expect(result).toEqual({
      ok: false,
      error: 'Too many requests',
      status: 429,
    })
  })
})

describe('login', () => {
  const deviceInfo = createDeviceInfo()

  it('envía POST a login con phone, code y deviceInfo en body', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, createTokenPair()),
    )

    await client.login({ phone: '+51999999999', code: '123456', ...deviceInfo })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://auth.test/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          phone: '+51999999999',
          code: '123456',
          deviceType: deviceInfo.deviceType,
          os: deviceInfo.os,
          browser: deviceInfo.browser,
          userAgent: deviceInfo.userAgent,
        }),
      }),
    )
  })

  it('extrae tokens de headers de respuesta', async () => {
    const tokens = createTokenPair()
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, tokens),
    )

    const result = await client.login({ phone: '+51999999999', code: '123456', ...deviceInfo })

    expect(result).toEqual({
      ok: true,
      data: { tokens },
    })
  })
})

describe('refresh', () => {
  it('envía POST a login/refresh con X-Eva-Refresh-Token header', async () => {
    const tokens = createTokenPair()
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, tokens),
    )

    await client.refresh({ refreshToken: 'my-refresh-token' })

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers[HEADERS.REFRESH_TOKEN]).toBe('my-refresh-token')
    expect(options.method).toBe('POST')
  })

  it('extrae tokens rotados de headers de respuesta', async () => {
    const newTokens = createTokenPair({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    })
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, newTokens),
    )

    const result = await client.refresh({ refreshToken: 'old-refresh' })

    expect(result).toEqual({
      ok: true,
      data: { tokens: newTokens },
    })
  })

  it('retorna error cuando refresh token es inválido (401)', async () => {
    mockFetch.mockResolvedValueOnce(
      createErrorResponse('Invalid refresh token', 401),
    )

    const result = await client.refresh({ refreshToken: 'bad-token' })

    expect(result).toEqual({
      ok: false,
      error: 'Invalid refresh token',
      status: 401,
    })
  })
})

describe('logout', () => {
  it('envía POST a login/logout con refresh token en header', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}))

    await client.logout({ refreshToken: 'my-refresh-token' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://auth.test/login/logout')
    expect(options.method).toBe('POST')
    expect(options.headers[HEADERS.REFRESH_TOKEN]).toBe('my-refresh-token')
  })
})

describe('getUser', () => {
  it('envía GET a user con Authorization Bearer header', async () => {
    const user = createUser()
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(user))

    await client.getUser({ accessToken: 'my-access-token' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://auth.test/user')
    expect(options.method).toBe('GET')
    expect(options.headers[HEADERS.AUTHORIZATION]).toBe('Bearer my-access-token')
  })

  it('retorna EvaUser data', async () => {
    const user = createUser()
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(user))

    const result = await client.getUser({ accessToken: 'my-access-token' })

    expect(result).toEqual({
      ok: true,
      data: user,
    })
  })
})

describe('network errors', () => {
  it('retorna error con status 0 cuando fetch falla (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))

    const result = await client.health()

    expect(result).toEqual({
      ok: false,
      error: 'Failed to fetch',
      status: 0,
    })
  })
})

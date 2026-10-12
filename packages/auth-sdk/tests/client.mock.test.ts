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

// importOriginal: el predicado isEvaAuthConfigError que usa http-client es el REAL;
// solo se reemplazan las funciones que dependen del estado de configuración.
const { getAuthUrlMock } = vi.hoisted(() => ({ getAuthUrlMock: vi.fn() }))

vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getAuthUrl: getAuthUrlMock,
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
  getAuthUrlMock.mockReset()
  getAuthUrlMock.mockReturnValue('http://auth.test')
})

const client = createHttpClient()

const CHALLENGE_ID = '9f86d081884c7d659a2feaa0c55ad015'

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

  it('get_code_passthrough_challenge: expone challengeId del Auth Service en el resultado tipado', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({
        message: 'code sent',
        challengeId: '9f86d081884c7d659a2feaa0c55ad015',
      }),
    )

    const result = await client.getCode({ phone: '+51999999999' })

    expect(result).toEqual({
      ok: true,
      data: {
        message: 'code sent',
        challengeId: '9f86d081884c7d659a2feaa0c55ad015',
      },
    })
  })

  it('retorna error cuando Auth Service responde 429', async () => {
    mockFetch.mockResolvedValueOnce(
      createErrorResponse('Too many requests', 429, 'rate_limited'),
    )

    const result = await client.getCode({ phone: '+51999999999' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.message).toBe('Too many requests')
    expect(result.error.status).toBe(429)
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'rate_limited',
    )
  })
})

describe('login', () => {
  const deviceInfo = createDeviceInfo()

  it('envía POST a login con phone, code y deviceInfo en body', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, createTokenPair()),
    )

    await client.login({
      phone: '+51999999999',
      code: '123456',
      challengeId: CHALLENGE_ID,
      ...deviceInfo,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://auth.test/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          phone: '+51999999999',
          code: '123456',
          challengeId: CHALLENGE_ID,
          deviceType: deviceInfo.deviceType,
          os: deviceInfo.os,
          browser: deviceInfo.browser,
          userAgent: deviceInfo.userAgent,
        }),
      }),
    )
  })

  it('login_sends_challenge_id: el body enviado al Auth Service contiene challengeId', async () => {
    mockFetch.mockResolvedValueOnce(
      createAuthServiceResponse({}, createTokenPair()),
    )

    await client.login({
      phone: '+51999999999',
      code: '123456',
      challengeId: CHALLENGE_ID,
      ...deviceInfo,
    })

    const [, options] = mockFetch.mock.calls[0]
    expect(JSON.parse(options.body as string)).toMatchObject({
      challengeId: CHALLENGE_ID,
    })
  })

  it('extrae tokens de headers de respuesta', async () => {
    const tokens = createTokenPair()
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}, tokens))

    const result = await client.login({
      phone: '+51999999999',
      code: '123456',
      challengeId: CHALLENGE_ID,
      ...deviceInfo,
    })

    expect(result).toEqual({
      ok: true,
      data: { tokens },
    })
  })
})

describe('refresh', () => {
  it('envía POST a login/refresh con X-Eva-Refresh-Token header', async () => {
    const tokens = createTokenPair()
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}, tokens))

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
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse({}, newTokens))

    const result = await client.refresh({ refreshToken: 'old-refresh' })

    expect(result).toEqual({
      ok: true,
      data: { tokens: newTokens },
    })
  })

  it('retorna error cuando refresh token es inválido (401)', async () => {
    mockFetch.mockResolvedValueOnce(
      createErrorResponse('Invalid refresh token', 401, 'unauthorized'),
    )

    const result = await client.refresh({ refreshToken: 'bad-token' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.message).toBe('Invalid refresh token')
    expect(result.error.status).toBe(401)
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'unauthorized',
    )
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
    expect(options.headers[HEADERS.AUTHORIZATION]).toBe(
      'Bearer my-access-token',
    )
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

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.message).toBe('Failed to fetch')
    expect(result.error.status).toBe(0)
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'network',
    )
  })
})

describe('config errors', () => {
  it('authFetch_rethrows_config_error: sin authUrl rechaza con el error de config, no lo mapea a network', async () => {
    getAuthUrlMock.mockImplementation(() => {
      throw Object.assign(new Error('authUrl no configurada'), {
        name: 'EvaAuthConfigError',
      })
    })

    await expect(client.health()).rejects.toMatchObject({
      name: 'EvaAuthConfigError',
      message: 'authUrl no configurada',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('authFetch_maps_network_failure: TypeError de fetch sigue siendo network con status 0', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

    const result = await client.health()

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'network',
        message: 'fetch failed',
        status: 0,
      },
    })
  })
})

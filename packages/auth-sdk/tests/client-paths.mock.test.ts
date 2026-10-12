import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AUTH_ROUTES,
  INTERNAL_USER_ROUTES,
  SESSION_ROUTES,
  USER_ROUTES,
} from '@eva_solutions/auth-contracts'
import { createS2SClient } from '../src/s2s/client'
import { createHttpClient } from '../src/http-client'
import { createAuthServiceResponse, createDeviceInfo } from './helpers/fixtures'

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
  getAuthUrlMock.mockReturnValue('https://auth.example')
  mockFetch.mockImplementation(() =>
    Promise.resolve(createAuthServiceResponse({})),
  )
})

const client = createHttpClient()
const CHALLENGE_ID = '9f86d081884c7d659a2feaa0c55ad015'

/** Method and pathname of the one fetch call the client made. */
function lastCall(): { method: string; pathname: string } {
  const [url, init] = mockFetch.mock.calls[0] as [string, { method?: string }]
  return {
    method: (init.method ?? 'GET').toLowerCase(),
    pathname: new URL(url).pathname,
  }
}

// Client paths are compared with the contract descriptors BEFORE the prefix slice (no `/api/v1`).
describe('client_paths_equal_descriptors_pre_prefix', () => {
  const cases = [
    [
      'getCode',
      AUTH_ROUTES.getCode,
      () => client.getCode({ phone: '5491155551234' }),
    ],
    [
      'login',
      AUTH_ROUTES.login,
      () =>
        client.login({
          phone: '5491155551234',
          code: 'A1B2C3',
          challengeId: CHALLENGE_ID,
          ...createDeviceInfo(),
        }),
    ],
    [
      'refresh',
      AUTH_ROUTES.refresh,
      () => client.refresh({ refreshToken: 'r' }),
    ],
    ['logout', AUTH_ROUTES.logout, () => client.logout({ refreshToken: 'r' })],
  ] as const

  it.each(cases)(
    '%s uses its descriptor method and path',
    async (_n, route, call) => {
      await call()

      expect(lastCall()).toEqual({ method: route.method, pathname: route.path })
    },
  )

  it('health stays a root path', async () => {
    await client.health()

    expect(lastCall()).toEqual({ method: 'get', pathname: '/health' })
  })

  it('jwks_stays_at_root: jwks.ts builds its URL without the route helper', () => {
    const source = readFileSync(
      new URL('../src/jwks.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('/.well-known/jwks.json')
    expect(source).not.toContain('api-path')
  })
})

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('client_paths_equal_descriptors_pre_prefix: users and sessions', () => {
  const cases = [
    [
      'getUser',
      USER_ROUTES.get,
      {},
      () => client.getUser({ accessToken: 'a' }),
    ],
    [
      'updateUser',
      USER_ROUTES.update,
      {},
      () => client.updateUser({ accessToken: 'a', data: { name: 'Ana' } }),
    ],
    [
      'deleteUser',
      USER_ROUTES.deactivate,
      {},
      () => client.deleteUser({ accessToken: 'a' }),
    ],
    [
      'getUserEmpresas',
      USER_ROUTES.listCompanies,
      {},
      () => client.getUserEmpresas({ accessToken: 'a' }),
    ],
    [
      'getSessions',
      SESSION_ROUTES.list,
      {},
      () => client.getSessions({ accessToken: 'a' }),
    ],
    [
      'deleteSession',
      SESSION_ROUTES.deleteOne,
      { id: SESSION_ID },
      () => client.deleteSession({ accessToken: 'a', sessionId: SESSION_ID }),
    ],
    [
      'deleteAllSessions',
      SESSION_ROUTES.deleteAll,
      {},
      () => client.deleteAllSessions({ refreshToken: 'r' }),
    ],
  ] as const

  it.each(cases)(
    '%s uses its descriptor method and path',
    async (_n, route, params, call) => {
      await call()

      expect(lastCall()).toEqual({
        method: route.method,
        pathname: route.path.replace(
          /\{(\w+)\}/g,
          (_m, key: string) => (params as Record<string, string>)[key] ?? '',
        ),
      })
    },
  )
})

describe('client_paths_equal_descriptors_pre_prefix: internal users', () => {
  const s2s = createS2SClient({
    clientId: 'svc',
    secretHex: 'a'.repeat(64),
    baseUrl: 'https://auth.example',
  })

  it('getUser uses the internal user descriptor', async () => {
    await s2s.getUser('user-1')

    expect(lastCall()).toEqual({
      method: INTERNAL_USER_ROUTES.get.method,
      pathname: '/internal/users/user-1',
    })
  })

  it('batchUsers uses the batch descriptor', async () => {
    await s2s.batchUsers({ ids: ['user-1'] })

    expect(lastCall()).toEqual({
      method: INTERNAL_USER_ROUTES.batch.method,
      pathname: INTERNAL_USER_ROUTES.batch.path,
    })
  })
})

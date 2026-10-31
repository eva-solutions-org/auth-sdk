import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpClient } from '../src/http-client'
import { evaAuthRoutes } from '../src/hono/auth-routes'
import {
  createAuthServiceResponse,
  createTokenPair,
  createUser,
} from './helpers/fixtures'

// Regresion H1: `authFetch` esparcia `data` en un objeto, y un array se volvia `{ "0": …, "1": … }`.
// Aqui NO se mockea el cliente HTTP: se mockea solo `fetch`, para que el array recorra el camino
// real cliente -> BFF (`evaAuthRoutes`) hasta el JSON que ve el navegador.
vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
  getCookieDomain: () => undefined,
  getProduct: () => 'whatsapp-panel',
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

const SESSIONS = [
  {
    sessionId: 's1',
    deviceType: 'desktop',
    os: 'Windows',
    browser: 'Chrome',
    ipAddress: '1.2.3.4',
    createdAt: '2026-01-01T00:00:00.000Z',
    current: true,
  },
  {
    sessionId: 's2',
    deviceType: 'mobile',
    os: 'Android',
    browser: 'Chrome',
    ipAddress: '5.6.7.8',
    createdAt: '2026-01-02T00:00:00.000Z',
    current: false,
  },
]

const EMPRESAS = [
  { id: 'e1', ruc: '20100000001', razonSocial: 'Uno SAC', slug: 'uno' },
  { id: 'e2', ruc: '20100000002', razonSocial: 'Dos SAC', slug: 'dos' },
]

const COOKIE = 'eva_whatsapp-panel_access_token=access-abc'

describe('createHttpClient — respuestas array', () => {
  it('getSessions devuelve un array real, con sus elementos intactos', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(SESSIONS))

    const result = await createHttpClient().getSessions({
      accessToken: 'access-abc',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data).toEqual(SESSIONS)
    expect(result.data.map((s) => s.sessionId)).toEqual(['s1', 's2'])
  })

  it('getUserEmpresas devuelve un array real, con sus elementos intactos', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(EMPRESAS))

    const result = await createHttpClient().getUserEmpresas({
      accessToken: 'access-abc',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data.map((e) => e.slug)).toEqual(['uno', 'dos'])
  })

  it('un array vacio sigue siendo un array vacio', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse([]))

    const result = await createHttpClient().getSessions({
      accessToken: 'access-abc',
    })

    expect(result.ok && Array.isArray(result.data) && result.data.length).toBe(
      0,
    )
  })

  it('una respuesta objeto no cambia: conserva sus campos y adjunta tokens', async () => {
    const user = createUser()
    const tokens = createTokenPair()
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(user, tokens))

    const result = await createHttpClient().getUser({
      accessToken: 'access-abc',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.data)).toBe(false)
    expect(result.data).toEqual({ ...user, tokens })
  })
})

describe('evaAuthRoutes — respuestas array llegan como array al navegador', () => {
  it('GET /sessions responde { data: [...] }', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(SESSIONS))

    const res = await evaAuthRoutes().request('/sessions', {
      headers: { cookie: COOKIE },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toEqual({ data: SESSIONS })
    expect((body.data as typeof SESSIONS).map((s) => s.current)).toEqual([
      true,
      false,
    ])
  })

  it('GET /empresas responde { data: [...] }', async () => {
    mockFetch.mockResolvedValueOnce(createAuthServiceResponse(EMPRESAS))

    const res = await evaAuthRoutes().request('/empresas', {
      headers: { cookie: COOKIE },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown }
    expect(Array.isArray(body.data)).toBe(true)
    expect(body).toEqual({ data: EMPRESAS })
  })
})

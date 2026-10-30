/**
 * CSRF por Origin en las rutas con cookies (evaAuthRoutes y evaAuthOpenAPIRoutes).
 * Una mutación (POST/PATCH/PUT/DELETE) con `Origin` ajeno responde 403 sin llegar al handler;
 * sin `Origin` (clientes que no son navegador) y los métodos seguros pasan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getCookieDomain: () => undefined,
  configureEvaAuth: vi.fn(),
  getErrorMessages: vi.fn().mockReturnValue(undefined),
  validateErrorMessagesInput: vi.fn().mockImplementation((x: unknown) => x),
  getErrorWire: vi.fn().mockReturnValue('api'),
}))

const { mockGetCode, mockGetUser } = vi.hoisted(() => ({
  mockGetCode: vi.fn(),
  mockGetUser: vi.fn(),
}))

vi.mock('../src/http-client', () => ({
  createHttpClient: vi.fn().mockReturnValue({
    getCode: mockGetCode,
    getUser: mockGetUser,
  }),
}))

vi.mock('../src/cookies', () => ({
  readTokensFromCookies: vi.fn().mockReturnValue({}),
  setTokenCookies: vi.fn().mockReturnValue([]),
  clearTokenCookies: vi.fn().mockReturnValue([]),
}))

vi.mock('../src/hono/device-info', () => ({
  parseDeviceInfo: vi.fn().mockReturnValue({}),
}))

import { evaAuthRoutes } from '../src/hono/auth-routes'
import { evaAuthOpenAPIRoutes } from '../src/hono-openapi/index'

const SAME_ORIGIN = 'http://app.test'
const EVIL_ORIGIN = 'https://evil.example'

const postGetCode = (
  app: {
    request: (url: string, init: RequestInit) => Response | Promise<Response>
  },
  headers: Record<string, string> = {},
) =>
  app.request(`${SAME_ORIGIN}/get-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ phone: '+51999999999' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCode.mockResolvedValue({ ok: true, data: { message: 'ok' } })
})

describe.each([
  ['evaAuthRoutes', evaAuthRoutes],
  ['evaAuthOpenAPIRoutes', evaAuthOpenAPIRoutes],
] as const)('%s — verificación de Origin', (_name, build) => {
  it('origin_foraneo_en_post_responde_403_sin_llegar_al_handler', async () => {
    const res = await postGetCode(build(), { Origin: EVIL_ORIGIN })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Origen no permitido' },
    })
    expect(mockGetCode).not.toHaveBeenCalled()
  })

  it('origin_del_mismo_host_pasa_al_handler', async () => {
    const res = await postGetCode(build(), { Origin: SAME_ORIGIN })

    expect(res.status).toBe(200)
    expect(mockGetCode).toHaveBeenCalledTimes(1)
  })

  it('sin_origin_pasa_al_handler_clientes_que_no_son_navegador', async () => {
    const res = await postGetCode(build())

    expect(res.status).toBe(200)
    expect(mockGetCode).toHaveBeenCalledTimes(1)
  })

  it('origin_null_se_rechaza', async () => {
    const res = await postGetCode(build(), { Origin: 'null' })

    expect(res.status).toBe(403)
    expect(mockGetCode).not.toHaveBeenCalled()
  })

  it('allowedOrigins_admite_un_origen_extra_y_sigue_rechazando_los_demas', async () => {
    const app = build({ allowedOrigins: ['https://front.example.com/'] })

    const allowed = await postGetCode(app, {
      Origin: 'https://front.example.com',
    })
    const denied = await postGetCode(app, { Origin: EVIL_ORIGIN })

    expect(allowed.status).toBe(200)
    expect(denied.status).toBe(403)
    expect(mockGetCode).toHaveBeenCalledTimes(1)
  })

  it('allowedOrigins_no_admite_prefijos_ni_subdominios', async () => {
    const app = build({ allowedOrigins: ['https://front.example.com'] })

    for (const origin of [
      'https://front.example.com.evil.example',
      'https://evil.front.example.com',
      'http://front.example.com',
    ]) {
      const res = await postGetCode(app, { Origin: origin })
      expect(res.status, origin).toBe(403)
    }
    expect(mockGetCode).not.toHaveBeenCalled()
  })

  it('allowedOrigins_admite_esquemas_de_apps_nativas_por_coincidencia_exacta', async () => {
    const app = build({
      allowedOrigins: ['tauri://localhost', 'capacitor://localhost:8080/'],
    })

    for (const origin of ['tauri://localhost', 'capacitor://localhost:8080']) {
      const res = await postGetCode(app, { Origin: origin })
      expect(res.status, origin).toBe(200)
    }
    expect(mockGetCode).toHaveBeenCalledTimes(2)

    for (const origin of [
      'tauri://evil.example',
      'tauri://localhost:1420',
      'capacitor://localhost',
      'https://localhost',
      'null',
    ]) {
      const res = await postGetCode(app, { Origin: origin })
      expect(res.status, origin).toBe(403)
    }
    expect(mockGetCode).toHaveBeenCalledTimes(2)
  })

  it('allowedOrigins_invalido_lanza_al_construir', () => {
    for (const entry of [
      'null',
      'tauri://',
      'tauri://localhost/path',
      'tauri://user@localhost',
      'tauri://localhost:abc',
    ]) {
      expect(() => build({ allowedOrigins: [entry] }), entry).toThrow(
        /allowedOrigins/,
      )
    }
    expect(() => build({ allowedOrigins: ['*'] })).toThrow(/allowedOrigins/)
    expect(() => build({ allowedOrigins: ['no es una url'] })).toThrow(
      /allowedOrigins/,
    )
  })

  it('mensaje_de_origin_se_puede_sobrescribir_con_errorMessages', async () => {
    const app = build({ errorMessages: { originNotAllowed: 'Origin denied' } })

    const res = await postGetCode(app, { Origin: EVIL_ORIGIN })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Origin denied' },
    })
  })
})

describe('evaAuthRoutes — métodos', () => {
  it('get_con_origin_foraneo_no_se_verifica', async () => {
    const res = await evaAuthRoutes().request(`${SAME_ORIGIN}/me`, {
      headers: { Origin: EVIL_ORIGIN },
    })

    // Sin cookie llega al handler (401), no se corta en el guard (403).
    expect(res.status).toBe(401)
  })

  it.each(['PATCH', 'DELETE', 'POST'] as const)(
    '%s_con_origin_foraneo_responde_403',
    async (method) => {
      const path = method === 'POST' ? '/logout' : '/me'
      const res = await evaAuthRoutes().request(`${SAME_ORIGIN}${path}`, {
        method,
        headers: { Origin: EVIL_ORIGIN },
      })

      expect(res.status).toBe(403)
    },
  )

  it('el_esquema_no_cuenta_en_el_default_tras_un_proxy_que_termina_tls', async () => {
    // El Worker/Node detrás de un proxy ve `http://` pero el navegador manda `https://`.
    const res = await postGetCode(evaAuthRoutes(), {
      Origin: 'https://app.test',
    })

    expect(res.status).toBe(200)
  })
})

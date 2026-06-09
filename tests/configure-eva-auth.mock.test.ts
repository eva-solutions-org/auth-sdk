/**
 * Suite dedicada para configureEvaAuth y getAuthUrl — v2.0.0
 *
 * Usa config REAL (no mock) + vi.resetModules() por test para aislamiento total del estado
 * de módulo (_runtimeConfig). Patrón M-3: sin __resetEvaAuthConfig exportado.
 *
 * Convención: cada test hace dynamic import después de vi.resetModules() para obtener
 * una instancia fresca del módulo con _runtimeConfig = {}.
 *
 * Tests eliminados en v2.0.0 (authUrl eliminado, EVA_AUTH_URL ignorado, JWKS cache invalidation):
 *   - Tests 2, 3 (idempotencia authUrl)
 *   - Describe "validación authUrl (B-1)" completo (tests 5-7)
 *   - Tests 10, 11 (precedencia runtime/env)
 *   - Tests 13-18 (EVA_AUTH_URL edge cases)
 *   - Tests 19-21 (JWKS cache invalidation)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// FAKE_BUILD_TIME_URL: valor stubbeado directamente en __EVA_AUTH_URL__ global.
// No pasa por validateHttpsUrl (getAuthUrl() retorna BUILD_TIME_AUTH_URL sin validar).
// Puede ser cualquier valor string — se usa http://build-time.test para distinguirlo del stub real.
const FAKE_BUILD_TIME_URL = 'http://build-time.test'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubGlobal('__EVA_AUTH_URL__', FAKE_BUILD_TIME_URL)
  vi.stubGlobal('__EVA_ENV__', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function importConfig() {
  return import('../src/config') as Promise<{
    configureEvaAuth: (opts: { cookieDomain?: string; errorMessages?: unknown; errorWire?: string }) => void
    getAuthUrl: () => string
    getCookieDomain: () => string | undefined
    getEvaEnv: () => string
  }>
}

// ─── getAuthUrl: build-time puro (REQ-URL-01, REQ-URL-02, REQ-URL-03) ────────

describe('getAuthUrl — build-time puro', () => {
  it('sin configurar: getAuthUrl retorna el valor build-time stub', async () => {
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
  })

  it('configureEvaAuth({}) no muta getAuthUrl — sigue retornando build-time', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({})
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
  })

  it('edge runtime sin process global — getAuthUrl no lanza (usa build-time)', async () => {
    const originalProcess = globalThis.process
    // @ts-ignore
    delete globalThis.process
    try {
      const { getAuthUrl } = await importConfig()
      expect(() => getAuthUrl()).not.toThrow()
      expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    } finally {
      globalThis.process = originalProcess
    }
  })
})

// ─── configureEvaAuth: idempotencia y campos ──────────────────────────────────

describe('configureEvaAuth — idempotencia y campos', () => {
  it('1: segunda llamada con cookieDomain distinto gana (idempotencia, sobrescritura)', async () => {
    const { configureEvaAuth, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.a.com' })
    configureEvaAuth({ cookieDomain: '.b.com' })
    expect(getCookieDomain()).toBe('.b.com')
  })

  it('4: solo cookieDomain — no afecta getAuthUrl (retorna build-time)', async () => {
    const { configureEvaAuth, getAuthUrl, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.x.com' })
    expect(getCookieDomain()).toBe('.x.com')
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
  })
})

// ─── configureEvaAuth: validación de cookieDomain (M-2) ──────────────────────

describe('configureEvaAuth — validación cookieDomain (M-2, header injection)', () => {
  it('8a: throw si cookieDomain contiene semicolon', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ cookieDomain: '.x.com; HttpOnly' }))
      .toThrow(/caracteres prohibidos/)
  })

  it('8b: throw si cookieDomain contiene CRLF', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ cookieDomain: '.x.com\r\nSet-Cookie: evil=1' }))
      .toThrow(/caracteres prohibidos/)
  })

  it('8c: throw si cookieDomain contiene LF solo', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ cookieDomain: '.x.com\nfoo' }))
      .toThrow(/caracteres prohibidos/)
  })

  it('9: cookieDomain inválido NO actualiza _runtimeConfig', async () => {
    const { configureEvaAuth, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.valid.com' })
    expect(() => configureEvaAuth({ cookieDomain: '.x.com; evil' })).toThrow()
    expect(getCookieDomain()).toBe('.valid.com')
  })
})

// ─── configureEvaAuth: D-07 warn al pasar campo authUrl eliminado ─────────────

describe('configureEvaAuth — D-07 warn (REQ-CFG-02)', () => {
  it('emite console.warn cuando se pasa authUrl (campo eliminado en v2.0.0)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { configureEvaAuth } = await importConfig()

    // Cast necesario: authUrl fue eliminado del tipo ConfigureEvaAuthOptions.
    // En JS puro, el campo extra activa el guard D-07.
    ;(configureEvaAuth as (opts: Record<string, unknown>) => void)({ authUrl: 'https://x.com' })

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('authUrl'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('v2.0.0'))
    warnSpy.mockRestore()
  })

  it('configureEvaAuth({ cookieDomain }) NO emite warn (campo válido)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { configureEvaAuth } = await importConfig()

    configureEvaAuth({ cookieDomain: '.x.com' })

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ─── configureEvaAuth: regression — errorMessages y errorWire (REQ-CFG-03..07) ─

describe('configureEvaAuth — regression errorMessages/errorWire (REQ-CFG-03, REQ-CFG-05)', () => {
  it('errorWire "api" es válido y no lanza', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ errorWire: 'api' })).not.toThrow()
  })

  it('errorWire "string" es válido y no lanza', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ errorWire: 'string' })).not.toThrow()
  })

  it('errorWire inválido lanza error', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() =>
      (configureEvaAuth as (opts: Record<string, unknown>) => void)({ errorWire: 'invalid' }),
    ).toThrow(/errorWire/)
  })
})

// ─── Zero regression y edge runtimes ─────────────────────────────────────────

describe('zero regression y edge runtimes', () => {
  it('22: sin configurar — getAuthUrl retorna build-time, getCookieDomain retorna undefined', async () => {
    const { getAuthUrl, getCookieDomain } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(getCookieDomain()).toBeUndefined()
  })

  it('23: edge runtime sin process global — getAuthUrl no lanza (usa build-time)', async () => {
    // Simular que globalThis.process no existe (Cloudflare Workers sin binding)
    const originalProcess = globalThis.process
    // @ts-ignore
    delete globalThis.process
    try {
      const { getAuthUrl } = await importConfig()
      expect(() => getAuthUrl()).not.toThrow()
      expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    } finally {
      globalThis.process = originalProcess
    }
  })
})

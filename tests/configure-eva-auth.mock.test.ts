/**
 * Suite dedicada para configureEvaAuth y getAuthUrl.
 *
 * Usa config REAL (no mock) + vi.resetModules() por test para aislamiento total del estado
 * de módulo (_runtimeConfig). Patrón M-3: sin __resetEvaAuthConfig exportado.
 *
 * Convención: cada test hace dynamic import después de vi.resetModules() para obtener
 * una instancia fresca del módulo con _runtimeConfig = {}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// BUILD_TIME_AUTH_URL que tsup hornea. En tests el valor es el fallback de globals.d.ts.
// Vi no substituye __EVA_AUTH_URL__ — el módulo al importarse usará el valor declarado
// en el define de tsup. En el entorno de test (vitest sin tsup) __EVA_AUTH_URL__ no está
// definido como global. Necesitamos un fallback. Lo hacemos vía vi.stubGlobal antes de importar.
const FAKE_BUILD_TIME_URL = 'http://build-time.test'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  // Stubear las globales de build-time que tsup define normalmente
  vi.stubGlobal('__EVA_AUTH_URL__', FAKE_BUILD_TIME_URL)
  vi.stubGlobal('__EVA_ENV__', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function importConfig() {
  return import('../src/config') as Promise<{
    configureEvaAuth: (opts: { authUrl?: string; cookieDomain?: string }) => void
    getAuthUrl: () => string
    getCookieDomain: () => string | undefined
    getEvaEnv: () => string
  }>
}

// ─── configureEvaAuth: idempotencia y campos ──────────────────────────────────

describe('configureEvaAuth — idempotencia y campos', () => {
  it('1: segunda llamada con cookieDomain distinto gana (idempotencia, sobrescritura)', async () => {
    const { configureEvaAuth, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.a.com' })
    configureEvaAuth({ cookieDomain: '.b.com' })
    expect(getCookieDomain()).toBe('.b.com')
  })

  it('2: campo undefined preserva valor previo (no resetea)', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://x.com' })
    configureEvaAuth({ authUrl: undefined, cookieDomain: '.x.com' })
    expect(getAuthUrl()).toBe('https://x.com')
  })

  it('3: objeto vacío es no-op (no muta estado previo)', async () => {
    const { configureEvaAuth, getAuthUrl, getCookieDomain } = await importConfig()
    configureEvaAuth({ authUrl: 'https://x.com', cookieDomain: '.x.com' })
    configureEvaAuth({})
    expect(getAuthUrl()).toBe('https://x.com')
    expect(getCookieDomain()).toBe('.x.com')
  })

  it('4: solo cookieDomain — no afecta getAuthUrl (fallback a build-time)', async () => {
    const { configureEvaAuth, getAuthUrl, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.x.com' })
    expect(getCookieDomain()).toBe('.x.com')
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
  })
})

// ─── configureEvaAuth: validación de authUrl ─────────────────────────────────

describe('configureEvaAuth — validación authUrl (B-1)', () => {
  it('5: throw con mensaje exacto si authUrl no es parseable', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: 'no-es-url' }))
      .toThrow(/EVA_AUTH_URL inválida: no-es-url/)
  })

  it('6a: throw protocolo no soportado — javascript:', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: 'javascript:alert(1)' }))
      .toThrow(/protocolo no soportado/)
  })

  it('6b: throw protocolo no soportado — data:', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: 'data:text/html,<script>alert(1)</script>' }))
      .toThrow(/protocolo no soportado/)
  })

  it('6c: throw protocolo no soportado — file:', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: 'file:///etc/passwd' }))
      .toThrow(/protocolo no soportado/)
  })

  it('6d: throw protocolo no soportado — ftp:', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: 'ftp://server/path' }))
      .toThrow(/protocolo no soportado/)
  })

  it('7: authUrl inválida NO actualiza _runtimeConfig (estado previo preservado)', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://valid.com' })
    expect(() => configureEvaAuth({ authUrl: 'javascript:alert(1)' })).toThrow()
    // El authUrl previo sigue intacto
    expect(getAuthUrl()).toBe('https://valid.com')
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

// ─── getAuthUrl: precedencia ──────────────────────────────────────────────────

describe('getAuthUrl — precedencia (REQ-DF-010)', () => {
  it('10: runtime > env > build-time', async () => {
    vi.stubEnv('EVA_AUTH_URL', 'https://from-env.com')
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://from-runtime.com' })
    expect(getAuthUrl()).toBe('https://from-runtime.com')
  })

  it('11: env gana sobre build-time cuando runtime no está configurado', async () => {
    vi.stubEnv('EVA_AUTH_URL', 'https://from-env.com')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe('https://from-env.com')
  })

  it('12: build-time es fallback cuando no hay runtime ni env', async () => {
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
  })
})

// ─── getAuthUrl: manejo de EVA_AUTH_URL (B-2) ────────────────────────────────

describe('getAuthUrl — EVA_AUTH_URL edge cases (B-2)', () => {
  it('13: string vacío "" → fallback silencioso a build-time (sin warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EVA_AUTH_URL', '')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('14: whitespace-only "   " → fallback silencioso a build-time (sin warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EVA_AUTH_URL', '   \t')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('15: string literal "undefined" → warn + fallback a build-time', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EVA_AUTH_URL', 'undefined')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EVA_AUTH_URL inválida'))
    warnSpy.mockRestore()
  })

  it('16: string literal "null" → warn + fallback a build-time', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EVA_AUTH_URL', 'null')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('17: protocolo no soportado en env (javascript:) → warn + fallback (no throw)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EVA_AUTH_URL', 'javascript:alert(1)')
    const { getAuthUrl } = await importConfig()
    expect(() => getAuthUrl()).not.toThrow()
    expect(getAuthUrl()).toBe(FAKE_BUILD_TIME_URL)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('protocolo no soportado'))
    warnSpy.mockRestore()
  })

  it('18: URL válida en env (https:) → se usa directamente', async () => {
    vi.stubEnv('EVA_AUTH_URL', 'https://valid-env.com')
    const { getAuthUrl } = await importConfig()
    expect(getAuthUrl()).toBe('https://valid-env.com')
  })
})

// ─── JWKS cache invalidation (B-3) ────────────────────────────────────────────

describe('configureEvaAuth — JWKS cache invalidation (B-3)', () => {
  it('19: cambiar authUrl invalida cache JWKS (clearCache llamado)', async () => {
    const clearCacheSpy = vi.fn()
    vi.doMock('../src/jwks-cache', () => ({
      clearCache: clearCacheSpy,
      cachedKey: null,
      cachedEtag: null,
      cachedAt: 0,
      pendingFetch: null,
      setCached: vi.fn(),
      refreshCachedAt: vi.fn(),
      setPendingFetch: vi.fn(),
    }))
    const { configureEvaAuth } = await importConfig()

    configureEvaAuth({ authUrl: 'https://a.com' })  // prev=undefined → cambia → clearCache
    expect(clearCacheSpy).toHaveBeenCalledTimes(1)

    configureEvaAuth({ authUrl: 'https://b.com' })  // prev=a → cambia → clearCache
    expect(clearCacheSpy).toHaveBeenCalledTimes(2)
  })

  it('20: mismo authUrl NO invalida cache (idempotencia)', async () => {
    const clearCacheSpy = vi.fn()
    vi.doMock('../src/jwks-cache', () => ({
      clearCache: clearCacheSpy,
      cachedKey: null,
      cachedEtag: null,
      cachedAt: 0,
      pendingFetch: null,
      setCached: vi.fn(),
      refreshCachedAt: vi.fn(),
      setPendingFetch: vi.fn(),
    }))
    const { configureEvaAuth } = await importConfig()

    configureEvaAuth({ authUrl: 'https://a.com' })  // primera vez → clearCache (1)
    configureEvaAuth({ authUrl: 'https://a.com' })  // idéntico → NO clearCache
    expect(clearCacheSpy).toHaveBeenCalledTimes(1)
  })

  it('21: solo cookieDomain NO invalida cache JWKS', async () => {
    const clearCacheSpy = vi.fn()
    vi.doMock('../src/jwks-cache', () => ({
      clearCache: clearCacheSpy,
      cachedKey: null,
      cachedEtag: null,
      cachedAt: 0,
      pendingFetch: null,
      setCached: vi.fn(),
      refreshCachedAt: vi.fn(),
      setPendingFetch: vi.fn(),
    }))
    const { configureEvaAuth } = await importConfig()

    configureEvaAuth({ cookieDomain: '.x.com' })  // sin authUrl → sin invalidación
    expect(clearCacheSpy).not.toHaveBeenCalled()
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

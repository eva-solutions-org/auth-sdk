/**
 * Suite dedicada para configureEvaAuth y getAuthUrl — authUrl en runtime (v3).
 *
 * Usa config REAL (no mock) + vi.resetModules() por test para aislamiento total del estado
 * de módulo (_runtimeConfig). Patrón M-3: sin __resetEvaAuthConfig exportado.
 *
 * Convención: cada test hace dynamic import después de vi.resetModules() para obtener
 * una instancia fresca del módulo con _runtimeConfig = {}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.stubGlobal('__EVA_ENV__', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function importConfig() {
  return import('../src/config') as Promise<typeof import('../src/config')>
}

const CONFIG_ERROR_MESSAGE =
  '[eva-auth-sdk] authUrl no configurada: llama configureEvaAuth({ authUrl }) al arrancar'

// ─── authUrl: formas aceptadas (REQ-SDK-01..03) ──────────────────────────────

describe('configureEvaAuth — authUrl aceptada', () => {
  it('accepts_https: https se guarda y getAuthUrl lo retorna', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://auth.example.com' })
    expect(getAuthUrl()).toBe('https://auth.example.com')
  })

  it.each([
    ['http://localhost:4000', 'http://localhost:4000'],
    ['http://127.0.0.1:4000', 'http://127.0.0.1:4000'],
    ['http://[::1]:4000', 'http://[::1]:4000'],
  ])('accepts_loopback_http: %s', async (input, expected) => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: input })
    expect(getAuthUrl()).toBe(expected)
  })

  it.each([
    ['https://host.com/auth/', 'https://host.com/auth'],
    ['https://host.com/auth', 'https://host.com/auth'],
    ['https://Host.COM/', 'https://host.com'],
    ['https://host.com/a/b/', 'https://host.com/a/b'],
  ])('accepts_path_and_normalizes: %s', async (input, expected) => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: input })
    expect(getAuthUrl()).toBe(expected)
  })
})

// ─── authUrl: formas rechazadas (REQ-SDK-04..11) ─────────────────────────────

describe('configureEvaAuth — authUrl rechazada', () => {
  it.each([
    ['rejects_remote_http', 'http://auth.example.com', /https/],
    ['rejects_malformed', 'not a url', /malformada/],
    ['rejects_ftp_scheme', 'ftp://host', /protocolo no soportado/],
    ['rejects_javascript_scheme', 'javascript:alert(1)', /protocolo no soportado/],
    ['rejects_userinfo', 'https://user:pass@host.com', /credenciales/],
    ['rejects_query', 'https://host.com/?a=1', /query/],
    ['rejects_bare_question_mark', 'https://host.com/auth?', /query/],
    ['rejects_hash', 'https://host.com/#frag', /fragmento/],
    ['rejects_bare_hash', 'https://host.com/auth#', /fragmento/],
  ])('%s', async (_name, input, messagePattern) => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    expect(() => configureEvaAuth({ authUrl: input })).toThrow(/^\[eva-auth-sdk\]/)
    expect(() => configureEvaAuth({ authUrl: input })).toThrow(messagePattern)
    // El rechazo no deja nada configurado.
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
  })

  it('never_echoes_userinfo: ni usuario, ni contraseña, ni query/fragmento aparecen en el mensaje', async () => {
    const { configureEvaAuth } = await importConfig()
    const inputs = [
      'https://admin:s3cret@host.com',
      'https://admin:s3cret@host.com/path?token=qsecret',
      'https://admin:s3cret@host.com/path#fsecret',
      'http://admin:s3cret@evil.com',
      'https://admin:s3cret@',
      'https://host.com/auth?token=qsecret',
      'https://host.com/auth#fsecret',
    ]
    for (const input of inputs) {
      let message = ''
      try {
        configureEvaAuth({ authUrl: input })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message, input).not.toBe('')
      expect(message, input).not.toContain('admin')
      expect(message, input).not.toContain('s3cret')
      expect(message, input).not.toContain('qsecret')
      expect(message, input).not.toContain('fsecret')
    }
  })

  it('rejects_opaque_path_schemes_without_echo: mailto/redis/data no se ecoan en el mensaje', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    for (const input of ['mailto:admin:s3cret@x', 'redis:s3cret@host', 'data:text/plain,s3cret']) {
      let message = ''
      try {
        configureEvaAuth({ authUrl: input })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message, input).toMatch(/^\[eva-auth-sdk\] authUrl inválida: protocolo no soportado/)
      expect(message, input).not.toContain('admin')
      expect(message, input).not.toContain('s3cret')
      expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
    }
  })

  it('rejects_non_string_authUrl: null, número y URL lanzan error fijo y no mutan', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    const inputs: unknown[] = [null, 42, new URL('https://host.com')]
    for (const input of inputs) {
      expect(() => configureEvaAuth({ authUrl: input as string }), String(input)).toThrow(
        '[eva-auth-sdk] authUrl inválida: debe ser string',
      )
    }
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
  })
})

// ─── authUrl omitida (REQ-SDK-12) ────────────────────────────────────────────

describe('configureEvaAuth — authUrl omitida', () => {
  it('ignores_undefined_authUrl: ausente o undefined explícito no valida ni muta', async () => {
    const { configureEvaAuth, getAuthUrl, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.a.com' })
    configureEvaAuth({ authUrl: undefined, cookieDomain: '.b.com' })
    expect(getCookieDomain()).toBe('.b.com')
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
  })

  it('configureEvaAuth({}) no configura authUrl', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({})
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
  })
})

// ─── getAuthUrl sin configurar y error de configuración (REQ-SDK-14..16) ─────

describe('getAuthUrl — sin configurar', () => {
  it('get_auth_url_throws_documented_config_error', async () => {
    const { getAuthUrl } = await importConfig()
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
  })

  it('config_error_name_and_predicate: el predicado distingue el error de config de un Error común', async () => {
    const { getAuthUrl, isEvaAuthConfigError } = await importConfig()
    let configError: unknown
    try {
      getAuthUrl()
    } catch (err) {
      configError = err
    }
    expect((configError as Error).name).toBe('EvaAuthConfigError')
    expect(isEvaAuthConfigError(configError)).toBe(true)
    expect(isEvaAuthConfigError(new Error('x'))).toBe(false)
    expect(isEvaAuthConfigError('EvaAuthConfigError')).toBe(false)
  })

  it('errores de validación de configureEvaAuth NO son errores de configuración (D-05)', async () => {
    const { configureEvaAuth, isEvaAuthConfigError } = await importConfig()
    let validationError: unknown
    try {
      configureEvaAuth({ authUrl: 'http://auth.example.com' })
    } catch (err) {
      validationError = err
    }
    expect(validationError).toBeInstanceOf(Error)
    expect(isEvaAuthConfigError(validationError)).toBe(false)
  })

  it('imports_and_evaAuth_construction_are_side_effect_free: importar cada entry y construir evaAuth() no lanza', async () => {
    // Los 8 entry points de tsdown.config.ts.
    await expect(import('../src/index')).resolves.toBeDefined()
    await expect(import('../src/generic/index')).resolves.toBeDefined()
    await expect(import('../src/hono-openapi/index')).resolves.toBeDefined()
    await expect(import('../src/react/index')).resolves.toBeDefined()
    await expect(import('../src/webhooks/index')).resolves.toBeDefined()
    await expect(import('../src/admin/index')).resolves.toBeDefined()
    await expect(import('../src/s2s/index')).resolves.toBeDefined()
    const hono = await import('../src/hono/index')
    expect(() => hono.evaAuth()).not.toThrow()
  })
})

// ─── Inmutabilidad (REQ-SDK-17..19) ──────────────────────────────────────────

describe('configureEvaAuth — inmutabilidad de authUrl', () => {
  it('equal_normalized_is_noop: mismo valor normalizado no lanza y no cambia', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://Host.com/auth' })
    expect(() => configureEvaAuth({ authUrl: 'https://host.com/auth/' })).not.toThrow()
    expect(getAuthUrl()).toBe('https://host.com/auth')
  })

  it('different_authUrl_throws_immutable: otro valor lanza y conserva el anterior', async () => {
    const { configureEvaAuth, getAuthUrl } = await importConfig()
    configureEvaAuth({ authUrl: 'https://a.com' })
    expect(() => configureEvaAuth({ authUrl: 'https://b.com' })).toThrow(
      '[eva-auth-sdk] authUrl ya fue configurada y no puede cambiar en runtime',
    )
    expect(getAuthUrl()).toBe('https://a.com')
  })

  it('immutability_failure_commits_no_other_field: el rechazo no confirma cookieDomain', async () => {
    const { configureEvaAuth, getCookieDomain } = await importConfig()
    configureEvaAuth({ authUrl: 'https://a.com', cookieDomain: '.old.com' })
    expect(() => configureEvaAuth({ authUrl: 'https://b.com', cookieDomain: '.new.com' })).toThrow(
      /no puede cambiar/,
    )
    expect(getCookieDomain()).toBe('.old.com')
  })
})

// ─── Atomicidad (REQ-SDK-20) ─────────────────────────────────────────────────

describe('configureEvaAuth — atomicidad entre campos', () => {
  it('invalid_field_leaves_nothing_changed: errorWire inválido impide confirmar authUrl', async () => {
    const { configureEvaAuth, getAuthUrl, getErrorWire } = await importConfig()
    expect(() =>
      (configureEvaAuth as (opts: Record<string, unknown>) => void)({
        authUrl: 'https://a.com',
        errorWire: 'invalid',
      }),
    ).toThrow(/errorWire/)
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
    expect(getErrorWire()).toBe('api')
  })

  it('cookieDomain inválido impide confirmar authUrl y errorWire', async () => {
    const { configureEvaAuth, getAuthUrl, getErrorWire } = await importConfig()
    expect(() =>
      configureEvaAuth({ authUrl: 'https://a.com', errorWire: 'string', cookieDomain: '.x.com; evil' }),
    ).toThrow(/caracteres prohibidos/)
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
    expect(getErrorWire()).toBe('api')
  })
})

// ─── Sin warn de migración (REQ-SDK-23) ──────────────────────────────────────

describe('configureEvaAuth — sin console.warn', () => {
  it('does_not_warn_on_valid_config', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { configureEvaAuth } = await importConfig()
    configureEvaAuth({ authUrl: 'https://a.com', cookieDomain: '.x.com', errorWire: 'string' })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ─── Campos y edge runtimes ──────────────────────────────────────────────────

describe('configureEvaAuth — cookieDomain', () => {
  it('1: segunda llamada con cookieDomain distinto gana (sobrescritura)', async () => {
    const { configureEvaAuth, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.a.com' })
    configureEvaAuth({ cookieDomain: '.b.com' })
    expect(getCookieDomain()).toBe('.b.com')
  })

  it('4: solo cookieDomain — no configura authUrl', async () => {
    const { configureEvaAuth, getAuthUrl, getCookieDomain } = await importConfig()
    configureEvaAuth({ cookieDomain: '.x.com' })
    expect(getCookieDomain()).toBe('.x.com')
    expect(() => getAuthUrl()).toThrow(CONFIG_ERROR_MESSAGE)
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

// ─── configureEvaAuth: regression — errorWire (REQ-CFG-05) ───────────────────

describe('configureEvaAuth — regression errorWire (REQ-CFG-05)', () => {
  it('errorWire "api" es válido y no lanza', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() => configureEvaAuth({ errorWire: 'api' })).not.toThrow()
  })

  it('errorWire "string" es válido y se refleja en getErrorWire', async () => {
    const { configureEvaAuth, getErrorWire } = await importConfig()
    configureEvaAuth({ errorWire: 'string' })
    expect(getErrorWire()).toBe('string')
  })

  it('errorWire inválido lanza error', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() =>
      (configureEvaAuth as (opts: Record<string, unknown>) => void)({ errorWire: 'invalid' }),
    ).toThrow(/errorWire/)
  })
})

// ─── Zero regression y edge runtimes ─────────────────────────────────────────

describe('edge runtimes', () => {
  it('sin process global: configurar y leer authUrl funciona (el estado es una variable de módulo)', async () => {
    const originalProcess = globalThis.process
    // @ts-ignore
    delete globalThis.process
    try {
      const { configureEvaAuth, getAuthUrl } = await importConfig()
      configureEvaAuth({ authUrl: 'https://edge.example.com' })
      expect(getAuthUrl()).toBe('https://edge.example.com')
    } finally {
      globalThis.process = originalProcess
    }
  })

  it('sin configurar — getCookieDomain retorna undefined', async () => {
    const { getCookieDomain } = await importConfig()
    expect(getCookieDomain()).toBeUndefined()
  })
})

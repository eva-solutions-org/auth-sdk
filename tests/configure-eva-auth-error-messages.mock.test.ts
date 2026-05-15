/**
 * T-41: Tests de configureEvaAuth({ errorMessages }) + getErrorMessages + validateErrorMessagesInput.
 * Usa config REAL + vi.resetModules() para aislamiento total de _runtimeConfig.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

async function importConfig() {
  return import('../src/config') as Promise<typeof import('../src/config')>
}

describe('configureEvaAuth — errorMessages setter y getter', () => {
  it('set via configureEvaAuth persiste en getErrorMessages', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: 'Auth required' } })
    expect(getErrorMessages()).toEqual({ authRequired: 'Auth required' })
  })

  it('undefined no resetea el valor previo (idempotencia parcial)', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: 'X' } })
    configureEvaAuth({ errorMessages: undefined })
    expect(getErrorMessages()?.authRequired).toBe('X')
  })

  it('segunda llamada sobrescribe keys provistas', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: 'Primera' } })
    configureEvaAuth({ errorMessages: { authRequired: 'Segunda' } })
    expect(getErrorMessages()?.authRequired).toBe('Segunda')
  })

  it('sin configurar errorMessages — getErrorMessages retorna undefined', async () => {
    const { getErrorMessages } = await importConfig()
    expect(getErrorMessages()).toBeUndefined()
  })

  it('partial override solo afecta las keys provistas', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: 'X', loginFailed: 'Y' } })
    const msgs = getErrorMessages()
    expect(msgs?.authRequired).toBe('X')
    expect(msgs?.loginFailed).toBe('Y')
    // keys no provistas no están en el parcial
    expect(msgs?.tokenInvalid).toBeUndefined()
  })

  it('string vacío "" se guarda como override válido', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: '' } })
    expect(getErrorMessages()?.authRequired).toBe('')
  })
})

describe('configureEvaAuth — validación Zod (M4)', () => {
  it('throw con key desconocida — mensaje incluye el path de Zod', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() =>
      // @ts-expect-error — test intencional de key inválida
      configureEvaAuth({ errorMessages: { unknownKey: 'foo' } }),
    ).toThrow(/eva-auth-sdk/)
  })

  it('throw con key desconocida — mensaje incluye el nombre de la key', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() =>
      // @ts-expect-error — test intencional de key inválida
      configureEvaAuth({ errorMessages: { badKey: 'foo' } }),
    ).toThrow(/badKey/)
  })

  it('throw con valor non-string', async () => {
    const { configureEvaAuth } = await importConfig()
    expect(() =>
      // @ts-expect-error — test intencional de tipo incorrecto
      configureEvaAuth({ errorMessages: { authRequired: 42 } }),
    ).toThrow(/eva-auth-sdk/)
  })

  it('estado previo no se corrompe si throw en validación', async () => {
    const { configureEvaAuth, getErrorMessages } = await importConfig()
    configureEvaAuth({ errorMessages: { authRequired: 'válido' } })
    expect(() =>
      // @ts-expect-error
      configureEvaAuth({ errorMessages: { invalidKey: 'x' } }),
    ).toThrow()
    // El valor previo sigue intacto
    expect(getErrorMessages()?.authRequired).toBe('válido')
  })
})

describe('validateErrorMessagesInput', () => {
  it('retorna el input si es válido', async () => {
    const { validateErrorMessagesInput } = await importConfig()
    const input = { authRequired: 'X', loginFailed: 'Y' }
    expect(validateErrorMessagesInput(input)).toEqual(input)
  })

  it('throw si key desconocida', async () => {
    const { validateErrorMessagesInput } = await importConfig()
    expect(() =>
      // @ts-expect-error
      validateErrorMessagesInput({ unknownKey: 'x' }),
    ).toThrow(/eva-auth-sdk/)
  })

  it('throw si valor no es string', async () => {
    const { validateErrorMessagesInput } = await importConfig()
    expect(() =>
      // @ts-expect-error
      validateErrorMessagesInput({ authRequired: 123 }),
    ).toThrow(/eva-auth-sdk/)
  })

  it('objeto vacío es válido (Partial — todas las keys opcionales)', async () => {
    const { validateErrorMessagesInput } = await importConfig()
    expect(() => validateErrorMessagesInput({})).not.toThrow()
    expect(validateErrorMessagesInput({})).toEqual({})
  })
})

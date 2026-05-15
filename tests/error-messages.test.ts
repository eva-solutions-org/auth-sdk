/**
 * T-40: Tests de error-messages.ts
 * - DEFAULT_ERROR_MESSAGES inmutable (Object.freeze)
 * - resolveErrorMessages precedencia
 * - formatMessage placeholder {0}
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ERROR_MESSAGES,
  resolveErrorMessages,
  formatMessage,
  type EvaErrorMessages,
} from '../src/error-messages'

describe('DEFAULT_ERROR_MESSAGES', () => {
  it('tiene exactamente 16 keys', () => {
    expect(Object.keys(DEFAULT_ERROR_MESSAGES)).toHaveLength(16)
  })

  it('contiene todas las keys requeridas', () => {
    const requiredKeys: (keyof EvaErrorMessages)[] = [
      'authRequired', 'tokenInvalid', 'tokenExpired', 'tokenClaimsInvalid',
      'tokenNotFound', 'verifyFailedAfterRefresh', 'refreshNoNewTokens', 'refreshFailed',
      'loginFailed', 'registrationFailed', 'logoutFailed', 'invalidJsonBody',
      'invalidPhone', 'invalidUpdateBody', 'sessionInvalid', 'internalError',
    ]
    for (const key of requiredKeys) {
      expect(DEFAULT_ERROR_MESSAGES).toHaveProperty(key)
    }
  })

  it('todos los valores son strings no vacíos', () => {
    for (const [key, val] of Object.entries(DEFAULT_ERROR_MESSAGES)) {
      expect(typeof val, `key ${key}`).toBe('string')
      expect(val.length, `key ${key}`).toBeGreaterThan(0)
    }
  })

  it('es inmutable (Object.freeze — no se puede mutar)', () => {
    expect(Object.isFrozen(DEFAULT_ERROR_MESSAGES)).toBe(true)
  })

  it('no se puede asignar una propiedad al objeto frozen', () => {
    expect(() => {
      // @ts-expect-error — test intencional de mutación prohibida
      DEFAULT_ERROR_MESSAGES.authRequired = 'hacked'
    }).toThrow()
  })

  it('regression-lock: strings defaults exactos del SDK actual', () => {
    expect(DEFAULT_ERROR_MESSAGES.authRequired).toBe('Autenticación requerida')
    expect(DEFAULT_ERROR_MESSAGES.tokenInvalid).toBe('Tokens no válidos')
    expect(DEFAULT_ERROR_MESSAGES.tokenExpired).toBe('Token expirado')
    expect(DEFAULT_ERROR_MESSAGES.tokenNotFound).toBe('Token de acceso no encontrado')
    expect(DEFAULT_ERROR_MESSAGES.refreshNoNewTokens).toBe('El refresco no retornó nuevos tokens')
    expect(DEFAULT_ERROR_MESSAGES.refreshFailed).toBe('Falló el refresco de tokens')
    expect(DEFAULT_ERROR_MESSAGES.loginFailed).toBe('Teléfono o código inválido')
    expect(DEFAULT_ERROR_MESSAGES.logoutFailed).toBe('Logout fallido')
    expect(DEFAULT_ERROR_MESSAGES.invalidJsonBody).toBe('JSON inválido en el body')
    expect(DEFAULT_ERROR_MESSAGES.invalidPhone).toBe('Teléfono inválido')
    expect(DEFAULT_ERROR_MESSAGES.invalidUpdateBody).toBe('Cuerpo de actualización vacío')
    expect(DEFAULT_ERROR_MESSAGES.sessionInvalid).toBe('ID de sesión inválido')
  })
})

describe('resolveErrorMessages', () => {
  it('sin overrides — retorna defaults exactos', () => {
    const result = resolveErrorMessages()
    expect(result).toEqual(DEFAULT_ERROR_MESSAGES)
  })

  it('global override pisa defaults', () => {
    const result = resolveErrorMessages(undefined, { authRequired: 'Auth required' })
    expect(result.authRequired).toBe('Auth required')
    // el resto sigue siendo default
    expect(result.tokenInvalid).toBe(DEFAULT_ERROR_MESSAGES.tokenInvalid)
  })

  it('local override pisa global y defaults', () => {
    const result = resolveErrorMessages(
      { authRequired: 'Local override' },
      { authRequired: 'Global override', tokenInvalid: 'Bad token' },
    )
    expect(result.authRequired).toBe('Local override')
    expect(result.tokenInvalid).toBe('Bad token')
    expect(result.loginFailed).toBe(DEFAULT_ERROR_MESSAGES.loginFailed)
  })

  it('local override pisa global cuando ambos definen la misma key', () => {
    const result = resolveErrorMessages(
      { loginFailed: 'Local login error' },
      { loginFailed: 'Global login error' },
    )
    expect(result.loginFailed).toBe('Local login error')
  })

  it('key no provista en local cae al global', () => {
    const result = resolveErrorMessages(
      { authRequired: 'Local' },
      { tokenInvalid: 'Global token', authRequired: 'Global auth' },
    )
    expect(result.authRequired).toBe('Local')
    expect(result.tokenInvalid).toBe('Global token')
  })

  it('string vacío "" se respeta como override explícito (no cae al default)', () => {
    const result = resolveErrorMessages({ authRequired: '' })
    expect(result.authRequired).toBe('')
  })

  it('string vacío "" en global se respeta', () => {
    const result = resolveErrorMessages(undefined, { authRequired: '' })
    expect(result.authRequired).toBe('')
  })

  it('undefined en local sobreescribe con undefined — spread estándar JS', () => {
    const result = resolveErrorMessages(
      { authRequired: undefined },
      { authRequired: 'Global' },
    )
    // spread en JS: { ...base, key: undefined } sobreescribe con undefined
    // Por eso resolveErrorMessages recomienda omitir la key (no pasar undefined explícito)
    expect(result.authRequired).toBeUndefined()
  })

  it('partial override — solo cambia las keys provistas', () => {
    const result = resolveErrorMessages({ authRequired: 'X' })
    expect(result.authRequired).toBe('X')
    expect(result.tokenInvalid).toBe(DEFAULT_ERROR_MESSAGES.tokenInvalid)
    expect(result.loginFailed).toBe(DEFAULT_ERROR_MESSAGES.loginFailed)
    expect(Object.keys(result)).toHaveLength(16)
  })
})

describe('formatMessage', () => {
  it('reemplaza placeholder {0}', () => {
    expect(formatMessage('Error: {0}', 'detalle')).toBe('Error: detalle')
  })

  it('reemplaza placeholder en verifyFailedAfterRefresh', () => {
    const template = DEFAULT_ERROR_MESSAGES.verifyFailedAfterRefresh
    const result = formatMessage(template, 'token expirado')
    expect(result).toBe('Verificación fallida tras refresh: token expirado')
  })

  it('sin args — placeholder queda vacío', () => {
    expect(formatMessage('Error: {0}')).toBe('Error: ')
  })

  it('más args que placeholders — extras ignorados', () => {
    expect(formatMessage('Mensaje {0}', 'a', 'b', 'c')).toBe('Mensaje a')
  })

  it('template sin placeholders — retorna igual', () => {
    expect(formatMessage('Sin placeholders')).toBe('Sin placeholders')
  })

  it('múltiples placeholders', () => {
    expect(formatMessage('{0} y {1}', 'uno', 'dos')).toBe('uno y dos')
  })
})

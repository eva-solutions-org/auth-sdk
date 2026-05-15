/**
 * T-43: Verifica que readTokensFromCookies, COOKIES, COOKIE_MAX_AGE, HEADERS
 * son re-exportados desde los 4 entry points y referencian el mismo binding.
 */
import { describe, it, expect } from 'vitest'

// Importar desde cada entry point (src directo para tests)
import {
  readTokensFromCookies as rootReadTokens,
  COOKIES as rootCOOKIES,
  COOKIE_MAX_AGE as rootCOOKIE_MAX_AGE,
  HEADERS as rootHEADERS,
  DEFAULT_ERROR_MESSAGES as rootDEFAULT,
} from '../src/index'

import {
  readTokensFromCookies as honoReadTokens,
  COOKIES as honoCOOKIES,
  COOKIE_MAX_AGE as honoCOOKIE_MAX_AGE,
  HEADERS as honoHEADERS,
  DEFAULT_ERROR_MESSAGES as honoDEFAULT,
} from '../src/hono/index'

import {
  readTokensFromCookies as genericReadTokens,
  COOKIES as genericCOOKIES,
  COOKIE_MAX_AGE as genericCOOKIE_MAX_AGE,
  HEADERS as genericHEADERS,
  DEFAULT_ERROR_MESSAGES as genericDEFAULT,
} from '../src/generic/index'

import {
  readTokensFromCookies as reactReadTokens,
  COOKIES as reactCOOKIES,
  COOKIE_MAX_AGE as reactCOOKIE_MAX_AGE,
  HEADERS as reactHEADERS,
  DEFAULT_ERROR_MESSAGES as reactDEFAULT,
} from '../src/react/index'

describe('readTokensFromCookies re-exports', () => {
  it('root, /hono, /generic, /react referencian la misma función', () => {
    expect(honoReadTokens).toBe(rootReadTokens)
    expect(genericReadTokens).toBe(rootReadTokens)
    expect(reactReadTokens).toBe(rootReadTokens)
  })

  it('funciona correctamente al parsear cookies', () => {
    const result = rootReadTokens('eva_access_token=mytoken; eva_refresh_token=myrefresh')
    expect(result.accessToken).toBe('mytoken')
    expect(result.refreshToken).toBe('myrefresh')
  })
})

describe('COOKIES re-exports', () => {
  it('todos los entry points referencian el mismo objeto', () => {
    expect(honoCOOKIES).toBe(rootCOOKIES)
    expect(genericCOOKIES).toBe(rootCOOKIES)
    expect(reactCOOKIES).toBe(rootCOOKIES)
  })

  it('tiene ACCESS_TOKEN y REFRESH_TOKEN', () => {
    expect(rootCOOKIES.ACCESS_TOKEN).toBe('eva_access_token')
    expect(rootCOOKIES.REFRESH_TOKEN).toBe('eva_refresh_token')
  })
})

describe('COOKIE_MAX_AGE re-exports', () => {
  it('todos los entry points referencian el mismo objeto', () => {
    expect(honoCOOKIE_MAX_AGE).toBe(rootCOOKIE_MAX_AGE)
    expect(genericCOOKIE_MAX_AGE).toBe(rootCOOKIE_MAX_AGE)
    expect(reactCOOKIE_MAX_AGE).toBe(rootCOOKIE_MAX_AGE)
  })
})

describe('HEADERS re-exports', () => {
  it('todos los entry points referencian el mismo objeto', () => {
    expect(honoHEADERS).toBe(rootHEADERS)
    expect(genericHEADERS).toBe(rootHEADERS)
    expect(reactHEADERS).toBe(rootHEADERS)
  })
})

describe('DEFAULT_ERROR_MESSAGES re-exports', () => {
  it('todos los entry points referencian el mismo objeto', () => {
    expect(honoDEFAULT).toBe(rootDEFAULT)
    expect(genericDEFAULT).toBe(rootDEFAULT)
    expect(reactDEFAULT).toBe(rootDEFAULT)
  })

  it('tiene todas las 16 keys', () => {
    expect(Object.keys(rootDEFAULT)).toHaveLength(16)
  })
})

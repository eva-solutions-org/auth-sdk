import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COOKIES, COOKIE_MAX_AGE } from '../src/constants'
import { createTokenPair } from './helpers/fixtures'

const mockEnv = vi.hoisted(() => ({ value: 'production' as string }))

vi.mock('../src/config', () => ({
  getAuthUrl: () => 'http://auth.test',
  getEvaEnv: () => mockEnv.value,
  AUTH_URL: 'http://auth.test',
  ENV: 'production',
}))

import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../src/cookies'

beforeEach(() => {
  mockEnv.value = 'production'
})

describe('readTokensFromCookies', () => {
  it('retorna objeto vacío cuando cookieHeader es null', () => {
    expect(readTokensFromCookies(null)).toEqual({})
  })

  it('parsea ambas cookies correctamente', () => {
    const tokens = createTokenPair()
    const header = `${COOKIES.ACCESS_TOKEN}=${tokens.accessToken}; ${COOKIES.REFRESH_TOKEN}=${tokens.refreshToken}`

    expect(readTokensFromCookies(header)).toEqual({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    })
  })

  it('parsea solo access token si no hay refresh', () => {
    const header = `${COOKIES.ACCESS_TOKEN}=my-access`

    expect(readTokensFromCookies(header)).toEqual({
      accessToken: 'my-access',
    })
  })

  it('parsea solo refresh token si no hay access', () => {
    const header = `${COOKIES.REFRESH_TOKEN}=my-refresh`

    expect(readTokensFromCookies(header)).toEqual({
      refreshToken: 'my-refresh',
    })
  })

  it('maneja valores con = (el refresh token contiene :)', () => {
    const refreshWithSpecial = 'session-uuid:abc123=extra'
    const header = `${COOKIES.REFRESH_TOKEN}=${refreshWithSpecial}`

    expect(readTokensFromCookies(header)).toEqual({
      refreshToken: refreshWithSpecial,
    })
  })

  it('ignora cookies que no son del SDK', () => {
    const header = `theme=dark; lang=es; ${COOKIES.ACCESS_TOKEN}=tok123`

    expect(readTokensFromCookies(header)).toEqual({
      accessToken: 'tok123',
    })
  })
})

describe('setTokenCookies', () => {
  it('retorna array con 2 cookies Set-Cookie', () => {
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    expect(cookies).toHaveLength(2)
  })

  it('incluye HttpOnly, SameSite=Lax, Path=/', () => {
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
    }
  })

  it('incluye Secure cuando EVA_ENV no es local', () => {
    mockEnv.value = 'production'
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    for (const cookie of cookies) {
      expect(cookie).toContain('Secure')
    }
  })

  it('NO incluye Secure cuando EVA_ENV es local', () => {
    mockEnv.value = 'local'
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    for (const cookie of cookies) {
      expect(cookie).not.toContain('Secure')
    }
  })

  it('incluye Max-Age correcto para access (900) y refresh (2592000)', () => {
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    const [accessCookie, refreshCookie] = cookies
    expect(accessCookie).toContain(`Max-Age=${COOKIE_MAX_AGE.ACCESS_TOKEN}`)
    expect(refreshCookie).toContain(`Max-Age=${COOKIE_MAX_AGE.REFRESH_TOKEN}`)
  })

  it('contiene el nombre y valor correcto de cada cookie', () => {
    const tokens = createTokenPair()
    const cookies = setTokenCookies(tokens)

    const [accessCookie, refreshCookie] = cookies
    expect(accessCookie).toContain(`${COOKIES.ACCESS_TOKEN}=${tokens.accessToken}`)
    expect(refreshCookie).toContain(`${COOKIES.REFRESH_TOKEN}=${tokens.refreshToken}`)
  })
})

describe('clearTokenCookies', () => {
  it('retorna array con 2 cookies Set-Cookie', () => {
    const cookies = clearTokenCookies()

    expect(cookies).toHaveLength(2)
  })

  it('incluye Max-Age=0 y Expires epoch', () => {
    const cookies = clearTokenCookies()

    for (const cookie of cookies) {
      expect(cookie).toContain('Max-Age=0')
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    }
  })

  it('incluye los nombres correctos de las cookies del SDK', () => {
    const cookies = clearTokenCookies()

    const [accessCookie, refreshCookie] = cookies
    expect(accessCookie).toContain(`${COOKIES.ACCESS_TOKEN}=`)
    expect(refreshCookie).toContain(`${COOKIES.REFRESH_TOKEN}=`)
  })

  it('incluye HttpOnly, SameSite=Lax, Path=/', () => {
    const cookies = clearTokenCookies()

    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
    }
  })
})

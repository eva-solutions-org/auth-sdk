import { COOKIES, COOKIE_MAX_AGE } from './constants'
import { getEvaEnv, getCookieDomain } from './config'
import type { TokenPair } from './types'

function isSecureCookie(): boolean {
  return getEvaEnv() !== 'local'
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax' as const,
    path: '/',
    domain: getCookieDomain(),
  }
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const opts = getCookieOptions()
  const parts = [
    `${name}=${value}`,
    'HttpOnly',
    ...(opts.secure ? ['Secure'] : []),
    `SameSite=${opts.sameSite[0].toUpperCase()}${opts.sameSite.slice(1)}`,
    `Path=${opts.path}`,
    // Domain inyectado condicionalmente — solo cuando está configurado vía configureEvaAuth.
    // FOOTGUN (M-4): si cookieDomain cambia entre setTokenCookies y clearTokenCookies,
    // el browser NO borra la cookie original (RFC 6265 exige matching exacto de name+domain+path).
    // Solución: configurar cookieDomain al boot y nunca cambiarlo post-deploy.
    ...(opts.domain !== undefined ? [`Domain=${opts.domain}`] : []),
    `Max-Age=${maxAge}`,
  ]
  return parts.join('; ')
}

function serializeClearCookie(name: string): string {
  const opts = getCookieOptions()
  const parts = [
    `${name}=`,
    'HttpOnly',
    ...(opts.secure ? ['Secure'] : []),
    `SameSite=${opts.sameSite[0].toUpperCase()}${opts.sameSite.slice(1)}`,
    `Path=${opts.path}`,
    // Ver FOOTGUN (M-4) en serializeCookie.
    ...(opts.domain !== undefined ? [`Domain=${opts.domain}`] : []),
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  return parts.join('; ')
}

export function readTokensFromCookies(cookieHeader: string | null): Partial<TokenPair> {
  if (!cookieHeader) return {}

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      const raw = v.join('=')
      try { return [k, decodeURIComponent(raw)] } catch { return [k, raw] }
    })
  )

  return {
    ...(cookies[COOKIES.ACCESS_TOKEN] && { accessToken: cookies[COOKIES.ACCESS_TOKEN] }),
    ...(cookies[COOKIES.REFRESH_TOKEN] && { refreshToken: cookies[COOKIES.REFRESH_TOKEN] }),
  }
}

export function setTokenCookies(tokens: TokenPair): string[] {
  return [
    serializeCookie(COOKIES.ACCESS_TOKEN, tokens.accessToken, COOKIE_MAX_AGE.ACCESS_TOKEN),
    serializeCookie(COOKIES.REFRESH_TOKEN, tokens.refreshToken, COOKIE_MAX_AGE.REFRESH_TOKEN),
  ]
}

export function clearTokenCookies(): string[] {
  return [
    serializeClearCookie(COOKIES.ACCESS_TOKEN),
    serializeClearCookie(COOKIES.REFRESH_TOKEN),
  ]
}

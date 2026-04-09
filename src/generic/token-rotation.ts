import { setTokenCookies, clearTokenCookies } from '../cookies'
import type { TokenPair } from '../types'

type RotationResult = {
  setCookieHeaders: string[]
}

export function handleTokenRotation(tokens: TokenPair): RotationResult {
  return { setCookieHeaders: setTokenCookies(tokens) }
}

export function handleLogoutCookies(): RotationResult {
  return { setCookieHeaders: clearTokenCookies() }
}

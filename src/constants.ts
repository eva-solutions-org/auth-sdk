import { env } from './env'

export const HEADERS = {
  AUTHORIZATION: 'authorization',
  REFRESH_TOKEN: 'x-eva-refresh-token',
  NEW_ACCESS_TOKEN: 'x-eva-new-access-token',
  NEW_REFRESH_TOKEN: 'x-eva-new-refresh-token',
} as const

export const COOKIES = {
  ACCESS_TOKEN: 'eva_access_token',
  REFRESH_TOKEN: 'eva_refresh_token',
} as const

export const COOKIE_MAX_AGE = {
  ACCESS_TOKEN: 15 * 60,            // 15 min
  REFRESH_TOKEN: 30 * 24 * 60 * 60, // 30 días
} as const

export const JWT_CONFIG = {
  ISSUER: 'auth-service',
  AUDIENCE: 'proyecto-global',
  ALGORITHM: 'ES256',
} as const

export const getAuthServiceUrl = (): string => {
  return env.EVA_AUTH_URL.replace(/\/$/, '')
}

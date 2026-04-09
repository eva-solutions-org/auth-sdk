export { createEvaAuth } from './client'
export { createHttpClient, type EvaHttpClient } from './http-client'
export { verifyAccessToken } from './jwt'
export { getPublicKey, fetchJwks, clearJwksCache } from './jwks'
export type {
  EvaUser,
  EvaSession,
  EvaEmpresa,
  EvaTokenPayload,
  Result,
  DeviceInfo,
  TokenPair,
  ActivityState,
  PrivacyState,
} from './types'
export type { EvaAuthError } from './errors'
export { createAuthError, isAuthError } from './errors'
export { HEADERS, COOKIES, COOKIE_MAX_AGE, JWT_CONFIG } from './constants'

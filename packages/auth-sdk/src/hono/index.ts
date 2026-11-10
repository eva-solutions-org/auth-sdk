export {
  evaAuth,
  type EvaAuthOptions,
  type EvaAuthVariables,
} from './middleware'
export { evaAuthRoutes, type EvaAuthRoutesOptions } from './auth-routes'
export { getEvaPayload, getSessionId } from './helpers'
export { parseDeviceInfo } from './device-info'
export {
  configureEvaAuth,
  getConfiguredClientIpForwarder,
  readRequestHeader,
  type ConfigureEvaAuthServerOptions as ConfigureEvaAuthOptions,
  type ClientIpContext,
  type ServiceCredentials,
} from '../client-ip-config'
export { getAuthUrl, getCookieDomain } from '../config'
export {
  readTokensFromCookies,
  setTokenCookies,
  clearTokenCookies,
} from '../cookies'
export { HEADERS, getCookieNames, COOKIE_MAX_AGE } from '../constants'
export type { EvaErrorMessages } from '../error-messages'
export { DEFAULT_ERROR_MESSAGES } from '../error-messages'
// S2S Hono middlewares (v1.1.0)
export {
  s2sAuth,
  requireScope,
  serviceTokenAuth,
  delegatedTokenAuth,
} from './s2s'
export type {
  S2sAuthOptions,
  S2sAuthVariables,
  ServiceTokenAuthOptions,
  ServiceTokenAuthVariables,
  DelegatedTokenAuthOptions,
  DelegatedTokenAuthVariables,
} from './s2s'

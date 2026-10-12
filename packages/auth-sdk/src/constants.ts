import { getAuthUrl } from './config'

/*
 * `HEADERS` es un re-export del contrato. Este módulo es alcanzable desde `src/react`: de la
 * barrel del contrato solo se importan VALORES de módulos puros (`constants.ts`, `routes.ts`) o
 * `import type`. Un schema importado por valor aquí arrastraría su código al bundle de react.
 */
export { HEADERS } from '@eva_solutions/auth-contracts'

export const COOKIES = {
  ACCESS_TOKEN: 'eva_access_token',
  REFRESH_TOKEN: 'eva_refresh_token',
} as const

export const COOKIE_MAX_AGE = {
  ACCESS_TOKEN: 15 * 60, // 15 min
  REFRESH_TOKEN: 30 * 24 * 60 * 60, // 30 días
} as const

export const JWT_CONFIG = {
  ISSUER: 'auth-service',
  AUDIENCE: 'proyecto-global',
  ALGORITHM: 'ES256',
} as const

export const getAuthServiceUrl = (): string => {
  return getAuthUrl().replace(/\/$/, '')
}

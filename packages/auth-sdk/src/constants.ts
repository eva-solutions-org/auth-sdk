import { getAuthUrl, getProduct } from './config'

/*
 * `HEADERS` es un re-export del contrato. Este módulo es alcanzable desde `src/react`: de la
 * barrel del contrato solo se importan VALORES de módulos puros (`constants.ts`, `routes.ts`) o
 * `import type`. Un schema importado por valor aquí arrastraría su código al bundle de react.
 */
export { HEADERS } from '@eva_solutions/auth-contracts'

/**
 * Nombres de las cookies de sesión del producto configurado: `eva_<producto>_access_token` y
 * `eva_<producto>_refresh_token`. Dos productos bajo el mismo dominio padre no se pisan.
 * @throws Error de configuración (`EvaAuthConfigError`) si falta `configureEvaAuth({ product })`.
 */
export const getCookieNames = (): {
  readonly ACCESS_TOKEN: string
  readonly REFRESH_TOKEN: string
} => {
  const product = getProduct()
  return {
    ACCESS_TOKEN: `eva_${product}_access_token`,
    REFRESH_TOKEN: `eva_${product}_refresh_token`,
  }
}

export const COOKIE_MAX_AGE = {
  ACCESS_TOKEN: 15 * 60, // 15 min
  REFRESH_TOKEN: 30 * 24 * 60 * 60, // 30 días
} as const

/** Issuer y algoritmo de los tokens. La audiencia de usuario es el producto configurado. */
export const JWT_CONFIG = {
  // Igual a `TOKEN_ISSUER` del contrato (un test lo fija); literal aquí para no arrastrar el
  // módulo de identidad al bundle de react, que importa este archivo.
  ISSUER: 'auth-service',
  ALGORITHM: 'ES256',
} as const

export const getAuthServiceUrl = (): string => {
  return getAuthUrl().replace(/\/$/, '')
}

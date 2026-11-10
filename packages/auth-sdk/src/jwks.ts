import { createRemoteJWKSet } from 'jose'
import { getAuthServiceUrl } from './constants'

type JwksKeyFn = ReturnType<typeof createRemoteJWKSet>

// Singleton lazy — se crea en la primera llamada a getJwksKeyFn().
// undefined antes de la primera llamada (preserva el comportamiento lazy actual).
let _jwks: JwksKeyFn | undefined

export function getJwksKeyFn(): JwksKeyFn {
  // Lazy init: si _jwks ya fue inicializado, retornar sin re-crear.
  if (!_jwks) {
    // The JWKS is a well-known URL served at the root, so it is built here and never through
    // `apiPath` (which prefixes every versioned route with `/api/v1`).
    const url = new URL(`${getAuthServiceUrl()}/.well-known/jwks.json`)
    _jwks = createRemoteJWKSet(url, {
      cacheMaxAge: 600_000, // 10 min — igual al max-age del JWKS; acota cuánto tiempo se sigue aceptando una clave retirada
      cooldownDuration: 30_000, // 30s — anti-abuse contra JWKS endpoint (explícito)
      timeoutDuration: 5_000, // 5s — equivalente al JWKS_FETCH_TIMEOUT actual
    })
  }
  return _jwks
}

/** Solo para test environments — resetea la instancia singleton. */
export function _resetJwksForTesting(): void {
  _jwks = undefined
}

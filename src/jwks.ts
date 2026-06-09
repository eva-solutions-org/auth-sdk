import { createRemoteJWKSet } from 'jose'
import { getAuthServiceUrl } from './constants'

type JwksKeyFn = ReturnType<typeof createRemoteJWKSet>

// Singleton lazy — se crea en la primera llamada a getJwksKeyFn().
// undefined antes de la primera llamada (preserva el comportamiento lazy actual).
let _jwks: JwksKeyFn | undefined

export function getJwksKeyFn(): JwksKeyFn {
  // Lazy init: si _jwks ya fue inicializado, retornar sin re-crear.
  if (!_jwks) {
    const url = new URL(`${getAuthServiceUrl()}/.well-known/jwks.json`)
    _jwks = createRemoteJWKSet(url, {
      cacheMaxAge: 86_400_000,   // 24h — alineado con TTL normal de ADR-005
      cooldownDuration: 30_000,  // 30s — anti-abuse contra JWKS endpoint (explícito)
      timeoutDuration: 5_000,    // 5s — equivalente al JWKS_FETCH_TIMEOUT actual
    })
  }
  return _jwks
}

/** Solo para test environments — resetea la instancia singleton. */
export function _resetJwksForTesting(): void {
  _jwks = undefined
}

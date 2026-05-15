// Módulo de estado del cache JWKS.
// Aislado de config.ts y jwks.ts para evitar import circular:
//   config.ts → jwks-cache.ts ← jwks.ts  (sin ciclo)

export let cachedKey: CryptoKey | null = null
export let cachedEtag: string | null = null
export let cachedAt = 0
export let pendingFetch: Promise<void> | null = null

export function clearCache(): void {
  cachedKey = null
  cachedEtag = null
  cachedAt = 0
  pendingFetch = null
}

export function setCached(key: CryptoKey, etag: string | null, at: number): void {
  cachedKey = key
  cachedEtag = etag
  cachedAt = at
}

export function refreshCachedAt(at: number): void {
  cachedAt = at
}

export function setPendingFetch(p: Promise<void> | null): void {
  pendingFetch = p
}

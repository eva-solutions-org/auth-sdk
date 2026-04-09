import { importJWK } from 'jose'
import { getAuthServiceUrl } from './constants'

let cachedKey: CryptoKey | null = null
let cachedEtag: string | null = null
let cachedAt = 0
const CACHE_TTL = 86400 * 1000

export async function fetchJwks(): Promise<void> {
  const url = `${getAuthServiceUrl()}/.well-known/jwks.json`
  const headers: Record<string, string> = {}

  if (cachedEtag) {
    headers['If-None-Match'] = cachedEtag
  }

  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch {
    if (cachedKey) return
    throw new Error('Failed to fetch JWKS and no cached key available')
  }

  if (res.status === 304 && cachedKey) {
    cachedAt = Date.now()
    return
  }

  if (!res.ok) {
    if (cachedKey) return
    throw new Error(`JWKS fetch failed with status ${res.status}`)
  }

  const jwks = await res.json() as { keys: Array<Record<string, unknown>> }
  const jwk = jwks.keys[0]

  if (!jwk) {
    if (cachedKey) return
    throw new Error('JWKS response contains no keys')
  }

  cachedKey = await importJWK(jwk, 'ES256') as CryptoKey
  cachedEtag = res.headers.get('etag')
  cachedAt = Date.now()
}

export async function getPublicKey(): Promise<CryptoKey> {
  const isStale = !cachedKey || (Date.now() - cachedAt > CACHE_TTL)

  if (isStale) {
    await fetchJwks()
  }

  if (!cachedKey) {
    throw new Error('No public key available')
  }

  return cachedKey
}

export function clearJwksCache(): void {
  cachedKey = null
  cachedEtag = null
  cachedAt = 0
}

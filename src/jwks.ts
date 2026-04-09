import { importJWK } from 'jose'
import { z } from 'zod'
import { getAuthServiceUrl } from './constants'

const JwksResponseSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())).min(1),
})

let cachedKey: CryptoKey | null = null
let cachedEtag: string | null = null
let cachedAt = 0
const CACHE_TTL = 86400 * 1000
const CACHE_MAX_TTL = 86400 * 1000 + 3600 * 1000

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
    throw new Error('Error al obtener JWKS y no hay clave en caché')
  }

  if (res.status === 304 && cachedKey) {
    cachedAt = Date.now()
    return
  }

  if (!res.ok) {
    if (cachedKey) return
    throw new Error(`Error al obtener JWKS con estado ${res.status}`)
  }

  const json: unknown = await res.json()
  const parsed = JwksResponseSchema.safeParse(json)

  if (!parsed.success) {
    if (cachedKey) return
    throw new Error('Formato de respuesta JWKS inválido')
  }

  const jwk = parsed.data.keys[0]

  const key = await importJWK(jwk, 'ES256')
  if (!(key instanceof CryptoKey)) {
    throw new Error('Se esperaba CryptoKey de la importación JWKS')
  }
  cachedKey = key
  cachedEtag = res.headers.get('etag')
  cachedAt = Date.now()
}

export async function getPublicKey(): Promise<CryptoKey> {
  const isStale = !cachedKey || (Date.now() - cachedAt > CACHE_TTL)

  if (isStale) {
    try {
      await fetchJwks()
    } catch (err) {
      if (!cachedKey || Date.now() - cachedAt > CACHE_MAX_TTL) {
        throw err
      }
    }
  }

  if (!cachedKey) {
    throw new Error('Clave pública no disponible')
  }

  return cachedKey
}

export function clearJwksCache(): void {
  cachedKey = null
  cachedEtag = null
  cachedAt = 0
}

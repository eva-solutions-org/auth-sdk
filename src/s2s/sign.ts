/**
 * Helpers de firma HMAC-SHA-256 SigV4-style para requests S2S.
 *
 * REQ-S2S-02, REQ-S2S-03 LOCKED.
 *
 * Algoritmo canónico (espejo EXACTO de API `src/core/crypto/canonical.ts`):
 *   canonical = [METHOD, PATH, CANONICAL_QUERY, TIMESTAMP, CLIENT_ID, BODY_HASH].join('\n')
 *
 * Usa Web Crypto API (`crypto.subtle`) — isomorfo (browser + worker + Node 20+).
 *
 * D-12 LOCKED: hexToBytes y sha256Hex se duplican aquí (NO se extraen a shared)
 * para que el entry point ./s2s sea completamente tree-shakeable.
 */

import type { S2SCanonicalParts } from './types'

// ---------------------------------------------------------------------------
// Helpers criptográficos locales (D-12 LOCKED — no exportar, no extraer)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()
const HEX_REGEX = /^[0-9a-f]+$/i

/**
 * Decodifica hex string a Uint8Array.
 * Retorna null si la longitud es impar o contiene chars no-hex.
 */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_REGEX.test(hex)) {
    return null
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * SHA-256 hex lowercase de un string o Uint8Array.
 * Acepta string (encodea como UTF-8) o Uint8Array (bytes raw — preferido para body).
 */
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Encoding RFC 3986 estricto.
 * `encodeURIComponent` no codifica `! * ' ( )` — esta función sí.
 * Espejo de `uriEncodeRFC3986` del API.
 */
function uriEncodeRFC3986(input: string): string {
  return encodeURIComponent(input).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * Canonicaliza el query string:
 *   1. Split por `&`.
 *   2. Decodificar name/value con `decodeURIComponent`.
 *   3. Ordenar por (name, value) alfabético.
 *   4. Re-encodear con `uriEncodeRFC3986`.
 *   5. Join con `=` y `&`.
 * Query vacío → `""`.
 */
function canonicalizeQuery(rawQuery: string): string {
  if (!rawQuery) return ''

  const pairs: Array<{ name: string; value: string }> = []
  for (const pair of rawQuery.split('&')) {
    if (pair === '') continue
    const idx = pair.indexOf('=')
    if (idx === -1) {
      pairs.push({ name: decodeURIComponent(pair), value: '' })
    } else {
      pairs.push({
        name: decodeURIComponent(pair.slice(0, idx)),
        value: decodeURIComponent(pair.slice(idx + 1)),
      })
    }
  }

  pairs.sort((a, b) => {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    if (a.value < b.value) return -1
    if (a.value > b.value) return 1
    return 0
  })

  return pairs
    .map(({ name, value }) => `${uriEncodeRFC3986(name)}=${uriEncodeRFC3986(value)}`)
    .join('&')
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex de string vacío (precomputado).
 * Constante usada cuando el body es vacío — evita hash innecesario.
 * Exportado para uso externo (REQ-S2S-02 LOCKED).
 */
export const EMPTY_BODY_SHA256_HEX =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * Construye el canonical string de 6 líneas (SigV4-style).
 *
 * Formato EXACTO (espejo del API):
 *   {METHOD}\n{PATH}\n{CANONICAL_QUERY}\n{TIMESTAMP}\n{CLIENT_ID}\n{BODY_HASH}
 *
 * @param parts - Componentes del request a firmar.
 */
export async function buildS2SCanonicalString(parts: S2SCanonicalParts): Promise<string> {
  const METHOD = parts.method.toUpperCase()
  const PATH = parts.path
  const CANONICAL_QUERY = canonicalizeQuery(parts.rawQuery)
  const TIMESTAMP = parts.timestamp
  const CLIENT_ID = parts.clientId
  const BODY_HASH =
    parts.bodyBytes.length === 0
      ? EMPTY_BODY_SHA256_HEX
      : await sha256Hex(parts.bodyBytes)

  return [METHOD, PATH, CANONICAL_QUERY, TIMESTAMP, CLIENT_ID, BODY_HASH].join('\n')
}

/**
 * Genera la firma HMAC-SHA-256 del canonical string.
 *
 * @returns String con formato `"sha256=${hexLowercase}"`.
 * @throws Si `secretHex` tiene formato inválido (longitud impar o chars no-hex).
 */
export async function signS2SRequest({
  parts,
  secretHex,
}: {
  parts: S2SCanonicalParts
  secretHex: string
}): Promise<string> {
  const canonical = await buildS2SCanonicalString(parts)

  const keyBytes = hexToBytes(secretHex)
  if (keyBytes === null) {
    throw new Error('[eva-auth-sdk] s2s: secretHex inválido (formato hex requerido)')
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(canonical) as BufferSource,
  )

  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `sha256=${hexSig}`
}

/**
 * Primitiva de verificación HMAC-SHA-256 para requests S2S entrantes.
 *
 * Framework-agnostic — acepta Web API `Request`.
 *
 * REQ-VERIFY-HEADERS-*, REQ-VERIFY-TS-*, REQ-VERIFY-SIG-*, REQ-VERIFY-HMAC-*,
 * REQ-VERIFY-TIMING-SAFE-*, REQ-VERIFY-BODY-*, REQ-API-01.
 *
 * D-12 LOCKED: `hexToBytes` se duplica aquí (NO se importa de sign.ts)
 * para que el entry point ./s2s sea completamente tree-shakeable.
 */

import { buildS2SCanonicalString } from './sign'
import { S2S_TIMESTAMP_WINDOW_SECONDS } from './constants'
import type { S2SCanonicalParts, S2SVerifyError, S2SVerifyOptions, S2SVerifyReason, S2SVerifyResult } from './types'

// ---------------------------------------------------------------------------
// Helpers criptográficos locales (D-12 LOCKED — duplicado de sign.ts)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()
const HEX_REGEX = /^[0-9a-f]+$/i

/**
 * Decodifica hex string a Uint8Array.
 * Retorna null si la longitud es impar o contiene chars no-hex.
 * D-12 LOCKED: duplicado de sign.ts para tree-shakeability.
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

// ---------------------------------------------------------------------------
// Constantes internas
// ---------------------------------------------------------------------------

/**
 * Dummy HMAC key hex (64 zeros = 32 bytes).
 * Used when `secretStore` returns null to keep timing equivalent to the valid-secret path.
 *
 * @security WHATWG Web Crypto spec does NOT explicitly guarantee constant-time for
 * `crypto.subtle.verify`. In practice Node 22+ (OpenSSL) and Chromium (BoringSSL)
 * use `CRYPTO_memcmp` which IS constant-time. If that changes, migrate to the
 * double-HMAC verification pattern (HMAC(secret, expected) === HMAC(secret, received)).
 * See: https://paragonie.com/blog/2015/11/preventing-timing-attacks-on-string-comparison-with-double-hmac-strategy
 *
 * Q-E05 LOCKED: value is '00'.repeat(32) (64 hex zeros).
 */
const DUMMY_HMAC_KEY_HEX = '00'.repeat(32)

/** Regex: timestamp must be 1–11 decimal digits (unsigned Unix epoch in seconds). */
const TIMESTAMP_REGEX = /^\d{1,11}$/

/** Regex: signature must be `sha256=` followed by exactly 64 lowercase hex chars. */
const SIGNATURE_REGEX = /^sha256=([0-9a-f]{64})$/i

/** Human-readable messages for each reason. */
const VERIFY_MESSAGES: Record<S2SVerifyReason, string> = {
  header_missing: 'Required authentication headers are missing',
  timestamp_invalid: 'Timestamp header is not a valid integer',
  timestamp_expired: 'Timestamp is outside the allowed window',
  signature_malformed: 'Signature header is malformed',
  client_unknown: 'Authentication failed',
  signature_invalid: 'Authentication failed',
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function verifyErr(reason: S2SVerifyReason): S2SVerifyResult<never> {
  const error: S2SVerifyError = { reason, message: VERIFY_MESSAGES[reason] }
  return { ok: false, error }
}

function okResult<T>(data: T): S2SVerifyResult<T> {
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Verify an inbound S2S request signed with HMAC-SHA-256.
 *
 * The function reads the body into memory exactly once (via `request.arrayBuffer()`).
 * Callers that need to read the body again after calling this function MUST clone the
 * request before passing it here (e.g., Hono's `s2sAuth` uses `cloneRawRequest`).
 *
 * @param request - Web API `Request` to verify. Body is read and buffered internally.
 * @param opts.secretStore - Callback returning the plaintext secret (64 hex chars) for
 *   the given clientId, or null if unknown. Return null — do NOT throw — for unknown clients.
 * @param opts.timestampWindowSeconds - Override timestamp window (default: 120 s).
 *
 * @returns `S2SVerifyResult<{ clientId: string }>` — discriminated union.
 *   `ok: true`  → `data.clientId` is the authenticated service client slug.
 *   `ok: false` → `error.reason` narrows the failure; `error.message` is human-readable.
 *
 * @security Timing-safe: whether `secretStore` returns null (client_unknown path) or a
 *   valid secret with an invalid signature (signature_invalid path), this function
 *   ALWAYS reaches `crypto.subtle.verify` with the same execution path — using
 *   `DUMMY_HMAC_KEY_HEX` when the secret is null. The verify result is discarded in
 *   the client_unknown path, but the operation always executes. See AC-10.
 *
 * @example
 * ```ts
 * const result = await verifyS2SRequest(request, {
 *   secretStore: async (clientId) => {
 *     const client = await db.serviceClients.findById(clientId)
 *     return client?.secretHash ?? null
 *   },
 * })
 * if (!result.ok) {
 *   return new Response(
 *     JSON.stringify({ error: result.error }),
 *     { status: 401, headers: { 'Content-Type': 'application/json' } },
 *   )
 * }
 * const { clientId } = result.data
 * ```
 */
export async function verifyS2SRequest(
  request: Request,
  opts: S2SVerifyOptions,
): Promise<S2SVerifyResult<{ clientId: string }>> {
  const { secretStore, timestampWindowSeconds = S2S_TIMESTAMP_WINDOW_SECONDS } = opts

  // PASO 1 — Extract headers (Web API Headers normalizes case automatically per spec)
  const clientId = request.headers.get('x-eva-client-id')
  const timestampStr = request.headers.get('x-eva-timestamp')
  const signatureHeader = request.headers.get('x-eva-signature')

  if (clientId === null || timestampStr === null || signatureHeader === null) {
    return verifyErr('header_missing')
  }

  // PASO 2 — Validate timestamp format (unsigned decimal integer, up to 11 digits)
  if (!TIMESTAMP_REGEX.test(timestampStr)) {
    return verifyErr('timestamp_invalid')
  }
  const timestamp = Number(timestampStr)

  // PASO 3 — Validate timestamp window
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > timestampWindowSeconds) {
    return verifyErr('timestamp_expired')
  }

  // PASO 4 — Parse signature header: `sha256=<64 hex chars>`
  const sigMatch = signatureHeader.match(SIGNATURE_REGEX)
  if (sigMatch === null) {
    return verifyErr('signature_malformed')
  }
  const signatureHex = sigMatch[1] as string
  const signatureBytes = hexToBytes(signatureHex)
  // hexToBytes cannot return null here: SIGNATURE_REGEX guarantees 64 valid hex chars.
  // Non-null assertion avoids runtime overhead.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const signatureBytesNN = signatureBytes!

  // PASO 5 — Read body (buffers the stream into memory once)
  const bodyArrayBuffer = await request.arrayBuffer()
  const bodyBytes = new Uint8Array(bodyArrayBuffer)

  // PASO 6 — Build canonical string (reuses existing algorithm — D-01: timestampStr as string,
  // D-02: clientId included)
  const url = new URL(request.url)
  const parts: S2SCanonicalParts = {
    method: request.method,
    path: url.pathname,
    rawQuery: url.search.length > 0 ? url.search.slice(1) : '', // strip leading '?'
    timestamp: timestampStr, // D-01: pass string directly — no numeric conversion
    clientId, // D-02: extracted from header, bound into canonical
    bodyBytes,
  }
  const canonical = await buildS2SCanonicalString(parts)
  const canonicalBytes = encoder.encode(canonical)

  // PASO 7 — Secret lookup (timing-safe: always proceed to HMAC regardless of result)
  const secretHex = await secretStore(clientId)
  const keyHex = secretHex ?? DUMMY_HMAC_KEY_HEX
  const keyBytes = hexToBytes(keyHex)
  // keyHex is always valid hex: either from secretStore (caller contract) or DUMMY_HMAC_KEY_HEX
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const keyBytesNN = keyBytes!

  // PASO 8 — HMAC verify — ALWAYS reaches this point (timing-safe invariant AC-10)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytesNN.buffer as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const verified = await crypto.subtle.verify(
    'HMAC',
    cryptoKey,
    signatureBytesNN.buffer as BufferSource,
    canonicalBytes as BufferSource,
  )

  // PASO 9 — Result (checked AFTER verify — no early return before PASO 8)
  if (secretHex === null) {
    // Discard verify result — client_unknown takes precedence for timing-safe path
    return verifyErr('client_unknown')
  }
  if (!verified) {
    return verifyErr('signature_invalid')
  }
  return okResult({ clientId })
}

/**
 * Verificación de firma HMAC-SHA-256 de webhooks entrantes del Auth Service.
 *
 * REQ-WH-03, REQ-WH-04, REQ-WH-05, REQ-WH-06 LOCKED.
 *
 * Algoritmo (espejo del API `firmarWebhook` en webhook-dispatcher.ts):
 *   canonical = `${timestamp}\n${eventId}\n${sha256Hex(rawBody)}`
 *   expected  = HMAC-SHA-256(signingKey, canonical)
 *
 * Usa Web Crypto API (`crypto.subtle`) — isomorfo (browser + worker + Node 20+).
 *
 * D-12 LOCKED: hexToBytes y sha256Hex se duplican aquí (NO se extraen a shared)
 * para que el entry point ./webhooks sea completamente tree-shakeable.
 */

import { WEBHOOK_TIMESTAMP_WINDOW_SECONDS } from './constants'

// ---------------------------------------------------------------------------
// Helpers criptográficos locales (D-12 LOCKED — no exportar, no extraer)
// ---------------------------------------------------------------------------

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
 * SHA-256 hex lowercase de un string (encodificado como UTF-8).
 */
async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export type VerifyWebhookSignatureParams = {
  /** Body raw del request (string, antes de parsear JSON). */
  rawBody: string
  /**
   * Signing key del webhook — hex 64 chars (32 bytes).
   * Es el `signingKey` que devolvió el API al crear/rotar la subscription.
   * NOTA H3 LOCKED: NO re-hashear — usarlo tal como viene.
   */
  signingKey: string
  /**
   * Valor completo del header `X-Eva-Webhook-Signature`.
   * Debe comenzar con `"sha256="`.
   */
  signature: string
  /** Valor del header `X-Eva-Webhook-Id` (UUID del evento). */
  eventId: string
  /**
   * Valor del header `X-Eva-Webhook-Timestamp` parseado a number
   * (unix seconds).
   */
  timestamp: number
  /**
   * Override del tiempo actual (unix seconds) para tests.
   * Por defecto: `Math.floor(Date.now() / 1000)`.
   */
  now?: number
}

/**
 * Verifica la firma HMAC-SHA-256 de un webhook entrante del Auth Service.
 *
 * @returns `true` si la firma es válida y está dentro de la ventana de tiempo;
 *          `false` en cualquier otro caso (firma inválida, expirada, formato incorrecto).
 *
 * La comparación es constant-time via `crypto.subtle.verify` (por spec).
 *
 * @example
 * ```ts
 * const valid = await verifyWebhookSignature({
 *   rawBody: await req.text(),
 *   signingKey: process.env.WEBHOOK_SIGNING_KEY,
 *   signature: req.headers.get('x-eva-webhook-signature') ?? '',
 *   eventId: req.headers.get('x-eva-webhook-id') ?? '',
 *   timestamp: Number(req.headers.get('x-eva-webhook-timestamp')),
 * })
 * if (!valid) return new Response('Unauthorized', { status: 401 })
 * ```
 */
export async function verifyWebhookSignature({
  rawBody,
  signingKey,
  signature,
  eventId,
  timestamp,
  now,
}: VerifyWebhookSignatureParams): Promise<boolean> {
  // Paso 1: verificar ventana de tiempo
  const currentTime = now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(currentTime - timestamp) > WEBHOOK_TIMESTAMP_WINDOW_SECONDS) {
    return false
  }

  // Paso 2: extraer hex esperado del header (quitar prefijo "sha256=")
  if (!signature.startsWith('sha256=')) {
    return false
  }
  const expectedHex = signature.slice(7)

  // Paso 3: decodificar signing key (sin re-hash — H3 LOCKED)
  const keyBytes = hexToBytes(signingKey)
  if (keyBytes === null) {
    return false
  }

  // Paso 4: importar clave HMAC
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  // Paso 5: construir el canonical string
  // canonical = `${timestamp}\n${eventId}\n${sha256Hex(rawBody)}`
  const bodyHash = await sha256Hex(rawBody)
  const canonical = `${timestamp}\n${eventId}\n${bodyHash}`

  // Paso 6: decodificar firma esperada
  const expectedBytes = hexToBytes(expectedHex)
  if (expectedBytes === null) {
    return false
  }

  // Paso 7: verificar HMAC (constant-time por spec de Web Crypto)
  return crypto.subtle.verify(
    'HMAC',
    cryptoKey,
    expectedBytes.buffer as BufferSource,
    new TextEncoder().encode(canonical) as BufferSource,
  )
}

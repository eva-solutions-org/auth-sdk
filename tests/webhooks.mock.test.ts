/**
 * Tests para src/webhooks/verify-signature.ts
 *
 * T-026 — Batch 4
 * REQ-WH-03, REQ-WH-04, REQ-WH-05, REQ-WH-06 cubiertos.
 *
 * Estrategia: generar firmas reales usando Web Crypto (mismo algoritmo que el SDK)
 * para garantizar vectores de test válidos sin hardcodear hashes que dependan de la impl.
 * Usa `now` override para control total sobre la ventana de tiempo.
 */

import { describe, it, expect } from 'vitest'
import { verifyWebhookSignature } from '../src/webhooks/verify-signature'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SIGNING_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes
const MOCK_EVENT_ID = '00000000-0000-4000-8000-000000000001'
const MOCK_TIMESTAMP = 1700000000
const MOCK_RAW_BODY = '{"id":"evt1","eventCode":"user.created","timestamp":1700000000,"data":{}}'
const NOW_INSIDE_WINDOW = MOCK_TIMESTAMP + 10 // 10s después — dentro de los 300s

// ---------------------------------------------------------------------------
// Helpers para generar firmas válidas en los tests
// (replica el algoritmo del API — espejo de verify-signature.ts)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateSignature({
  rawBody,
  signingKey,
  eventId,
  timestamp,
}: {
  rawBody: string
  signingKey: string
  eventId: string
  timestamp: number
}): Promise<string> {
  const keyBytes = hexToBytes(signingKey)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bodyHash = await sha256Hex(rawBody)
  const canonical = `${timestamp}\n${eventId}\n${bodyHash}`
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(canonical) as BufferSource,
  )
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${hexSig}`
}

// ---------------------------------------------------------------------------
// T-026: Tests de verifyWebhookSignature
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature', () => {
  // ─── Happy path (REQ-WH-03, REQ-WH-04) ───────────────────────────────────

  it('happy path: firma válida con timestamp dentro de la ventana → true', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(true)
  })

  // ─── Firma inválida (REQ-WH-05) ──────────────────────────────────────────

  it('firma inválida (hex correcto pero HMAC incorrecto) → false', async () => {
    // Genera firma con otro key
    const wrongKey = 'b'.repeat(64)
    const wrongSignature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: wrongKey,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature: wrongSignature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  it('firma con prefijo incorrecto (sin "sha256=") → false', async () => {
    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature: 'invalid-no-prefix',
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  it('firma con hex vacío después del prefijo → false', async () => {
    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature: 'sha256=',
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  // ─── Ventana de tiempo (REQ-WH-06) ───────────────────────────────────────

  it('timestamp exactamente a 300s → true (dentro de la ventana)', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: MOCK_TIMESTAMP + 300, // exactamente 300s
    })

    expect(result).toBe(true)
  })

  it('timestamp excedido (> 300s) → false (ventana superada)', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: MOCK_TIMESTAMP + 301, // 301s — fuera de ventana
    })

    expect(result).toBe(false)
  })

  it('timestamp en el pasado (> 300s anterior) → false', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: MOCK_TIMESTAMP - 301, // 301s antes — también fuera de ventana
    })

    expect(result).toBe(false)
  })

  // ─── H3 LOCKED: re-hash del signing key → false ───────────────────────────

  it('H3 LOCKED: re-hashear el signing key antes de verificar → false', async () => {
    // Genera firma con la clave original (sin re-hash)
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    // Intenta verificar pasando el SHA-256 del signing key en lugar del key original
    const rehashedKey = await sha256Hex(MOCK_SIGNING_KEY)

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: rehashedKey,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  // ─── eventId distinto cambia la firma (REQ-WH-04) ────────────────────────

  it('eventId diferente → firma no coincide → false', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const differentEventId = '11111111-1111-4111-8111-111111111111'

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: differentEventId, // eventId distinto
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  // ─── rawBody distinto cambia la firma ────────────────────────────────────

  it('rawBody modificado → firma no coincide → false', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const tamperedBody = MOCK_RAW_BODY.replace('user.created', 'user.deleted')

    const result = await verifyWebhookSignature({
      rawBody: tamperedBody,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  // ─── signing key con formato inválido ────────────────────────────────────

  it('signing key con longitud impar → false (hexToBytes retorna null)', async () => {
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
    })

    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: 'abc', // longitud impar
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: MOCK_TIMESTAMP,
      now: NOW_INSIDE_WINDOW,
    })

    expect(result).toBe(false)
  })

  // ─── now por defecto (sin override) ──────────────────────────────────────

  it('sin override de now: usa Date.now() — firma con timestamp actual → true', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const signature = await generateSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      eventId: MOCK_EVENT_ID,
      timestamp: nowSeconds,
    })

    // Sin pasar `now` — usa Date.now() internamente
    const result = await verifyWebhookSignature({
      rawBody: MOCK_RAW_BODY,
      signingKey: MOCK_SIGNING_KEY,
      signature,
      eventId: MOCK_EVENT_ID,
      timestamp: nowSeconds,
    })

    expect(result).toBe(true)
  })
})

/**
 * Smoke tests de integración: signS2SRequest (cliente) → verifyS2SRequest (servidor)
 *
 * T-011 — Batch 4 (B-4) — HARD GATE AC-04
 * Cubre: REQ-CROSS-COMPAT-01..05, REQ-VERIFY-CANONICAL-02
 *
 * Si algún test de este archivo falla, indica que canonical server ≠ cliente
 * o que el secretHex se maneja de forma distinta en sign vs verify.
 * NO continuar a B-5 hasta que todos pasen.
 *
 * Fixtures generadas en runtime (REQ-CROSS-COMPAT-05 — no hardcodear).
 */

import { describe, it, expect } from 'vitest'
import { signS2SRequest, buildS2SCanonicalString } from '../src/s2s/sign'
import { verifyS2SRequest } from '../src/s2s/verify'
import type { S2SCanonicalParts } from '../src/s2s/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_HEX = 'cafebabe'.repeat(8) // 64 hex chars = 32 bytes
const ALT_SECRET_HEX = '0f0e0d0c'.repeat(8) // secreto diferente
const CLIENT_ID = 'test-client'

// ---------------------------------------------------------------------------
// Helper: construir un Request firmado usando signS2SRequest
// ---------------------------------------------------------------------------

async function makeSignedRequest(opts: {
  method: string
  path?: string
  query?: string
  body?: Uint8Array
  secretHex?: string
  clientId?: string
  timestamp?: number
}): Promise<{ request: Request; secretHex: string }> {
  const method = opts.method
  const path = opts.path ?? '/internal/test'
  const query = opts.query ?? ''
  const body = opts.body ?? new Uint8Array(0)
  const secretHex = opts.secretHex ?? SECRET_HEX
  const clientId = opts.clientId ?? CLIENT_ID
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)

  const parts: S2SCanonicalParts = {
    method,
    path,
    rawQuery: query,
    timestamp: String(timestamp),
    clientId,
    bodyBytes: body,
  }

  const signature = await signS2SRequest({ parts, secretHex })

  const url = `http://localhost${path}${query ? `?${query}` : ''}`
  const headers: Record<string, string> = {
    'x-eva-client-id': clientId,
    'x-eva-timestamp': String(timestamp),
    'x-eva-signature': signature,
  }

  const request = new Request(url, {
    method,
    headers,
    body: body.length > 0 ? body : undefined,
    ...(body.length > 0 ? { duplex: 'half' as never } : {}),
  })

  return { request, secretHex }
}

// ---------------------------------------------------------------------------
// Cross-compat: signS2SRequest → verifyS2SRequest
// ---------------------------------------------------------------------------

describe('Cross-compat: signS2SRequest → verifyS2SRequest', () => {
  it('GET sin body — round-trip happy path → ok:true, clientId correcto', async () => {
    const { request, secretHex } = await makeSignedRequest({ method: 'GET' })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => secretHex,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.clientId).toBe(CLIENT_ID)
  })

  it('POST con body JSON — round-trip happy path → ok:true', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ hello: 'world', ids: ['u1', 'u2'] }))
    const { request, secretHex } = await makeSignedRequest({ method: 'POST', body })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => secretHex,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.clientId).toBe(CLIENT_ID)
  })

  it('secretHex distinto → reason:signature_invalid (REQ-CROSS-COMPAT-03)', async () => {
    // Firma con SECRET_HEX, verifica con ALT_SECRET_HEX
    const { request } = await makeSignedRequest({ method: 'POST', secretHex: SECRET_HEX })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => ALT_SECRET_HEX,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('signature_invalid')
  })

  it('timestamp expirado (now-300) → reason:timestamp_expired (REQ-CROSS-COMPAT-04)', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 300
    const { request, secretHex } = await makeSignedRequest({
      method: 'GET',
      timestamp: oldTimestamp,
    })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => secretHex,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('timestamp_expired')
  })

  it('canonical bilateral: buildS2SCanonicalString produce strings idénticos en sign y verify (REQ-VERIFY-CANONICAL-02)', async () => {
    const parts: S2SCanonicalParts = {
      method: 'POST',
      path: '/internal/users/batch',
      rawQuery: 'verbose=true&limit=10',
      timestamp: '1700000000',
      clientId: CLIENT_ID,
      bodyBytes: new TextEncoder().encode('{"ids":["u1","u2"]}'),
    }
    // Mismo buildS2SCanonicalString usado por sign y verify internamente
    const canonical1 = await buildS2SCanonicalString(parts)
    const canonical2 = await buildS2SCanonicalString(parts)
    expect(canonical1).toBe(canonical2)
    expect(canonical1.split('\n')).toHaveLength(6)
    expect(canonical1.split('\n')[0]).toBe('POST')
    expect(canonical1.split('\n')[1]).toBe('/internal/users/batch')
  })
})

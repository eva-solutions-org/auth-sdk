/**
 * Benchmark on-demand de timing para verifyS2SRequest.
 *
 * NO se ejecuta en CI default. Correr manualmente con:
 *   pnpm exec vitest bench tests/perf/s2s-timing.bench.ts
 *
 * Propósito: medir empíricamente el timing de las 3 ramas principales:
 *   - Happy path (secret válido + firma válida)
 *   - client_unknown (secretStore retorna null → dummy HMAC path)
 *   - signature_invalid (secret válido + firma inválida/tampered)
 *
 * El timing-safe defense del SDK garantiza que dummy HMAC y signature_invalid
 * tomen tiempo equivalente (verificado en unit tests via code path equivalence
 * con spy de crypto.subtle.verify). Este bench ofrece datos empíricos del
 * overhead absoluto y permite detectar regresiones de performance cuando se
 * modifique verifyS2SRequest o buildS2SCanonicalString en el futuro.
 *
 * Resultado típico esperado (Node 22, hardware moderno):
 *   - Happy path:         ~150–300 μs/op (incluye importKey + verify + canonical)
 *   - client_unknown:     ~150–300 μs/op (mismo path, dummy key)
 *   - signature_invalid:  ~150–300 μs/op (mismo path, verify retorna false)
 *
 * Delta entre las 3 ramas debería ser < 10% — confirma timing-safe defense.
 * Si alguna rama diverge significativamente, investigar cambios recientes en
 * verifyS2SRequest (PASO 7–9 del algoritmo de 9 pasos).
 *
 * T-020 (SDD s2s-server-middleware) — follow-up v1.2.0.
 */

import { bench, describe, beforeAll } from 'vitest'
import { signS2SRequest } from '../../src/s2s/sign'
import { verifyS2SRequest } from '../../src/s2s/verify'
import type { S2SCanonicalParts } from '../../src/s2s/types'

// ---------------------------------------------------------------------------
// Constantes de fixture
// ---------------------------------------------------------------------------

const VALID_SECRET = 'cafebabe'.repeat(8) // 64 hex chars = 32 bytes
const CLIENT_ID = 'bench-client'
const BASE_URL = 'http://localhost/internal/bench'
const BODY_JSON = new TextEncoder().encode('{"hello":"world"}')

// ---------------------------------------------------------------------------
// Fixtures pre-computadas (se construyen en beforeAll — no en cada iteración)
// Usar request.clone() en cada bench para evitar que el body stream se agote.
// ---------------------------------------------------------------------------

let validRequestTemplate: Request
let invalidSigRequestTemplate: Request
let unknownClientRequestTemplate: Request

beforeAll(async () => {
  const timestamp = Math.floor(Date.now() / 1000)

  const parts: S2SCanonicalParts = {
    method: 'POST',
    path: '/internal/bench',
    rawQuery: '',
    timestamp: String(timestamp),
    clientId: CLIENT_ID,
    bodyBytes: BODY_JSON,
  }

  // --- Fixture 1: happy path — firma válida ---
  const validSignature = await signS2SRequest({ parts, secretHex: VALID_SECRET })
  validRequestTemplate = new Request(BASE_URL, {
    method: 'POST',
    headers: {
      'x-eva-client-id': CLIENT_ID,
      'x-eva-timestamp': String(timestamp),
      'x-eva-signature': validSignature,
      'content-type': 'application/json',
    },
    body: BODY_JSON,
    duplex: 'half' as never,
  })

  // --- Fixture 2: signature_invalid — firma tampered (un byte cambiado) ---
  const tamperedSignature = validSignature.replace(/[0-9a-f]$/, (c) =>
    c === 'f' ? '0' : String.fromCharCode(c.charCodeAt(0) + 1),
  )
  invalidSigRequestTemplate = new Request(BASE_URL, {
    method: 'POST',
    headers: {
      'x-eva-client-id': CLIENT_ID,
      'x-eva-timestamp': String(timestamp),
      'x-eva-signature': tamperedSignature,
      'content-type': 'application/json',
    },
    body: BODY_JSON,
    duplex: 'half' as never,
  })

  // --- Fixture 3: client_unknown — secretStore retorna null ---
  // Usamos la firma válida (el path toma la rama dummy HMAC igualmente)
  unknownClientRequestTemplate = new Request(BASE_URL, {
    method: 'POST',
    headers: {
      'x-eva-client-id': 'unknown-client',
      'x-eva-timestamp': String(timestamp),
      'x-eva-signature': validSignature,
      'content-type': 'application/json',
    },
    body: BODY_JSON,
    duplex: 'half' as never,
  })
})

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('verifyS2SRequest — timing benchmarks (on-demand, not CI)', () => {
  bench('happy path: valid secret + valid signature', async () => {
    await verifyS2SRequest(validRequestTemplate.clone(), {
      secretStore: async () => VALID_SECRET,
    })
  })

  bench('client_unknown: secretStore returns null (dummy HMAC path)', async () => {
    await verifyS2SRequest(unknownClientRequestTemplate.clone(), {
      secretStore: async () => null,
    })
  })

  bench('signature_invalid: valid secret + tampered signature', async () => {
    await verifyS2SRequest(invalidSigRequestTemplate.clone(), {
      secretStore: async () => VALID_SECRET,
    })
  })
})

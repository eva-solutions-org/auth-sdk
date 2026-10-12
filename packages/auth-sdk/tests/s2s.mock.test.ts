/**
 * Tests para src/s2s/sign.ts + src/s2s/client.ts
 *
 * T-027 — Batch 4
 * REQ-S2S-01, REQ-S2S-02, REQ-S2S-03, REQ-S2S-04, REQ-S2S-05, REQ-INT-01, REQ-INT-02 cubiertos.
 *
 * Estrategia:
 * - sign.ts: vectores conocidos del canonical string + comparación exacta con el algoritmo.
 * - client.ts: mock fetch global + assertions sobre headers S2S y retorno Result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildS2SCanonicalString,
  signS2SRequest,
  EMPTY_BODY_SHA256_HEX,
} from '../src/s2s/sign'
import { createS2SClient } from '../src/s2s/client'
import type { S2SCanonicalParts } from '../src/s2s/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_HEX = 'deadbeef'.repeat(8) // 64 hex chars = 32 bytes
const CLIENT_ID = 'mi-servicio'
const NONCE = '00112233445566778899aabbccddeeff'
const BASE_URL = 'https://auth.test'

// ---------------------------------------------------------------------------
// T-027a: Tests de buildS2SCanonicalString + signS2SRequest
// ---------------------------------------------------------------------------

describe('buildS2SCanonicalString', () => {
  it('GET sin body y sin query: usa EMPTY_BODY_SHA256_HEX', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/users/user-123',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const canonical = await buildS2SCanonicalString(parts)
    const lines = canonical.split('\n')

    expect(lines).toHaveLength(7)
    expect(lines[0]).toBe('GET')
    expect(lines[1]).toBe('/internal/users/user-123')
    expect(lines[2]).toBe('') // query vacío
    expect(lines[3]).toBe('1700000000')
    expect(lines[4]).toBe(NONCE)
    expect(lines[5]).toBe(CLIENT_ID)
    expect(lines[6]).toBe(EMPTY_BODY_SHA256_HEX)
  })

  it('método en lowercase es normalizado a UPPERCASE', async () => {
    const parts: S2SCanonicalParts = {
      method: 'post',
      path: '/internal/users/batch',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const canonical = await buildS2SCanonicalString(parts)
    expect(canonical.split('\n')[0]).toBe('POST')
  })

  it('POST con body: body hash es diferente a EMPTY_BODY_SHA256_HEX', async () => {
    const bodyJson = '{"ids":["user-1","user-2"]}'
    const bodyBytes = new TextEncoder().encode(bodyJson)

    const parts: S2SCanonicalParts = {
      method: 'POST',
      path: '/internal/users/batch',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes,
    }

    const canonical = await buildS2SCanonicalString(parts)
    const bodyHash = canonical.split('\n')[6]

    expect(bodyHash).not.toBe(EMPTY_BODY_SHA256_HEX)
    expect(bodyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('query string canonicalizado: params ordenados por nombre', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/webhooks/deliveries',
      rawQuery: 'limit=10&offset=0',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const canonical = await buildS2SCanonicalString(parts)
    const queryLine = canonical.split('\n')[2]

    // limit < offset alfabéticamente → limit primero
    expect(queryLine).toBe('limit=10&offset=0')
  })

  it('query string canonicalizado: params desordenados son reordenados', async () => {
    const partsOrdenado: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/webhooks/deliveries',
      rawQuery: 'limit=10&status=pending',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const partsDesordenado: S2SCanonicalParts = {
      ...partsOrdenado,
      rawQuery: 'status=pending&limit=10', // invertido
    }

    const canonical1 = await buildS2SCanonicalString(partsOrdenado)
    const canonical2 = await buildS2SCanonicalString(partsDesordenado)

    // Ambos deben producir el mismo canonical
    expect(canonical1).toBe(canonical2)
  })

  it('canonical es determinista: mismos inputs → mismos outputs', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/users/user-abc',
      rawQuery: '',
      timestamp: '1700000001',
      nonce: NONCE,
      clientId: 'otro-servicio',
      bodyBytes: new Uint8Array(0),
    }

    const c1 = await buildS2SCanonicalString(parts)
    const c2 = await buildS2SCanonicalString(parts)

    expect(c1).toBe(c2)
  })
})

describe('signS2SRequest', () => {
  it('retorna string con formato "sha256=${hex64}"', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/users/user-1',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const sig = await signS2SRequest({ parts, secretHex: SECRET_HEX })

    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('firma determinista: mismos inputs → misma firma', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/users/user-1',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const sig1 = await signS2SRequest({ parts, secretHex: SECRET_HEX })
    const sig2 = await signS2SRequest({ parts, secretHex: SECRET_HEX })

    expect(sig1).toBe(sig2)
  })

  it('secretHex diferente → firma diferente', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/users/user-1',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const otherSecret = 'cafebabe'.repeat(8)
    const sig1 = await signS2SRequest({ parts, secretHex: SECRET_HEX })
    const sig2 = await signS2SRequest({ parts, secretHex: otherSecret })

    expect(sig1).not.toBe(sig2)
  })

  it('secretHex inválido (longitud impar) → lanza Error', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/test',
      rawQuery: '',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    await expect(
      signS2SRequest({ parts, secretHex: 'abc' }), // impar
    ).rejects.toThrow(/s2s.*secretHex/i)
  })

  it('timestamp distinto → firma distinta (garantía de anti-replay)', async () => {
    const baseParts: Omit<S2SCanonicalParts, 'timestamp'> = {
      method: 'GET',
      path: '/internal/users/user-1',
      rawQuery: '',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const sig1 = await signS2SRequest({
      parts: { ...baseParts, timestamp: '1700000000' },
      secretHex: SECRET_HEX,
    })
    const sig2 = await signS2SRequest({
      parts: { ...baseParts, timestamp: '1700000001' }, // 1s después
      secretHex: SECRET_HEX,
    })

    expect(sig1).not.toBe(sig2)
  })
})

// ---------------------------------------------------------------------------
// T-027b: Tests del S2SClient (mock fetch)
// ---------------------------------------------------------------------------

describe('S2SClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const mockConfig = {
    clientId: CLIENT_ID,
    secretHex: SECRET_HEX,
    baseUrl: BASE_URL,
  }

  const mockUser = {
    id: 'user-1',
    phone: '+541234567890',
    stateAccount: 'activo',
    privacyState: 'publico',
  }

  // ─── getUser: happy path ──────────────────────────────────────────────────

  it('getUser: happy path — retorna Result ok con user', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: mockUser } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.getUser('user-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.user).toEqual(mockUser)
  })

  it('getUser: envía headers S2S correctos (client-id, timestamp, signature)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: mockUser } }),
    })

    const s2s = createS2SClient(mockConfig)
    await s2s.getUser('user-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toContain('/api/v1/internal/users/user-1')
    expect(options.method).toBe('GET')
    expect((options.headers as Record<string, string>)['x-eva-client-id']).toBe(
      CLIENT_ID,
    )
    expect(
      (options.headers as Record<string, string>)['x-eva-timestamp'],
    ).toMatch(/^\d+$/)
    expect((options.headers as Record<string, string>)['x-eva-nonce']).toMatch(
      /^[0-9a-f]{32}$/,
    )
    expect(
      (options.headers as Record<string, string>)['x-eva-signature'],
    ).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('cada llamada envía un nonce distinto', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: mockUser } }),
    })

    const s2s = createS2SClient(mockConfig)
    await s2s.getUser('user-1')
    await s2s.getUser('user-1')

    const nonces = fetchMock.mock.calls.map(
      ([, options]) =>
        ((options as RequestInit).headers as Record<string, string>)[
          'x-eva-nonce'
        ],
    )
    expect(nonces).toHaveLength(2)
    expect(nonces[0]).not.toBe(nonces[1])
  })

  it('getUser: error HTTP 401 → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'unauthorized', message: 'Unauthorized' },
      }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.getUser('user-1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(401)
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'unauthorized',
    )
  })

  // ─── batchUsers ──────────────────────────────────────────────────────────

  it('batchUsers: POST con body correcto y retorna lista de usuarios', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { users: [mockUser] } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.batchUsers({ ids: ['user-1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.users).toHaveLength(1)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ ids: ['user-1'] })
  })

  // ─── createWebhookSubscription ───────────────────────────────────────────

  it('createWebhookSubscription: happy path — retorna subscription con signingKey', async () => {
    const mockSubscription = {
      id: 'sub-1',
      clientId: CLIENT_ID,
      url: 'https://mi-app.com/webhooks',
      eventCodes: ['user.created'],
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          subscription: mockSubscription,
          signingKey: 'a'.repeat(64),
        },
      }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.createWebhookSubscription({
      url: 'https://mi-app.com/webhooks',
      eventCodes: ['user.created'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.subscription.id).toBe('sub-1')
    expect(result.data.signingKey).toBe('a'.repeat(64))
  })

  // ─── deleteWebhookSubscription: 204 No Content ───────────────────────────

  it('deleteWebhookSubscription: 204 No Content → Result ok:true data undefined', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('No body')
      },
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.deleteWebhookSubscription('sub-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBeUndefined()
  })

  // ─── Error de red ─────────────────────────────────────────────────────────

  it('error de red (fetch lanza) → Result ok:false EvaSdkError reason:network status:0', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.getUser('user-1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.status).toBe(0)
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'network',
    )
    expect(result.error.message).toBe('ECONNREFUSED')
  })

  // ─── listWebhookDeliveries: query params ──────────────────────────────────

  it('listWebhookDeliveries: query params incluidos en URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { deliveries: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    await s2s.listWebhookDeliveries({ limit: 5, status: 'pending' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toContain('limit=5')
    expect(url).toContain('status=pending')
  })

  it('listWebhookDeliveries: sin query params → URL sin "?"', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { deliveries: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    await s2s.listWebhookDeliveries()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('?')
  })

  // ─── rotateWebhookSubscriptionSecret ─────────────────────────────────────

  it('rotateWebhookSubscriptionSecret: retorna nuevo signingKey', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'sub-1',
          signingKey: 'b'.repeat(64),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.rotateWebhookSubscriptionSecret('sub-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.signingKey).toBe('b'.repeat(64))
  })

  // ─── Ventana de timestamp: firma incluye timestamp reciente ──────────────

  it('firma incluye timestamp de los últimos 120s (REQ-S2S-05)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: mockUser } }),
    })

    const beforeCall = Math.floor(Date.now() / 1000)

    const s2s = createS2SClient(mockConfig)
    await s2s.getUser('user-1')

    const afterCall = Math.floor(Date.now() / 1000)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentTimestamp = parseInt(
      (options.headers as Record<string, string>)['x-eva-timestamp'],
    )

    expect(sentTimestamp).toBeGreaterThanOrEqual(beforeCall)
    expect(sentTimestamp).toBeLessThanOrEqual(afterCall + 1)
  })

  // ─── Batch-14 G5: batchUsers — validación client-side ────────────────────

  it('batchUsers: 101 IDs → error-result sin fetch (Batch-14 G5)', async () => {
    const s2s = createS2SClient(mockConfig)
    const ids = Array.from({ length: 101 }, (_, i) => `user-${i}`)
    const result = await s2s.batchUsers({ ids })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'malformed',
    )
    expect(result.error.status).toBe(0)
    // No debe haber llamado a fetch
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('batchUsers: exactamente 100 IDs → hace fetch normalmente (Batch-14 G5)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { users: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    const ids = Array.from({ length: 100 }, (_, i) => `user-${i}`)
    const result = await s2s.batchUsers({ ids })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  // ─── Batch-14 G6: listWebhookDeliveries — validación client-side ─────────

  it('listWebhookDeliveries: limit 0 → error-result sin fetch (Batch-14 G6)', async () => {
    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ limit: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'malformed',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listWebhookDeliveries: limit 101 → error-result sin fetch (Batch-14 G6)', async () => {
    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ limit: 101 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'malformed',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listWebhookDeliveries: offset -1 → error-result sin fetch (Batch-14 G6)', async () => {
    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ offset: -1 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'malformed',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listWebhookDeliveries: limit 1 → hace fetch normalmente (Batch-14 G6)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { deliveries: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ limit: 1 })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('listWebhookDeliveries: limit 100 → hace fetch normalmente (Batch-14 G6)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { deliveries: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ limit: 100 })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('listWebhookDeliveries: offset 0 → hace fetch normalmente (Batch-14 G6)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { deliveries: [] } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ offset: 0 })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// T-013: createS2SClient — validación baseUrl (REQ-S2S-01..05, REQ-HTTPS-01..11)
// ---------------------------------------------------------------------------

describe('createS2SClient — validación baseUrl', () => {
  const validConfig = { clientId: CLIENT_ID, secretHex: SECRET_HEX }

  it('baseUrl https válido no lanza (REQ-S2S-01)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'https://auth.example.com' }),
    ).not.toThrow()
  })

  it('baseUrl http://localhost no lanza — loopback permitido (REQ-S2S-03, REQ-HTTPS-03)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://localhost:4000' }),
    ).not.toThrow()
  })

  it('baseUrl http://127.0.0.1 no lanza — loopback 127.x.x.x (REQ-HTTPS-04)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://127.0.0.1:8080' }),
    ).not.toThrow()
  })

  it('baseUrl http://[::1] no lanza — loopback IPv6 (REQ-HTTPS-04)', () => {
    // new URL('http://[::1]:4000').hostname devuelve '[::1]' (CON corchetes) en Node.js 20+ (WHATWG Ada 2.0).
    // La rama '::1' (sin corchetes) en validateHttpsUrl es defensa/dead-code en Node 20+.
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://[::1]:4000' }),
    ).not.toThrow()
  })

  it('baseUrl http no-loopback lanza sincrónicamente con label en mensaje (REQ-S2S-02, REQ-S2S-04, REQ-S2S-05)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://auth.example.com' }),
    ).toThrow(/S2SClientConfig\.baseUrl/)
  })

  it('baseUrl http://192.168.1.1 lanza — no-loopback (REQ-HTTPS-06)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://192.168.1.1' }),
    ).toThrow(/se requiere https/)
  })

  it('baseUrl protocolo inválido (ftp:) lanza (REQ-HTTPS-07)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'ftp://auth.example.com' }),
    ).toThrow(/protocolo no soportado/)
  })

  it('baseUrl malformada lanza con mensaje "malformada" (REQ-HTTPS-08)', () => {
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'not-a-url' }),
    ).toThrow(/malformada/)
  })

  // ─── CWE-319: bypass loopback por hostname no-IPv4 con prefijo "127." ────────
  // Verifica que el fix de startsWith('127.') → regex anclada /^127(?:\.\d{1,3}){3}$/
  // cierra el vector donde un atacante usa http://127.evil.com para eludir el check.

  it('baseUrl http://127.evil.com RECHAZADO — bypass CWE-319 cerrado (fix B6.5)', () => {
    // '127.evil.com' pasa startsWith('127.') pero NO la regex anclada ^127(?:\.\d{1,3}){3}$
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://127.evil.com' }),
    ).toThrow(/se requiere https/)
  })

  it('baseUrl http://127.0.0.1.evil.com RECHAZADO — no es loopback IPv4 (fix B6.5)', () => {
    // Node.js no normaliza este hostname; la regex anclada lo rechaza correctamente
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://127.0.0.1.evil.com' }),
    ).toThrow(/se requiere https/)
  })

  it('baseUrl http://127.0.0.2 no lanza — loopback 127.x.x.x válido (REQ-HTTPS-11)', () => {
    // Confirma que la regex /^127(?:\.\d{1,3}){3}$/ acepta toda la subred 127.x.x.x
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://127.0.0.2' }),
    ).not.toThrow()
  })

  it('baseUrl http://127.100.50.1 no lanza — subred 127.x.x.x (REQ-HTTPS-11)', () => {
    // Cubre explícitamente REQ-HTTPS-11: cualquier 127.x.x.x es loopback según RFC 5735
    expect(() =>
      createS2SClient({ ...validConfig, baseUrl: 'http://127.100.50.1' }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// REQ-SDK-13 / D-04: the batch cap is the contract constant, applied before any network call
// ---------------------------------------------------------------------------

describe('batchUsers cap comes from the contract (REQ-SDK-13)', () => {
  const config = {
    clientId: CLIENT_ID,
    secretHex: SECRET_HEX,
    baseUrl: BASE_URL,
  }

  it('users_batch_over_cap_rejected_before_network', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const { USERS_BATCH_MAX_IDS } =
      await import('@eva_solutions/auth-contracts')
    const ids = Array.from(
      { length: USERS_BATCH_MAX_IDS + 1 },
      (_, i) => `u-${i}`,
    )

    const result = await createS2SClient(config).batchUsers({ ids })

    expect(USERS_BATCH_MAX_IDS).toBe(100)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatchObject({ kind: 'sdk', reason: 'malformed' })
    expect(result.error.message).toContain(String(USERS_BATCH_MAX_IDS))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('users_batch_at_cap_sends_the_request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { users: [] } }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const { USERS_BATCH_MAX_IDS } =
      await import('@eva_solutions/auth-contracts')
    const ids = Array.from({ length: USERS_BATCH_MAX_IDS }, (_, i) => `u-${i}`)

    const result = await createS2SClient(config).batchUsers({ ids })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

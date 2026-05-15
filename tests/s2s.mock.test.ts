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
import { buildS2SCanonicalString, signS2SRequest, EMPTY_BODY_SHA256_HEX } from '../src/s2s/sign'
import { createS2SClient } from '../src/s2s/client'
import type { S2SCanonicalParts } from '../src/s2s/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_HEX = 'deadbeef'.repeat(8) // 64 hex chars = 32 bytes
const CLIENT_ID = 'mi-servicio'
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
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }

    const canonical = await buildS2SCanonicalString(parts)
    const lines = canonical.split('\n')

    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('GET')
    expect(lines[1]).toBe('/internal/users/user-123')
    expect(lines[2]).toBe('') // query vacío
    expect(lines[3]).toBe('1700000000')
    expect(lines[4]).toBe(CLIENT_ID)
    expect(lines[5]).toBe(EMPTY_BODY_SHA256_HEX)
  })

  it('método en lowercase es normalizado a UPPERCASE', async () => {
    const parts: S2SCanonicalParts = {
      method: 'post',
      path: '/internal/users/batch',
      rawQuery: '',
      timestamp: '1700000000',
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
      clientId: CLIENT_ID,
      bodyBytes,
    }

    const canonical = await buildS2SCanonicalString(parts)
    const bodyHash = canonical.split('\n')[5]

    expect(bodyHash).not.toBe(EMPTY_BODY_SHA256_HEX)
    expect(bodyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('query string canonicalizado: params ordenados por nombre', async () => {
    const parts: S2SCanonicalParts = {
      method: 'GET',
      path: '/internal/webhooks/deliveries',
      rawQuery: 'limit=10&offset=0',
      timestamp: '1700000000',
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
    global.fetch = fetchMock
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

    expect(url).toContain('/internal/users/user-1')
    expect(options.method).toBe('GET')
    expect((options.headers as Record<string, string>)['x-eva-client-id']).toBe(CLIENT_ID)
    expect((options.headers as Record<string, string>)['x-eva-timestamp']).toMatch(/^\d+$/)
    expect((options.headers as Record<string, string>)['x-eva-signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('getUser: error HTTP 401 → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', message: 'Unauthorized' } }),
    })

    const s2s = createS2SClient(mockConfig)
    const result = await s2s.getUser('user-1')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(401)
    expect((result.error as { kind: 'api'; code: string }).code).toBe('unauthorized')
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
      json: async () => { throw new Error('No body') },
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
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('network')
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
    const sentTimestamp = parseInt((options.headers as Record<string, string>)['x-eva-timestamp'])

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
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('malformed')
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
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('malformed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listWebhookDeliveries: limit 101 → error-result sin fetch (Batch-14 G6)', async () => {
    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ limit: 101 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('malformed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listWebhookDeliveries: offset -1 → error-result sin fetch (Batch-14 G6)', async () => {
    const s2s = createS2SClient(mockConfig)
    const result = await s2s.listWebhookDeliveries({ offset: -1 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('malformed')
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

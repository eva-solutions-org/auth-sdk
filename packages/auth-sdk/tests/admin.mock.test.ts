/**
 * Tests para src/admin/client.ts
 *
 * T-028 — Batch 4
 * REQ-ADMIN-01, REQ-ADMIN-02, REQ-ADMIN-03, REQ-ADMIN-04, REQ-ADMIN-05, REQ-RESTORE-01 cubiertos.
 *
 * Estrategia: mock fetch global + assertions sobre paths, payloads y retorno Result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAdminClient } from '../src/admin/client'
import { ADMIN_ERROR_CODES } from '../src/admin/error-codes'
import { verifyS2SRequest } from '../src/s2s/verify'
import type { Result } from '../src/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_SLUG = 'admin-arturo'
const ADMIN_SECRET_HEX = 'ab'.repeat(32)
const BASE_URL = 'https://auth.test'

const mockConfig = {
  clientId: ADMIN_SLUG,
  secretHex: ADMIN_SECRET_HEX,
  baseUrl: BASE_URL,
}

const mockServiceClient = {
  id: 'sc-id-1',
  slug: 'mi-servicio',
  name: 'Mi Servicio',
  enabled: true,
  scopes: ['users:read'],
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// T-028: Tests del AdminClient
// ---------------------------------------------------------------------------

describe('AdminClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  // ─── Autenticación: firma HMAC S2S ───────────────────────────────────────

  it('firma cada request con HMAC S2S verificable y no envía password', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { clientes: [] } }),
    })

    const admin = createAdminClient(mockConfig)
    await admin.createServiceClient({ slug: 'mi-servicio', scopes: ['admin'] })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['x-admin-password']).toBeUndefined()
    expect(headers['x-eva-client-id']).toBe(ADMIN_SLUG)

    // La firma cubre método, path, query y los bytes exactos del body enviado.
    const verified = await verifyS2SRequest(
      new Request(url, {
        method: options.method,
        headers,
        body: options.body as string,
      }),
      { secretStore: async () => ADMIN_SECRET_HEX },
    )
    expect(verified).toEqual({ ok: true, data: { clientId: ADMIN_SLUG } })

    const tampered = await verifyS2SRequest(
      new Request(url, {
        method: options.method,
        headers,
        body: JSON.stringify({ slug: 'otro', scopes: ['admin'] }),
      }),
      { secretStore: async () => ADMIN_SECRET_HEX },
    )
    expect(tampered.ok).toBe(false)
  })

  it('cada request lleva un nonce distinto', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { clientes: [] } }),
    })

    const admin = createAdminClient(mockConfig)
    await admin.listServiceClients()
    await admin.listServiceClients()

    const nonces = fetchMock.mock.calls.map(
      (call) =>
        ((call as [string, RequestInit])[1].headers as Record<string, string>)[
          'x-eva-nonce'
        ],
    )
    expect(nonces).toHaveLength(2)
    expect(nonces[0]).not.toBe(nonces[1])
  })

  // ─── createServiceClient (REQ-ADMIN-01) ──────────────────────────────────

  it('createServiceClient: happy path — POST /admin/service-clients', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'sc-id-1',
          slug: 'mi-servicio',
          name: 'Mi Servicio',
          scopes: ['users:read'],
          enabled: true,
          secret: 'hex-secret-value',
          warning: 'Guarda este secreto ahora',
        },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.createServiceClient({
      slug: 'mi-servicio',
      scopes: ['users:read'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.slug).toBe('mi-servicio')
    expect(result.data.secret).toBe('hex-secret-value')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/service-clients`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({
      slug: 'mi-servicio',
      scopes: ['users:read'],
    })
  })

  it('createServiceClient: error 409 conflict → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: 'conflict', message: 'Slug ya existe' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.createServiceClient({ slug: 'ya-existe' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(409)
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'conflict',
    )
    expect(result.error.message).toBe('Slug ya existe')
  })

  // ─── listServiceClients (REQ-ADMIN-02) ───────────────────────────────────

  it('listServiceClients: GET /admin/service-clients — retorna lista', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { clientes: [mockServiceClient] } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.listServiceClients()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.clientes).toHaveLength(1)
    expect(result.data.clientes[0]!.slug).toBe('mi-servicio')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/service-clients`)
    expect(options.method).toBe('GET')
  })

  // ─── getServiceClient (REQ-ADMIN-02) ─────────────────────────────────────

  it('getServiceClient: GET /admin/service-clients/:slug — retorna cliente', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { cliente: mockServiceClient } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.getServiceClient('mi-servicio')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cliente.id).toBe('sc-id-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/service-clients/mi-servicio`)
  })

  it('getServiceClient: 404 not_found → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: 'not_found', message: 'Service client no encontrado' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.getServiceClient('inexistente')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(404)
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'not_found',
    )
  })

  // ─── updateServiceClient (REQ-ADMIN-03) ──────────────────────────────────

  it('updateServiceClient: PATCH /admin/service-clients/:slug', async () => {
    const updatedClient = { ...mockServiceClient, enabled: false }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { cliente: updatedClient } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.updateServiceClient('mi-servicio', {
      enabled: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cliente.enabled).toBe(false)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/service-clients/mi-servicio`)
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body as string)).toEqual({ enabled: false })
  })

  // ─── deleteServiceClient (REQ-ADMIN-04) — 204 No Content ─────────────────

  it('deleteServiceClient: DELETE /admin/service-clients/:slug — 204 → Result ok:true', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('No body')
      },
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.deleteServiceClient('mi-servicio')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBeUndefined()

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/service-clients/mi-servicio`)
    expect(options.method).toBe('DELETE')
  })

  // ─── rotateServiceClientSecret (REQ-ADMIN-05) ────────────────────────────

  it('rotateServiceClientSecret: POST /admin/service-clients/:slug/rotate-secret', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          slug: 'mi-servicio',
          secret: 'nuevo-secret-hex',
          warning: 'Actualiza el secret en tus services',
        },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.rotateServiceClientSecret('mi-servicio')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.secret).toBe('nuevo-secret-hex')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `${BASE_URL}/api/v1/admin/service-clients/mi-servicio/rotate-secret`,
    )
    expect(options.method).toBe('POST')
  })

  it('rotateServiceClientSecret: 409 service_client_secret_rotation_conflict → EvaApiError sin secret, comparable con ADMIN_ERROR_CODES', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'service_client_secret_rotation_conflict',
          message: 'Otra rotación cambió el secret al mismo tiempo',
        },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.rotateServiceClientSecret('mi-servicio')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(409)
    if (result.error.kind !== 'api') return
    expect(result.error.code).toBe(
      ADMIN_ERROR_CODES.service_client_secret_rotation_conflict,
    )
  })

  // ─── restoreUser (REQ-RESTORE-01) ────────────────────────────────────────

  it('restoreUser: POST /admin/users/:id/restore — happy path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          userId: 'user-to-restore',
          stateAccount: 'no_verificado',
          previouslyDeletedAt: '2025-01-01T00:00:00.000Z',
          restoredAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.restoreUser('user-to-restore')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.userId).toBe('user-to-restore')
    expect(result.data.stateAccount).toBe('no_verificado')
    expect(result.data.previouslyDeletedAt).toBe('2025-01-01T00:00:00.000Z')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/users/user-to-restore/restore`)
    expect(options.method).toBe('POST')
  })

  it('restoreUser: 404 → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: 'not_found', message: 'Usuario no encontrado' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.restoreUser('no-existe')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(404)
  })

  // ─── last_admin_client (409) ──────────────────────────────────────────────

  it('deleteServiceClient: 409 last_admin_client → EvaApiError comparable con ADMIN_ERROR_CODES', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'last_admin_client',
          message: 'Es el último service client admin habilitado',
        },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.deleteServiceClient(ADMIN_SLUG)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(409)
    if (result.error.kind !== 'api') return
    expect(result.error.code).toBe(ADMIN_ERROR_CODES.last_admin_client)
  })

  // ─── republishPendingWebhooks ─────────────────────────────────────────────

  it('republishPendingWebhooks: POST con query firmado y data { republished, hasMore }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { republished: 3, hasMore: true } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.republishPendingWebhooks({
      older_than_minutes: 30,
      limit: 50,
    })

    expect(result).toEqual({
      ok: true,
      data: { republished: 3, hasMore: true },
    })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `${BASE_URL}/api/v1/admin/webhooks/republish-pending?older_than_minutes=30&limit=50`,
    )
    expect(options.method).toBe('POST')
    expect(options.body).toBeUndefined()
    // El query entra en la firma: el verificador lo lee de la URL.
    const verified = await verifyS2SRequest(
      new Request(url, {
        method: 'POST',
        headers: options.headers as HeadersInit,
      }),
      { secretStore: async () => ADMIN_SECRET_HEX },
    )
    expect(verified.ok).toBe(true)
  })

  it('republishPendingWebhooks: sin query no agrega "?" y deja los defaults al API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { republished: 0, hasMore: false } }),
    })

    const admin = createAdminClient(mockConfig)
    await admin.republishPendingWebhooks()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/webhooks/republish-pending`)
  })

  it('republishPendingWebhooks: 503 service_unavailable → EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 'service_unavailable', message: 'QStash no disponible' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.republishPendingWebhooks()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(503)
    if (result.error.kind !== 'api') return
    expect(result.error.code).toBe('service_unavailable')
  })

  // ─── maintenanceCleanup ───────────────────────────────────────────────────

  it('maintenanceCleanup: POST con limit firmado y data { usersPurged, eventsDeleted, hasMore }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { usersPurged: 2, eventsDeleted: 7, hasMore: true },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.maintenanceCleanup({ limit: 25 })

    expect(result).toEqual({
      ok: true,
      data: { usersPurged: 2, eventsDeleted: 7, hasMore: true },
    })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/maintenance/cleanup?limit=25`)
    expect(options.method).toBe('POST')
    expect(options.body).toBeUndefined()
    // El query entra en la firma: el verificador lo lee de la URL.
    const verified = await verifyS2SRequest(
      new Request(url, {
        method: 'POST',
        headers: options.headers as HeadersInit,
      }),
      { secretStore: async () => ADMIN_SECRET_HEX },
    )
    expect(verified.ok).toBe(true)
  })

  it('maintenanceCleanup: sin query no agrega "?" y deja el default al API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { usersPurged: 0, eventsDeleted: 0, hasMore: false },
      }),
    })

    const admin = createAdminClient(mockConfig)
    await admin.maintenanceCleanup()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/maintenance/cleanup`)
  })

  it('maintenanceCleanup: 403 forbidden → EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: 'forbidden', message: 'Sin scope admin' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.maintenanceCleanup()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(403)
    if (result.error.kind !== 'api') return
    expect(result.error.code).toBe('forbidden')
  })

  // ─── Error de red ─────────────────────────────────────────────────────────

  it('error de red (fetch lanza) → Result ok:false EvaSdkError reason:network status:0', async () => {
    fetchMock.mockRejectedValue(new Error('Connection refused'))

    const admin = createAdminClient(mockConfig)
    const result = await admin.listServiceClients()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.status).toBe(0)
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'network',
    )
    expect(result.error.message).toBe('Connection refused')
  })

  // ─── Error con body no-JSON (malformed) ──────────────────────────────────

  it('error HTTP con body no parseable → EvaSdkError reason:malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not JSON')
      },
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.listServiceClients()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.status).toBe(503)
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe(
      'malformed',
    )
  })

  // ─── Error 401 Unauthorized (firma inválida) ──────────────────────

  it('createServiceClient: 401 Unauthorized → EvaApiError code:unauthorized', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'unauthorized', message: 'Acceso no autorizado' },
      }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.createServiceClient({ slug: 'test' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect((result.error as { kind: 'api'; code: string }).code).toBe(
      'unauthorized',
    )
  })
})

// ---------------------------------------------------------------------------
// T-014: createAdminClient — validación baseUrl (REQ-ADMIN-01..05)
// ---------------------------------------------------------------------------

describe('AdminClient — params de path (slug / userId)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const calls: Array<
    [
      string,
      (admin: ReturnType<typeof createAdminClient>, v: string) => unknown,
    ]
  > = [
    ['getServiceClient', (a, v) => a.getServiceClient(v)],
    ['updateServiceClient', (a, v) => a.updateServiceClient(v, {})],
    ['deleteServiceClient', (a, v) => a.deleteServiceClient(v)],
    ['rotateServiceClientSecret', (a, v) => a.rotateServiceClientSecret(v)],
    ['restoreUser', (a, v) => a.restoreUser(v)],
  ]

  it.each(calls)(
    '%s: codifica el param como UN segmento (sin doble codificación)',
    async (_name, call) => {
      const admin = createAdminClient(mockConfig)
      await call(admin, '../x/y?z#w')
      await call(admin, 'a b')
      await call(admin, 'a%2Fb')

      const urls = fetchMock.mock.calls.map((c) => (c[0] as string).split('/'))
      // `/api/v1/admin/<recurso>/<segmento>[/accion]`: el segmento nunca aporta barras.
      const segmentOf = (url: string[]) => url[url.indexOf('admin') + 2]
      expect(segmentOf(urls[0]!)).toBe('..%2Fx%2Fy%3Fz%23w')
      expect(segmentOf(urls[1]!)).toBe('a%20b')
      // un `%` ya presente se codifica UNA vez (`%25`), no se reinterpreta ni se duplica
      expect(segmentOf(urls[2]!)).toBe('a%252Fb')
    },
  )

  it.each(calls)(
    '%s: param vacío, "." , ".." o no-string → Result error sdk/malformed sin request',
    async (name, call) => {
      const admin = createAdminClient(mockConfig)
      for (const bad of ['', '.', '..', '%2e', '%2E%2e', undefined, null, 42]) {
        const result = (await call(
          admin,
          bad as unknown as string,
        )) as Result<unknown>
        expect(result.ok, String(bad)).toBe(false)
        if (result.ok) return
        expect(result.error).toMatchObject({
          kind: 'sdk',
          reason: 'malformed',
          status: 0,
        })
        expect(result.error.message).toContain(name)
      }
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

describe('createAdminClient — validación baseUrl', () => {
  const validConfig = { clientId: ADMIN_SLUG, secretHex: ADMIN_SECRET_HEX }

  it('baseUrl https válido no lanza (REQ-ADMIN-01)', () => {
    expect(() =>
      createAdminClient({
        ...validConfig,
        baseUrl: 'https://auth.example.com',
      }),
    ).not.toThrow()
  })

  it('baseUrl http://localhost no lanza — loopback permitido (REQ-ADMIN-03)', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'http://localhost:4000' }),
    ).not.toThrow()
  })

  it('baseUrl http://127.0.0.1 no lanza — loopback 127.x.x.x', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'http://127.0.0.1:8080' }),
    ).not.toThrow()
  })

  it('baseUrl http://[::1] no lanza — loopback IPv6', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'http://[::1]:4000' }),
    ).not.toThrow()
  })

  it('baseUrl http no-loopback lanza sincrónicamente con label en mensaje (REQ-ADMIN-02, REQ-ADMIN-04, REQ-ADMIN-05)', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'http://auth.example.com' }),
    ).toThrow(/AdminClientConfig\.baseUrl/)
  })

  it('baseUrl protocolo inválido (ftp:) lanza', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'ftp://auth.example.com' }),
    ).toThrow(/protocolo no soportado/)
  })

  it('baseUrl malformada lanza con mensaje "malformada"', () => {
    expect(() =>
      createAdminClient({ ...validConfig, baseUrl: 'not-a-url' }),
    ).toThrow(/malformada/)
  })
})

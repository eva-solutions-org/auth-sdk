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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = 'super-secret-admin-pwd'
const BASE_URL = 'https://auth.test'

const mockConfig = {
  adminPassword: ADMIN_PASSWORD,
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
// Helper
// ---------------------------------------------------------------------------

function makeFetchMock(options: {
  ok: boolean
  status: number
  body: unknown
}): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status,
    json: async () => options.body,
  })
}

// ---------------------------------------------------------------------------
// T-028: Tests del AdminClient
// ---------------------------------------------------------------------------

describe('AdminClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  // ─── Autenticación: header X-Admin-Password presente ─────────────────────

  it('siempre envía el header X-Admin-Password', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { clientes: [] } }),
    })

    const admin = createAdminClient(mockConfig)
    await admin.listServiceClients()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['x-admin-password']).toBe(ADMIN_PASSWORD)
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
    const result = await admin.createServiceClient({ slug: 'mi-servicio', scopes: ['users:read'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.slug).toBe('mi-servicio')
    expect(result.data.secret).toBe('hex-secret-value')

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/admin/service-clients`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ slug: 'mi-servicio', scopes: ['users:read'] })
  })

  it('createServiceClient: error 409 conflict → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'conflict', message: 'Slug ya existe' } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.createServiceClient({ slug: 'ya-existe' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(409)
    expect((result.error as { kind: 'api'; code: string }).code).toBe('conflict')
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
    expect(url).toBe(`${BASE_URL}/admin/service-clients`)
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
    expect(url).toBe(`${BASE_URL}/admin/service-clients/mi-servicio`)
  })

  it('getServiceClient: 404 not_found → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'Service client no encontrado' } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.getServiceClient('inexistente')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(404)
    expect((result.error as { kind: 'api'; code: string }).code).toBe('not_found')
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
    const result = await admin.updateServiceClient('mi-servicio', { enabled: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.cliente.enabled).toBe(false)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/admin/service-clients/mi-servicio`)
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body as string)).toEqual({ enabled: false })
  })

  // ─── deleteServiceClient (REQ-ADMIN-04) — 204 No Content ─────────────────

  it('deleteServiceClient: DELETE /admin/service-clients/:slug — 204 → Result ok:true', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => { throw new Error('No body') },
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.deleteServiceClient('mi-servicio')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBeUndefined()

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/admin/service-clients/mi-servicio`)
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
    expect(url).toBe(`${BASE_URL}/admin/service-clients/mi-servicio/rotate-secret`)
    expect(options.method).toBe('POST')
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
    expect(url).toBe(`${BASE_URL}/admin/users/user-to-restore/restore`)
    expect(options.method).toBe('POST')
  })

  it('restoreUser: 404 → Result ok:false EvaApiError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not_found', message: 'Usuario no encontrado' } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.restoreUser('no-existe')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect(result.error.status).toBe(404)
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
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('network')
    expect(result.error.message).toBe('Connection refused')
  })

  // ─── Error con body no-JSON (malformed) ──────────────────────────────────

  it('error HTTP con body no parseable → EvaSdkError reason:malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('not JSON') },
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.listServiceClients()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('sdk')
    expect(result.error.status).toBe(503)
    expect((result.error as { kind: 'sdk'; reason: string }).reason).toBe('malformed')
  })

  // ─── Error 401 Unauthorized (contraseña incorrecta) ──────────────────────

  it('createServiceClient: 401 Unauthorized → EvaApiError code:unauthorized', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', message: 'Contraseña incorrecta' } }),
    })

    const admin = createAdminClient(mockConfig)
    const result = await admin.createServiceClient({ slug: 'test' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('api')
    expect((result.error as { kind: 'api'; code: string }).code).toBe('unauthorized')
  })
})

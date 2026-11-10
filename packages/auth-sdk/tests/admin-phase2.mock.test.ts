/**
 * Admin client and user HTTP client, identity phase 2: delegation edges, authorizable permissions,
 * product/audience of a client, holder reassignment, baja/reactivar, contract writes, directory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../src/admin/client'
import { createHttpClient } from '../src/http-client'
import { verifyS2SRequest } from '../src/s2s/verify'

vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
  getProduct: () => 'whatsapp-panel',
}))

const SECRET_HEX = 'ab'.repeat(32)
const BASE_URL = 'https://auth.test'
const API = `${BASE_URL}/api/v1`

let fetchMock: ReturnType<typeof vi.fn>

const ok = (data: unknown, status = 200) => ({
  ok: true,
  status,
  headers: new Headers(),
  json: async () => ({ data }),
})

const admin = () =>
  createAdminClient({
    clientId: 'admin-arturo',
    secretHex: SECRET_HEX,
    baseUrl: BASE_URL,
  })

const sent = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return {
    url,
    method: init.method as string,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    headers: init.headers as Record<string, string>,
    rawBody: init.body as string | undefined,
  }
}

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('admin: delegation edges', () => {
  it('list_set_and_delete_hit_the_delegations_routes', async () => {
    fetchMock.mockResolvedValue(ok({ delegations: [] }))
    await admin().listServiceClientDelegations('ventas-backend')
    expect(sent()).toMatchObject({
      url: `${API}/admin/service-clients/ventas-backend/delegations`,
      method: 'GET',
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      ok({
        delegation: {
          audience: 'whatsapp-api',
          scopes: ['messages:send:text'],
          requiere_scope_origen: [],
        },
      }),
    )
    await admin().setServiceClientDelegation('ventas-backend', {
      audience: 'whatsapp-api',
      scopes: ['messages:send:text'],
      requiere_scope_origen: ['messages:send:media'],
    })
    expect(sent()).toMatchObject({
      url: `${API}/admin/service-clients/ventas-backend/delegations`,
      method: 'PUT',
      body: {
        audience: 'whatsapp-api',
        scopes: ['messages:send:text'],
        requiere_scope_origen: ['messages:send:media'],
      },
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 204 })
    const removed = await admin().deleteServiceClientDelegation(
      'ventas-backend',
      'whatsapp-api',
    )
    expect(removed).toEqual({ ok: true, data: undefined })
    expect(sent()).toMatchObject({
      url: `${API}/admin/service-clients/ventas-backend/delegations/whatsapp-api`,
      method: 'DELETE',
    })
  })

  it('signs_the_request_with_the_admin_hmac', async () => {
    fetchMock.mockResolvedValue(ok({ delegations: [] }))

    await admin().listServiceClientDelegations('ventas-backend')

    const call = sent()
    const verified = await verifyS2SRequest(
      new Request(call.url, { method: call.method, headers: call.headers }),
      { secretStore: async () => SECRET_HEX },
    )
    expect(verified).toEqual({ ok: true, data: { clientId: 'admin-arturo' } })
  })
})

describe('admin: client identity, authorizable permissions, holder, baja and contracts', () => {
  it('updateServiceClient_sends_producto_and_audiencia', async () => {
    fetchMock.mockResolvedValue(ok({ cliente: {} }))

    await admin().updateServiceClient('whatsapp-backend', {
      producto: 'whatsapp-panel',
      audiencia: 'whatsapp-api',
    })

    expect(sent()).toMatchObject({
      method: 'PATCH',
      body: { producto: 'whatsapp-panel', audiencia: 'whatsapp-api' },
    })
  })

  it('product_authorizable_permissions_get_and_put', async () => {
    fetchMock.mockResolvedValue(
      ok({ producto: 'whatsapp-panel', permisos: [] }),
    )
    await admin().getProductoPermisosAutorizables('whatsapp-panel')
    expect(sent()).toMatchObject({
      url: `${API}/admin/productos/whatsapp-panel/permisos-autorizables`,
      method: 'GET',
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      ok({ producto: 'whatsapp-panel', permisos: ['whatsapp:mensajes:leer'] }),
    )
    await admin().setProductoPermisosAutorizables('whatsapp-panel', {
      permisos: ['whatsapp:mensajes:leer'],
    })
    expect(sent()).toMatchObject({
      url: `${API}/admin/productos/whatsapp-panel/permisos-autorizables`,
      method: 'PUT',
      body: { permisos: ['whatsapp:mensajes:leer'] },
    })
  })

  it('reassignEmpresaTitular_posts_the_new_holder', async () => {
    fetchMock.mockResolvedValue(
      ok({ empresaId: 'e1', titularUserId: 'u2', titularAnteriorUserId: null }),
    )

    const result = await admin().reassignEmpresaTitular('e1', {
      userId: 'u2',
      titularAnterior: 'fuera',
    })

    expect(result.ok).toBe(true)
    expect(sent()).toMatchObject({
      url: `${API}/admin/empresas/e1/titular`,
      method: 'POST',
      body: { userId: 'u2', titularAnterior: 'fuera' },
    })
  })

  it('baja_reactivar_and_setContratacion_hit_the_admin_company_routes', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1', estado: 'baja' }))
    await admin().bajaEmpresa('e1')
    expect(sent()).toMatchObject({
      url: `${API}/admin/empresas/e1/baja`,
      method: 'POST',
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok({ id: 'e1', estado: 'activa' }))
    await admin().reactivarEmpresa('e1')
    expect(sent()).toMatchObject({
      url: `${API}/admin/empresas/e1/reactivar`,
      method: 'POST',
    })

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok({ estado: 'activo' }))
    await admin().setContratacion('e1', 'whatsapp-panel', { estado: 'activo' })
    expect(sent()).toMatchObject({
      url: `${API}/admin/empresas/e1/productos/whatsapp-panel`,
      method: 'PUT',
      body: { estado: 'activo' },
    })
  })

  it.each(['', '.', '..'])(
    'rejects_%j_as_an_id_without_a_request',
    async (bad) => {
      const a = admin()
      for (const result of [
        await a.listServiceClientDelegations(bad),
        await a.deleteServiceClientDelegation('x-client', bad),
        await a.getProductoPermisosAutorizables(bad),
        await a.reassignEmpresaTitular(bad, { userId: 'u' }),
        await a.bajaEmpresa(bad),
        await a.reactivarEmpresa(bad),
        await a.setContratacion('e1', bad, { estado: 'activo' }),
      ]) {
        expect(result).toMatchObject({
          ok: false,
          error: { kind: 'sdk', reason: 'malformed' },
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )
})

describe('user HTTP client: GET /directorio', () => {
  it('sends_the_access_token_and_the_filters', async () => {
    fetchMock.mockResolvedValue(ok({ empresas: [], nextCursor: null }))

    const result = await createHttpClient().getDirectorio({
      accessToken: 'user-at',
      q: 'gym',
      ciudad: 'Lima',
    })

    expect(result).toMatchObject({
      ok: true,
      data: { empresas: [], nextCursor: null },
    })
    const call = sent()
    expect(call.url).toBe(
      'http://auth.test/api/v1/directorio?q=gym&ciudad=Lima',
    )
    expect(call.method).toBe('GET')
    expect(call.headers.authorization).toBe('Bearer user-at')
  })

  it('has_no_question_mark_without_filters', async () => {
    fetchMock.mockResolvedValue(ok({ empresas: [], nextCursor: null }))

    await createHttpClient().getDirectorio({ accessToken: 'user-at' })

    expect(sent().url).toBe('http://auth.test/api/v1/directorio')
  })
})

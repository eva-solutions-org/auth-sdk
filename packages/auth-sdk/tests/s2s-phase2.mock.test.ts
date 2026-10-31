/**
 * createS2SClient, identity phase 2: every call a person makes on a company carries the
 * `subjectToken` (body, or the `x-eva-subject-token` header on the GET without a body); contracts,
 * groups, directory and authorizations hit the contract routes; `checkAutorizacion` caches 30 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createS2SClient } from '../src/s2s/client'
import type { ServiceTokenSource } from '../src/s2s/token-provider'

const BASE_URL = 'https://auth.test'
const API = `${BASE_URL}/api/v1`
const UUID = '550e8400-e29b-41d4-a716-446655440000'
const PERSON = 'person.access.token'

let fetchMock: ReturnType<typeof vi.fn>

const ok = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => ({ data }),
})
const noContent = () => ({ ok: true, status: 204 })
const apiError = (status: number, code: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { code, message: 'm' } }),
})

const provider: ServiceTokenSource = {
  getToken: async () => 'svc-token',
  invalidate: () => {},
}
const client = () =>
  createS2SClient({ baseUrl: BASE_URL, tokenProvider: provider })

type Sent = {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}
const sent = (n = 0): Sent => {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit]
  return {
    url,
    method: init.method as string,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    headers: init.headers as Record<string, string>,
  }
}

beforeEach(() => {
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('companies: the person goes in the body', () => {
  it('createEmpresa_posts_the_subject_token_and_no_first_member', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1' }, 201))

    await client().createEmpresa({
      ruc: '20123456789',
      razonSocial: 'Gym SAC',
      slug: 'gym-sac',
      subjectToken: PERSON,
    })

    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas`,
      method: 'POST',
      body: {
        ruc: '20123456789',
        razonSocial: 'Gym SAC',
        slug: 'gym-sac',
        subjectToken: PERSON,
      },
    })
    expect(sent().headers.authorization).toBe('Bearer svc-token')
  })

  it('updateEmpresa_patches_the_company', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1' }))

    await client().updateEmpresa('e1', {
      razonSocial: 'Nueva SAC',
      perfil: { visible: true },
      subjectToken: PERSON,
    })

    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas/e1`,
      method: 'PATCH',
      body: {
        razonSocial: 'Nueva SAC',
        perfil: { visible: true },
        subjectToken: PERSON,
      },
    })
  })

  it('listEmpresas_sends_q_and_cursor_as_a_query', async () => {
    fetchMock.mockResolvedValue(ok({ empresas: [], nextCursor: null }))

    const result = await client().listEmpresas({ q: 'gym sac', cursor: 'c 1' })

    expect(result.ok).toBe(true)
    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas?q=gym%20sac&cursor=c%201`,
      method: 'GET',
    })
  })

  it('listEmpresas_without_a_query_has_no_question_mark', async () => {
    fetchMock.mockResolvedValue(ok({ empresas: [], nextCursor: null }))

    await client().listEmpresas()

    expect(sent().url).toBe(`${API}/internal/empresas`)
  })

  it('getEmpresa_returns_either_view_as_the_API_answers', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        vista: 'recortada',
        id: 'e1',
        razonSocial: 'r',
        estado: 'activa',
        sucursales: [],
      }),
    )

    const result = await client().getEmpresa('e1')

    expect(result).toMatchObject({ ok: true, data: { vista: 'recortada' } })
    if (result.ok && result.data.vista === 'recortada') {
      // Narrowing by `vista` gives the trimmed type: no contact fields exist on it.
      expect('email' in result.data).toBe(false)
    }
  })

  it('bajaEmpresa_and_reactivarEmpresa_post_without_a_person', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'e1', estado: 'baja' }))

    await client().bajaEmpresa('e1')
    await client().reactivarEmpresa('e1')

    expect(sent(0)).toMatchObject({
      url: `${API}/internal/empresas/e1/baja`,
      method: 'POST',
      body: undefined,
    })
    expect(sent(1)).toMatchObject({
      url: `${API}/internal/empresas/e1/reactivar`,
      method: 'POST',
      body: undefined,
    })
  })

  it('setEmpresaMemberRole_patches_the_member', async () => {
    fetchMock.mockResolvedValue(
      ok({ empresaId: 'e1', userId: UUID, rol: 'administrador' }),
    )

    await client().setEmpresaMemberRole('e1', UUID, {
      rol: 'administrador',
      subjectToken: PERSON,
    })

    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas/e1/miembros/${UUID}`,
      method: 'PATCH',
      body: { rol: 'administrador', subjectToken: PERSON },
    })
  })

  it('removeEmpresaMember_deletes_with_the_person_in_the_body', async () => {
    fetchMock.mockResolvedValue(noContent())

    const result = await client().removeEmpresaMember('e1', UUID, {
      subjectToken: PERSON,
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas/e1/miembros/${UUID}`,
      method: 'DELETE',
      body: { subjectToken: PERSON },
    })
  })

  it('updateSucursal_and_deactivateSucursal_hit_the_branch_route', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 's1' }))
    fetchMock.mockResolvedValueOnce(noContent())

    await client().updateSucursal('e1', 's1', {
      nombre: 'Centro 2',
      subjectToken: PERSON,
    })
    const deactivated = await client().deactivateSucursal('e1', 's1', {
      subjectToken: PERSON,
    })

    expect(sent(0)).toMatchObject({
      url: `${API}/internal/empresas/e1/sucursales/s1`,
      method: 'PATCH',
      body: { nombre: 'Centro 2', subjectToken: PERSON },
    })
    expect(sent(1)).toMatchObject({
      url: `${API}/internal/empresas/e1/sucursales/s1`,
      method: 'DELETE',
      body: { subjectToken: PERSON },
    })
    expect(deactivated.ok).toBe(true)
  })
})

describe('contracts of products', () => {
  it('requestContratacion_and_cancelContratacion_carry_the_person', async () => {
    fetchMock.mockResolvedValueOnce(ok({ estado: 'pendiente_pago' }, 201))
    fetchMock.mockResolvedValueOnce(noContent())

    await client().requestContratacion('e1', { subjectToken: PERSON })
    await client().cancelContratacion('e1', { subjectToken: PERSON })

    expect(sent(0)).toMatchObject({
      url: `${API}/internal/empresas/e1/productos`,
      method: 'POST',
      body: { subjectToken: PERSON },
    })
    expect(sent(1)).toMatchObject({
      url: `${API}/internal/empresas/e1/productos`,
      method: 'DELETE',
      body: { subjectToken: PERSON },
    })
  })

  it('getContratacion_asks_whether_the_company_has_the_product', async () => {
    fetchMock.mockResolvedValue(ok({ contratado: true }))

    const result = await client().getContratacion('e1', 'whatsapp-panel')

    expect(result).toEqual({ ok: true, data: { contratado: true } })
    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas/e1/productos/whatsapp-panel`,
      method: 'GET',
    })
  })

  it('setContratacion_puts_state_and_expiry_without_a_person', async () => {
    fetchMock.mockResolvedValue(ok({ estado: 'activo' }))

    await client().setContratacion('e1', 'whatsapp-panel', {
      estado: 'activo',
      hasta: null,
    })

    expect(sent()).toMatchObject({
      url: `${API}/internal/empresas/e1/productos/whatsapp-panel`,
      method: 'PUT',
      body: { estado: 'activo', hasta: null },
    })
  })
})

describe('groups, directory and authorizations', () => {
  it('group_calls_hit_the_group_routes_with_the_person', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'g1' }, 201))
    fetchMock.mockResolvedValueOnce(ok({ id: 'g1' }))
    fetchMock.mockResolvedValueOnce(ok({ id: 'g1' }, 201))
    fetchMock.mockResolvedValueOnce(noContent())

    await client().createGrupo({
      nombre: 'Cadena',
      empresaId: 'e1',
      subjectToken: PERSON,
    })
    await client().renameGrupo('g1', {
      nombre: 'Cadena 2',
      subjectToken: PERSON,
    })
    await client().addGrupoEmpresa('g1', {
      empresaId: 'e2',
      subjectToken: PERSON,
    })
    await client().removeGrupoEmpresa('g1', 'e2', { subjectToken: PERSON })

    expect([0, 1, 2, 3].map((n) => [sent(n).method, sent(n).url])).toEqual([
      ['POST', `${API}/internal/grupos`],
      ['PATCH', `${API}/internal/grupos/g1`],
      ['POST', `${API}/internal/grupos/g1/empresas`],
      ['DELETE', `${API}/internal/grupos/g1/empresas/e2`],
    ])
    expect(sent(3).body).toEqual({ subjectToken: PERSON })
  })

  it('searchDirectorio_sends_the_filters', async () => {
    fetchMock.mockResolvedValue(ok({ empresas: [], nextCursor: null }))

    await client().searchDirectorio({
      q: 'gym',
      rubro: 'Gimnasios',
      ciudad: 'Lima',
    })

    expect(sent()).toMatchObject({
      url: `${API}/directorio?q=gym&rubro=Gimnasios&ciudad=Lima`,
      method: 'GET',
    })
  })

  it('createAutorizacion_and_deleteAutorizacion_carry_the_person_in_the_body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'a1' }, 201))
    fetchMock.mockResolvedValueOnce(noContent())

    await client().createAutorizacion('e1', {
      beneficiariaId: 'e2',
      permiso: 'whatsapp:mensajes:leer',
      subjectToken: PERSON,
    })
    await client().deleteAutorizacion('e1', 'a1', { subjectToken: PERSON })

    expect(sent(0)).toMatchObject({
      url: `${API}/internal/empresas/e1/autorizaciones`,
      method: 'POST',
      body: {
        beneficiariaId: 'e2',
        permiso: 'whatsapp:mensajes:leer',
        subjectToken: PERSON,
      },
    })
    expect(sent(1)).toMatchObject({
      url: `${API}/internal/empresas/e1/autorizaciones/a1`,
      method: 'DELETE',
      body: { subjectToken: PERSON },
    })
  })

  it('listAutorizaciones_sends_the_person_in_the_header_never_in_the_url', async () => {
    fetchMock.mockResolvedValue(ok({ autorizaciones: [] }))

    await client().listAutorizaciones('e1', {
      direccion: 'recibidas',
      subjectToken: PERSON,
    })

    const call = sent()
    expect(call.url).toBe(
      `${API}/internal/empresas/e1/autorizaciones?direccion=recibidas`,
    )
    expect(call.url).not.toContain(PERSON)
    expect(call.method).toBe('GET')
    expect(call.headers['x-eva-subject-token']).toBe(PERSON)
    expect(call.headers.authorization).toBe('Bearer svc-token')
  })
})

describe('a bad person token does not touch the service token', () => {
  const subjectFailure = (status: number) => ({
    ok: false,
    status,
    json: async () => ({
      error: { code: 'subject_token_invalid', message: 'bad person token' },
    }),
  })
  const spyProvider = () => ({
    getToken: vi.fn(async () => 'svc-token'),
    invalidate: vi.fn(),
  })

  it.each([401, 403])(
    'a_%i_subject_token_invalid_makes_no_second_service_token_request',
    async (status) => {
      fetchMock.mockResolvedValue(subjectFailure(status))
      const tokens = spyProvider()

      const result = await createS2SClient({
        baseUrl: BASE_URL,
        tokenProvider: tokens,
      }).addEmpresaMember('e1', { userId: UUID, subjectToken: PERSON })

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'api', code: 'subject_token_invalid', status },
      })
      expect(tokens.getToken).toHaveBeenCalledTimes(1)
      expect(tokens.invalidate).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('a_401_of_the_service_bearer_still_invalidates_and_retries_once', async () => {
    fetchMock
      .mockResolvedValueOnce(apiError(401, 'unauthorized'))
      .mockResolvedValueOnce(
        ok({ empresaId: 'e1', userId: UUID, rol: 'miembro' }, 201),
      )
    const tokens = spyProvider()

    const result = await createS2SClient({
      baseUrl: BASE_URL,
      tokenProvider: tokens,
    }).addEmpresaMember('e1', { userId: UUID, subjectToken: PERSON })

    expect(result.ok).toBe(true)
    expect(tokens.invalidate).toHaveBeenCalledTimes(1)
    expect(tokens.getToken).toHaveBeenCalledTimes(2)
  })
})

describe('ids are one path segment', () => {
  it.each(['', '.', '..'])('rejects_%j_without_a_request', async (bad) => {
    const c = client()

    for (const result of [
      await c.updateEmpresa(bad, { subjectToken: PERSON }),
      await c.bajaEmpresa(bad),
      await c.setEmpresaMemberRole('e1', bad, {
        rol: 'miembro',
        subjectToken: PERSON,
      }),
      await c.updateSucursal('e1', bad, { subjectToken: PERSON }),
      await c.getContratacion('e1', bad),
      await c.renameGrupo(bad, { nombre: 'x', subjectToken: PERSON }),
      await c.removeGrupoEmpresa('g1', bad, { subjectToken: PERSON }),
      await c.deleteAutorizacion('e1', bad, { subjectToken: PERSON }),
      await c.listAutorizaciones(bad, {
        direccion: 'otorgadas',
        subjectToken: PERSON,
      }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'sdk', reason: 'malformed' },
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('checkAutorizacion: 30 s cache', () => {
  const query = {
    otorgante: 'e1',
    beneficiaria: 'e2',
    permiso: 'whatsapp:mensajes:leer',
  } as const

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const advance = (seconds: number) =>
    vi.setSystemTime(Date.now() + seconds * 1000)

  it('asks_the_verify_route_with_the_three_parameters', async () => {
    fetchMock.mockResolvedValue(ok({ autorizado: true }))

    const result = await client().checkAutorizacion(query)

    expect(result).toEqual({ ok: true, data: { autorizado: true } })
    expect(sent()).toMatchObject({
      url: `${API}/internal/autorizaciones/verificar?otorgante=e1&beneficiaria=e2&permiso=whatsapp%3Amensajes%3Aleer`,
      method: 'GET',
    })
  })

  it('serves_the_same_question_from_cache_for_30_seconds', async () => {
    fetchMock.mockResolvedValue(ok({ autorizado: true }))
    const c = client()

    await c.checkAutorizacion(query)
    advance(29)
    const again = await c.checkAutorizacion(query)

    expect(again).toEqual({ ok: true, data: { autorizado: true } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks_again_after_30_seconds_and_sees_a_revocation', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ autorizado: true }))
      .mockResolvedValueOnce(ok({ autorizado: false }))
    const c = client()

    await c.checkAutorizacion(query)
    advance(31)
    const after = await c.checkAutorizacion(query)

    expect(after).toEqual({ ok: true, data: { autorizado: false } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches_a_denial_too', async () => {
    fetchMock.mockResolvedValue(ok({ autorizado: false }))
    const c = client()

    await c.checkAutorizacion(query)
    await c.checkAutorizacion(query)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('another_grantor_beneficiary_or_permission_is_another_entry', async () => {
    fetchMock.mockResolvedValue(ok({ autorizado: true }))
    const c = client()

    await c.checkAutorizacion(query)
    await c.checkAutorizacion({ ...query, otorgante: 'e9' })
    await c.checkAutorizacion({ ...query, beneficiaria: 'e9' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does_not_cache_errors', async () => {
    fetchMock
      .mockResolvedValueOnce(apiError(403, 'forbidden'))
      .mockResolvedValueOnce(ok({ autorizado: true }))
    const c = client()

    const failed = await c.checkAutorizacion(query)
    const retried = await c.checkAutorizacion(query)

    expect(failed).toMatchObject({ ok: false, error: { status: 403 } })
    expect(retried).toEqual({ ok: true, data: { autorizado: true } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the_cache_belongs_to_each_client', async () => {
    fetchMock.mockResolvedValue(ok({ autorizado: true }))

    await client().checkAutorizacion(query)
    await client().checkAutorizacion(query)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

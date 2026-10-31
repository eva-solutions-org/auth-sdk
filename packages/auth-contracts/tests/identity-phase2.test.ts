import { describe, expect, it } from 'vitest'
import * as contract from '../src/index'

const UUID = '550e8400-e29b-41d4-a716-446655440000'
const TOKEN = 'a.b.c'

describe('catalogs: service permissions, delegable permissions and inter-company permissions', () => {
  it('auth_api_gains_the_eight_phase2_permissions', () => {
    for (const scope of [
      'tokens:exchange',
      'contrataciones:pedir',
      'contrataciones:escribir',
      'contrataciones:leer',
      'empresas:baja',
      'autorizaciones:escribir',
      'autorizaciones:leer',
      'directorio:leer',
    ]) {
      expect(contract.isScopeOfAudience('auth-api', scope)).toBe(true)
    }
  })

  it('admin_is_not_delegable_anywhere', () => {
    expect(contract.isDelegableScope('whatsapp-api', 'admin')).toBe(false)
    for (const scopes of Object.values(contract.DELEGABLE_AUDIENCE_SCOPES)) {
      expect(scopes as readonly string[]).not.toContain('admin')
    }
    expect(contract.DELEGABLE_SCOPES as readonly string[]).not.toContain(
      'admin',
    )
  })

  it('auth_api_is_not_a_delegation_destination', () => {
    expect(contract.isDelegableAudience('auth-api')).toBe(false)
    expect(contract.isDelegableScope('auth-api', 'users:read')).toBe(false)
    expect(contract.isDelegableAudience('whatsapp-api')).toBe(true)
    expect(Object.keys(contract.DELEGABLE_AUDIENCE_SCOPES)).not.toContain(
      'auth-api',
    )
  })

  it('every_delegable_scope_is_in_the_audience_catalog', () => {
    for (const audience of contract.DELEGABLE_AUDIENCES) {
      for (const scope of contract.DELEGABLE_AUDIENCE_SCOPES[audience]) {
        expect(contract.isScopeOfAudience(audience, scope)).toBe(true)
      }
    }
    expect([...contract.DELEGABLE_AUDIENCES].sort()).toEqual(
      Object.keys(contract.DELEGABLE_AUDIENCE_SCOPES).sort(),
    )
  })

  it('inter_company_permissions_are_apart_from_the_audience_permissions', () => {
    const serviceScopes = new Set<string>(
      Object.values(contract.SERVICE_AUDIENCE_SCOPES).flat(),
    )
    expect(contract.INTER_EMPRESA_PERMISSION_LIST.length).toBeGreaterThan(0)
    for (const permission of contract.INTER_EMPRESA_PERMISSION_LIST) {
      expect(serviceScopes.has(permission)).toBe(false)
      expect(contract.isScopeOfAudience('auth-api', permission)).toBe(false)
      expect(contract.isInterEmpresaPermission(permission)).toBe(true)
    }
    // And the other way round: a service permission is not an inter-company one.
    for (const scope of serviceScopes) {
      expect(contract.isInterEmpresaPermission(scope)).toBe(false)
    }
  })

  it('inter_company_permissions_belong_to_a_service_audience_that_is_not_auth', () => {
    for (const owner of Object.keys(contract.INTER_EMPRESA_PERMISSIONS)) {
      expect(contract.isServiceAudience(owner)).toBe(true)
      expect(owner).not.toBe('auth-api')
    }
    expect(contract.interEmpresaPermissionOwner('whatsapp:mensajes:leer')).toBe(
      'whatsapp-api',
    )
    expect(contract.interEmpresaPermissionOwner('users:read')).toBeUndefined()
    const flat = [...contract.INTER_EMPRESA_PERMISSION_LIST]
    expect(new Set(flat).size).toBe(flat.length)
  })
})

describe('delegated token vocabulary', () => {
  it('fixes_type_lifetime_depth_and_the_rfc8693_identifiers', () => {
    expect(contract.DELEGATED_TOKEN_TYP).toBe('dlg-at+jwt')
    expect(contract.DELEGATED_TOKEN_LIFETIME_SECONDS).toBe(120)
    expect(contract.DELEGATED_TOKEN_MAX_DEPTH).toBe(3)
    expect(contract.TOKEN_EXCHANGE_GRANT_TYPE).toBe(
      'urn:ietf:params:oauth:grant-type:token-exchange',
    )
    expect(contract.ACCESS_TOKEN_TYPE).toBe(
      'urn:ietf:params:oauth:token-type:access_token',
    )
    expect(contract.SUBJECT_TOKEN_HEADER).toBe('x-eva-subject-token')
  })

  it('the_three_token_types_are_pairwise_different', () => {
    const types = [
      contract.USER_TOKEN_TYP,
      contract.SERVICE_TOKEN_TYP,
      contract.DELEGATED_TOKEN_TYP,
    ]
    expect(new Set(types).size).toBe(3)
  })
})

describe('POST /internal/token-exchange schemas', () => {
  const request = {
    grant_type: contract.TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: TOKEN,
    subject_token_type: contract.ACCESS_TOKEN_TYPE,
    audience: 'whatsapp-api',
  }

  it('accepts_the_rfc8693_request_with_and_without_scope', () => {
    const parse = (body: unknown) =>
      contract.tokenExchangeRequestSchema.safeParse(body).success
    expect(parse(request)).toBe(true)
    expect(parse({ ...request, scope: 'messages:send:text' })).toBe(true)
  })

  it('rejects_a_wrong_grant_type_token_type_missing_field_or_extra_key', () => {
    const parse = (body: unknown) =>
      contract.tokenExchangeRequestSchema.safeParse(body).success
    expect(parse({ ...request, grant_type: 'client_credentials' })).toBe(false)
    expect(
      parse({
        ...request,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      }),
    ).toBe(false)
    for (const key of Object.keys(request)) {
      const { [key]: _omitted, ...rest } = request as Record<string, string>
      expect(parse(rest)).toBe(false)
    }
    expect(parse({ ...request, extra: 1 })).toBe(false)
  })

  it('response_is_the_rfc8693_shape_without_a_data_envelope', () => {
    const ok = {
      access_token: 'a.b.c',
      issued_token_type: contract.ACCESS_TOKEN_TYPE,
      token_type: 'Bearer',
      expires_in: 120,
      scope: 'messages:send:text',
    }
    const parse = (body: unknown) =>
      contract.tokenExchangeResponseSchema.safeParse(body).success
    expect(parse(ok)).toBe(true)
    expect(parse({ data: ok })).toBe(false)
    expect(parse({ ...ok, issued_token_type: 'x' })).toBe(false)
    expect(parse({ ...ok, token_type: 'bearer' })).toBe(false)
  })

  it('error_codes_add_invalid_grant_to_the_token_endpoint_ones', () => {
    expect([...contract.TOKEN_EXCHANGE_ERROR_CODES]).toEqual([
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'invalid_target',
      'invalid_scope',
      'temporarily_unavailable',
    ])
    expect(
      contract.tokenExchangeErrorSchema.safeParse({ error: 'invalid_grant' })
        .success,
    ).toBe(true)
    expect(
      contract.tokenExchangeErrorSchema.safeParse({ error: 'nope' }).success,
    ).toBe(false)
  })

  it('route_is_post_internal_token_exchange', () => {
    expect(contract.INTERNAL_TOKEN_EXCHANGE_ROUTES.exchange).toEqual({
      method: 'post',
      path: '/internal/token-exchange',
    })
  })
})

describe('person token failures and redaction keys', () => {
  it('a_bad_subject_token_is_a_403_with_its_own_code_never_a_401', () => {
    expect(contract.SUBJECT_TOKEN_INVALID_STATUS).toBe(403)
    expect(contract.SUBJECT_TOKEN_INVALID_CODE).toBe('subject_token_invalid')
  })

  it('lists_the_keys_that_carry_tokens_so_the_API_redacts_them', () => {
    expect([...contract.TOKEN_BEARING_KEYS].sort()).toEqual(
      [
        'access_token',
        'subject_token',
        'subjectToken',
        'x-eva-subject-token',
      ].sort(),
    )
    // The header name and the body keys the contract itself defines are in the list.
    expect(contract.TOKEN_BEARING_KEYS).toContain(contract.SUBJECT_TOKEN_HEADER)
    expect(Object.keys(contract.subjectTokenRequestSchema.shape)).toEqual([
      'subjectToken',
    ])
    expect(contract.TOKEN_BEARING_KEYS).toContain('subjectToken')
    expect(Object.keys(contract.tokenExchangeRequestSchema.shape)).toContain(
      'subject_token',
    )
    expect(Object.keys(contract.tokenExchangeResponseSchema.shape)).toContain(
      'access_token',
    )
  })

  it('product_may_ask_for_its_own_contract_but_not_write_any_state', () => {
    expect(contract.isScopeOfAudience('auth-api', 'contrataciones:pedir')).toBe(
      true,
    )
    expect(
      contract.isScopeOfAudience('auth-api', 'contrataciones:escribir'),
    ).toBe(true)
  })
})

describe('company roles and contract states', () => {
  it('roles_are_ordered_from_titular_down', () => {
    expect([...contract.EMPRESA_ROLES]).toEqual([
      'titular',
      'administrador',
      'miembro',
    ])
  })

  it('empresaRoleAtLeast_follows_the_order', () => {
    const at = contract.empresaRoleAtLeast
    expect(at('titular', 'administrador')).toBe(true)
    expect(at('administrador', 'administrador')).toBe(true)
    expect(at('miembro', 'administrador')).toBe(false)
    expect(at('administrador', 'titular')).toBe(false)
    expect(at('miembro', 'miembro')).toBe(true)
  })

  it('only_prueba_and_activo_count_as_contracted', () => {
    const vigentes = contract.CONTRATACION_ESTADOS.filter((estado) =>
      contract.isContratacionVigente(estado),
    )
    expect(vigentes).toEqual(['prueba', 'activo'])
    expect([...contract.CONTRATACION_ESTADOS]).toEqual([
      'prueba',
      'pendiente_pago',
      'activo',
      'suspendido',
      'cancelado',
    ])
  })

  it('billing_cannot_write_pendiente_pago', () => {
    const parse = (estado: string) =>
      contract.setContratacionRequestSchema.safeParse({ estado }).success
    expect(parse('activo')).toBe(true)
    expect(parse('suspendido')).toBe(true)
    expect(parse('cancelado')).toBe(true)
    expect(parse('prueba')).toBe(true)
    expect(parse('pendiente_pago')).toBe(false)
    expect(parse('gratis')).toBe(false)
  })

  it('set_contract_takes_hasta_as_an_iso_date_or_null', () => {
    const parse = (hasta: unknown) =>
      contract.setContratacionRequestSchema.safeParse({
        estado: 'activo',
        hasta,
      }).success
    expect(parse('2026-12-31T00:00:00Z')).toBe(true)
    expect(parse(null)).toBe(true)
    expect(parse('mañana')).toBe(false)
  })
})

describe('internal companies API: one mechanism, service token plus subjectToken', () => {
  const create = {
    ruc: '20123456789',
    razonSocial: 'Gym SAC',
    slug: 'gym-sac',
    subjectToken: TOKEN,
  }

  it('create_takes_the_subject_token_and_no_longer_a_first_member', () => {
    const parse = (body: unknown) =>
      contract.createEmpresaRequestSchema.safeParse(body).success
    expect(parse(create)).toBe(true)
    expect(parse({ ...create, primerMiembroUserId: UUID })).toBe(false)
    const { subjectToken: _t, ...noToken } = create
    expect(parse(noToken)).toBe(false)
  })

  it('every_person_bound_body_requires_the_subject_token', () => {
    const withToken = (
      schema: { safeParse(v: unknown): { success: boolean } },
      body: object,
    ) => [
      schema.safeParse({ ...body, subjectToken: TOKEN }).success,
      schema.safeParse(body).success,
    ]
    expect(
      withToken(contract.addEmpresaMemberRequestSchema, { userId: UUID }),
    ).toEqual([true, false])
    expect(
      withToken(contract.updateEmpresaMemberRequestSchema, { rol: 'miembro' }),
    ).toEqual([true, false])
    expect(withToken(contract.removeEmpresaMemberRequestSchema, {})).toEqual([
      true,
      false,
    ])
    expect(
      withToken(contract.createSucursalRequestSchema, { nombre: 'Centro' }),
    ).toEqual([true, false])
    expect(
      withToken(contract.updateSucursalRequestSchema, { nombre: 'Centro' }),
    ).toEqual([true, false])
    expect(withToken(contract.deactivateSucursalRequestSchema, {})).toEqual([
      true,
      false,
    ])
    expect(
      withToken(contract.updateEmpresaRequestSchema, { razonSocial: 'X' }),
    ).toEqual([true, false])
  })

  it('update_cannot_change_ruc_or_slug', () => {
    const parse = (body: object) =>
      contract.updateEmpresaRequestSchema.safeParse({
        ...body,
        subjectToken: TOKEN,
      }).success
    expect(parse({ razonSocial: 'Nueva SAC' })).toBe(true)
    expect(parse({ ruc: '20999999999' })).toBe(false)
    expect(parse({ slug: 'otro' })).toBe(false)
  })

  it('update_takes_the_profile_and_null_clears_a_value', () => {
    const parsed = contract.updateEmpresaRequestSchema.safeParse({
      subjectToken: TOKEN,
      direccion: null,
      img: null,
      perfil: { visible: true, rubro: 'Gimnasios', ciudad: null },
    })
    expect(parsed.success).toBe(true)
    expect(
      contract.updateEmpresaRequestSchema.safeParse({
        subjectToken: TOKEN,
        perfil: { visible: true, extra: 1 },
      }).success,
    ).toBe(false)
  })

  it('role_change_accepts_only_the_three_roles', () => {
    const parse = (rol: string) =>
      contract.updateEmpresaMemberRequestSchema.safeParse({
        rol,
        subjectToken: TOKEN,
      }).success
    expect(parse('titular')).toBe(true)
    expect(parse('administrador')).toBe(true)
    expect(parse('miembro')).toBe(true)
    expect(parse('dueno')).toBe(false)
  })

  it('list_query_is_q_and_cursor_only', () => {
    expect(
      contract.listEmpresasQuerySchema.safeParse({ q: 'gym', cursor: 'c1' })
        .success,
    ).toBe(true)
    expect(contract.listEmpresasQuerySchema.safeParse({}).success).toBe(true)
    expect(
      contract.listEmpresasQuerySchema.safeParse({ limit: 10 }).success,
    ).toBe(false)
  })

  const empresa = {
    id: UUID,
    ruc: '20123456789',
    razonSocial: 'Gym SAC',
    slug: 'gym-sac',
    direccion: null,
    celular: null,
    email: null,
    img: null,
    estado: 'activa',
    grupoId: null,
    perfil: { visible: false, rubro: null, ciudad: null, descripcion: null },
  }
  const branch = {
    id: UUID,
    empresaId: UUID,
    nombre: 'Centro',
    direccion: null,
    activa: true,
  }

  it('get_answers_the_full_view_or_the_trimmed_one_told_apart_by_vista', () => {
    const full = {
      data: {
        vista: 'completa',
        ...empresa,
        sucursales: [branch],
        miembros: [{ userId: UUID, rol: 'titular' }],
      },
    }
    const trimmed = {
      data: {
        vista: 'recortada',
        id: UUID,
        razonSocial: 'Gym SAC',
        estado: 'activa',
        sucursales: [
          { id: UUID, empresaId: UUID, nombre: 'Centro', activa: true },
        ],
      },
    }
    expect(contract.getEmpresaResponseSchema.safeParse(full).success).toBe(true)
    expect(contract.getEmpresaResponseSchema.safeParse(trimmed).success).toBe(
      true,
    )
    // A trimmed body labelled as full is not accepted: the label decides the shape.
    expect(
      contract.getEmpresaResponseSchema.safeParse({
        data: { ...trimmed.data, vista: 'completa' },
      }).success,
    ).toBe(false)
    expect(
      contract.getEmpresaResponseSchema.safeParse({
        data: { ...trimmed.data, vista: 'otra' },
      }).success,
    ).toBe(false)
  })

  it('the_trimmed_view_has_no_contact_data_nor_members', () => {
    const shape = contract.empresaRecortadaResponseSchema.shape.data.shape
    expect(Object.keys(shape).sort()).toEqual([
      'estado',
      'id',
      'razonSocial',
      'sucursales',
      'vista',
    ])
    expect(Object.keys(contract.sucursalRecortadaSchema.shape).sort()).toEqual([
      'activa',
      'empresaId',
      'id',
      'nombre',
    ])
  })

  it('listing_answers_a_page_with_a_cursor', () => {
    expect(
      contract.listEmpresasResponseSchema.safeParse({
        data: { empresas: [empresa], nextCursor: null },
      }).success,
    ).toBe(true)
    expect(
      contract.listEmpresasResponseSchema.safeParse({
        data: { empresas: [empresa] },
      }).success,
    ).toBe(false)
  })

  it('member_answer_carries_the_role_and_a_branch_has_activa', () => {
    expect(
      contract.empresaMemberResponseSchema.safeParse({
        data: { empresaId: UUID, userId: UUID, rol: 'miembro' },
      }).success,
    ).toBe(true)
    expect(
      contract.empresaMemberResponseSchema.safeParse({
        data: { empresaId: UUID, userId: UUID },
      }).success,
    ).toBe(false)
    const { activa: _a, ...noActiva } = branch
    expect(contract.sucursalSchema.safeParse(noActiva).success).toBe(false)
  })

  it('baja_and_reactivar_answer_the_state', () => {
    expect(
      contract.empresaEstadoResponseSchema.safeParse({
        data: { id: UUID, estado: 'baja' },
      }).success,
    ).toBe(true)
    expect(
      contract.empresaEstadoResponseSchema.safeParse({
        data: { id: UUID, estado: 'eliminada' },
      }).success,
    ).toBe(false)
  })

  it('holder_reassignment_keeps_the_previous_holder_as_member_by_default', () => {
    expect(
      contract.reassignTitularRequestSchema.parse({ userId: UUID }),
    ).toEqual({ userId: UUID, titularAnterior: 'miembro' })
    expect(
      contract.reassignTitularRequestSchema.parse({
        userId: UUID,
        titularAnterior: 'fuera',
      }).titularAnterior,
    ).toBe('fuera')
    expect(
      contract.reassignTitularRequestSchema.safeParse({
        userId: UUID,
        titularAnterior: 'otro',
      }).success,
    ).toBe(false)
  })

  it('routes_cover_the_phase2_surface', () => {
    expect(contract.INTERNAL_EMPRESA_ROUTES).toMatchObject({
      list: { method: 'get', path: '/internal/empresas' },
      update: { method: 'patch', path: '/internal/empresas/{id}' },
      baja: { method: 'post', path: '/internal/empresas/{id}/baja' },
      reactivar: { method: 'post', path: '/internal/empresas/{id}/reactivar' },
      updateMember: {
        method: 'patch',
        path: '/internal/empresas/{id}/miembros/{userId}',
      },
      updateBranch: {
        method: 'patch',
        path: '/internal/empresas/{id}/sucursales/{sucursalId}',
      },
      deactivateBranch: {
        method: 'delete',
        path: '/internal/empresas/{id}/sucursales/{sucursalId}',
      },
      requestContratacion: {
        method: 'post',
        path: '/internal/empresas/{id}/productos',
      },
      cancelContratacion: {
        method: 'delete',
        path: '/internal/empresas/{id}/productos',
      },
      getContratacion: {
        method: 'get',
        path: '/internal/empresas/{id}/productos/{producto}',
      },
      createAutorizacion: {
        method: 'post',
        path: '/internal/empresas/{id}/autorizaciones',
      },
      listAutorizaciones: {
        method: 'get',
        path: '/internal/empresas/{id}/autorizaciones',
      },
      deleteAutorizacion: {
        method: 'delete',
        path: '/internal/empresas/{id}/autorizaciones/{autorizacionId}',
      },
    })
    expect(contract.INTERNAL_AUTORIZACION_ROUTES.verificar).toEqual({
      method: 'get',
      path: '/internal/autorizaciones/verificar',
    })
    expect(contract.DIRECTORIO_ROUTES.search).toEqual({
      method: 'get',
      path: '/directorio',
    })
    for (const route of Object.values({
      ...contract.INTERNAL_EMPRESA_ROUTES,
      ...contract.INTERNAL_GRUPO_ROUTES,
      ...contract.INTERNAL_AUTORIZACION_ROUTES,
      ...contract.DIRECTORIO_ROUTES,
      ...contract.INTERNAL_TOKEN_EXCHANGE_ROUTES,
    })) {
      expect(route.path.startsWith('/')).toBe(true)
      expect(route.path.startsWith(contract.API_PREFIX)).toBe(false)
    }
  })
})

describe('contracts of products (A-004)', () => {
  it('contract_answers_carry_the_state_and_dates', () => {
    const ok = {
      empresaId: UUID,
      producto: 'whatsapp-panel',
      estado: 'prueba',
      desde: '2026-10-31T00:00:00Z',
      hasta: '2026-11-30T00:00:00Z',
      actualizadoEn: '2026-10-31T00:00:00Z',
    }
    expect(
      contract.contratacionResponseSchema.safeParse({ data: ok }).success,
    ).toBe(true)
    expect(
      contract.contratacionResponseSchema.safeParse({
        data: { ...ok, estado: 'gratis' },
      }).success,
    ).toBe(false)
    expect(
      contract.contratacionResponseSchema.safeParse({
        data: { ...ok, hasta: null },
      }).success,
    ).toBe(true)
  })

  it('contracted_answer_is_a_boolean', () => {
    expect(
      contract.contratadoResponseSchema.safeParse({
        data: { contratado: true },
      }).success,
    ).toBe(true)
    expect(
      contract.contratadoResponseSchema.safeParse({
        data: { contratado: 'si' },
      }).success,
    ).toBe(false)
  })
})

describe('groups of companies', () => {
  it('bodies_carry_the_subject_token_and_the_group_answers_its_companies', () => {
    expect(
      contract.createGrupoRequestSchema.safeParse({
        nombre: 'Cadena',
        empresaId: UUID,
        subjectToken: TOKEN,
      }).success,
    ).toBe(true)
    expect(
      contract.createGrupoRequestSchema.safeParse({
        nombre: 'Cadena',
        empresaId: UUID,
      }).success,
    ).toBe(false)
    expect(
      contract.renameGrupoRequestSchema.safeParse({
        nombre: '',
        subjectToken: TOKEN,
      }).success,
    ).toBe(false)
    expect(
      contract.addGrupoEmpresaRequestSchema.safeParse({
        empresaId: UUID,
        subjectToken: TOKEN,
      }).success,
    ).toBe(true)
    expect(
      contract.grupoResponseSchema.safeParse({
        data: { id: UUID, nombre: 'Cadena', empresaIds: [UUID] },
      }).success,
    ).toBe(true)
  })

  it('routes_hang_from_the_group', () => {
    expect(contract.INTERNAL_GRUPO_ROUTES).toEqual({
      create: { method: 'post', path: '/internal/grupos' },
      rename: { method: 'patch', path: '/internal/grupos/{id}' },
      addEmpresa: { method: 'post', path: '/internal/grupos/{id}/empresas' },
      removeEmpresa: {
        method: 'delete',
        path: '/internal/grupos/{id}/empresas/{empresaId}',
      },
    })
  })
})

describe('directory', () => {
  it('query_is_q_rubro_ciudad_and_cursor', () => {
    const parse = (q: unknown) =>
      contract.directorioQuerySchema.safeParse(q).success
    expect(parse({})).toBe(true)
    expect(parse({ q: 'a', rubro: 'b', ciudad: 'c', cursor: 'd' })).toBe(true)
    expect(parse({ limit: 100 })).toBe(false)
  })

  it('an_entry_shows_only_the_public_profile_fields', () => {
    expect(Object.keys(contract.directorioEmpresaSchema.shape).sort()).toEqual([
      'ciudad',
      'descripcion',
      'id',
      'img',
      'razonSocial',
      'rubro',
    ])
    expect(
      contract.directorioResponseSchema.safeParse({
        data: { empresas: [], nextCursor: null },
      }).success,
    ).toBe(true)
  })
})

describe('authorizations between companies', () => {
  const permiso = contract.INTER_EMPRESA_PERMISSION_LIST[0]

  it('grant_takes_a_permission_of_the_inter_company_catalog_only', () => {
    const parse = (p: string) =>
      contract.createAutorizacionRequestSchema.safeParse({
        beneficiariaId: UUID,
        permiso: p,
        subjectToken: TOKEN,
      }).success
    expect(parse(permiso)).toBe(true)
    // A service permission is not an authorization between companies.
    expect(parse('messages:send:text')).toBe(false)
    expect(parse('autorizaciones:escribir')).toBe(false)
    expect(parse('inventado:x:y')).toBe(false)
  })

  it('revoking_needs_the_person_and_listing_needs_a_direction', () => {
    expect(contract.deleteAutorizacionRequestSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      contract.deleteAutorizacionRequestSchema.safeParse({
        subjectToken: TOKEN,
      }).success,
    ).toBe(true)
    const list = (direccion?: string) =>
      contract.listAutorizacionesQuerySchema.safeParse({ direccion }).success
    expect(list('otorgadas')).toBe(true)
    expect(list('recibidas')).toBe(true)
    expect(list('todas')).toBe(false)
    expect(list()).toBe(false)
  })

  it('verify_query_and_answer', () => {
    expect(
      contract.verificarAutorizacionQuerySchema.safeParse({
        otorgante: UUID,
        beneficiaria: UUID,
        permiso,
      }).success,
    ).toBe(true)
    expect(
      contract.verificarAutorizacionQuerySchema.safeParse({
        otorgante: UUID,
        permiso,
      }).success,
    ).toBe(false)
    expect(
      contract.verificarAutorizacionResponseSchema.safeParse({
        data: { autorizado: false },
      }).success,
    ).toBe(true)
  })

  it('authorizable_permissions_of_a_product_are_deduplicated_and_may_be_empty', () => {
    expect(
      contract.setProductoPermisosAutorizablesRequestSchema.parse({
        permisos: [permiso, permiso],
      }).permisos,
    ).toEqual([permiso])
    expect(
      contract.setProductoPermisosAutorizablesRequestSchema.safeParse({
        permisos: [],
      }).success,
    ).toBe(true)
    expect(
      contract.setProductoPermisosAutorizablesRequestSchema.safeParse({
        permisos: ['users:read'],
      }).success,
    ).toBe(false)
  })
})

describe('admin: client identity and delegation edges', () => {
  it('a_client_may_carry_a_product_and_an_audience_and_null_clears_them', () => {
    expect(
      contract.createServiceClientRequestSchema.safeParse({
        slug: 'whatsapp-backend',
        producto: 'whatsapp-panel',
        audiencia: 'whatsapp-api',
      }).success,
    ).toBe(true)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({
        producto: null,
        audiencia: null,
      }).success,
    ).toBe(true)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({
        audiencia: 'otra-api',
      }).success,
    ).toBe(false)
  })

  it('delegation_edge_is_validated_against_the_delegable_catalog', () => {
    const parse = (body: unknown) =>
      contract.setServiceClientDelegationRequestSchema.safeParse(body).success
    expect(
      parse({ audience: 'whatsapp-api', scopes: ['messages:send:text'] }),
    ).toBe(true)
    // admin is never delegable
    expect(parse({ audience: 'whatsapp-api', scopes: ['admin'] })).toBe(false)
    // auth-api is never a destination
    expect(parse({ audience: 'auth-api', scopes: ['users:read'] })).toBe(false)
    expect(parse({ audience: 'whatsapp-api', scopes: [] })).toBe(false)
    expect(parse({ audience: 'whatsapp-api', scopes: ['users:read'] })).toBe(
      false,
    )
  })

  it('requiere_scope_origen_is_optional_deduplicated_and_delegable_only', () => {
    const base = { audience: 'whatsapp-api', scopes: ['messages:send:text'] }
    expect(
      contract.setServiceClientDelegationRequestSchema.parse({
        ...base,
        requiere_scope_origen: ['messages:send:media', 'messages:send:media'],
      }),
    ).toMatchObject({ requiere_scope_origen: ['messages:send:media'] })
    expect(
      contract.setServiceClientDelegationRequestSchema.safeParse({
        ...base,
        requiere_scope_origen: ['admin'],
      }).success,
    ).toBe(false)
    expect(
      contract.setServiceClientDelegationRequestSchema.safeParse(base).success,
    ).toBe(true)
  })

  it('every_delegable_audience_has_an_edge_body_variant', () => {
    for (const audience of contract.DELEGABLE_AUDIENCES) {
      const [scope] = contract.DELEGABLE_AUDIENCE_SCOPES[audience]
      expect(
        contract.setServiceClientDelegationRequestSchema.safeParse({
          audience,
          scopes: [scope],
        }).success,
      ).toBe(true)
    }
  })

  it('delegation_answers_and_routes', () => {
    expect(
      contract.listServiceClientDelegationsResponseSchema.safeParse({
        data: {
          delegations: [
            {
              audience: 'whatsapp-api',
              scopes: ['messages:send:text'],
              requiere_scope_origen: [],
            },
          ],
        },
      }).success,
    ).toBe(true)
    expect(contract.ADMIN_ROUTES.setServiceClientDelegation).toEqual({
      method: 'put',
      path: '/admin/service-clients/{slug}/delegations',
    })
  })
})

describe('user companies with role, group and contract', () => {
  const base = {
    id: UUID,
    ruc: '20123456789',
    razonSocial: 'Gym SAC',
    slug: 'gym-sac',
    rol: 'titular',
    grupo: { id: UUID, nombre: 'Cadena' },
  }
  const contracted = {
    ...base,
    contratado: true,
    direccion: null,
    celular: null,
    email: null,
    img: null,
    sucursales: [],
  }

  it('a_contracted_company_carries_the_full_data_and_the_role', () => {
    expect(
      contract.companyListResponseSchema.safeParse({ data: [contracted] })
        .success,
    ).toBe(true)
    const { rol: _r, ...noRole } = contracted
    expect(
      contract.companyListResponseSchema.safeParse({ data: [noRole] }).success,
    ).toBe(false)
  })

  it('an_uncontracted_company_has_no_contact_data_or_branches', () => {
    const trimmed = { ...base, contratado: false }
    expect(
      contract.companyListResponseSchema.safeParse({ data: [trimmed] }).success,
    ).toBe(true)
    expect(
      Object.keys(contract.uncontractedCompanySchema.shape).sort(),
    ).toEqual([
      'contratado',
      'grupo',
      'id',
      'razonSocial',
      'rol',
      'ruc',
      'slug',
    ])
    // The contact fields of a contracted company are required: the flag decides the shape.
    expect(
      contract.companyListResponseSchema.safeParse({
        data: [{ ...trimmed, contratado: true }],
      }).success,
    ).toBe(false)
  })
})

describe('phase 2 webhook events carry ids only', () => {
  const NEW_EVENTS = [
    'empresa.updated',
    'empresa.deactivated',
    'empresa.reactivated',
    'empresa.member_role_changed',
    'empresa.branch_updated',
    'empresa.branch_deactivated',
    'empresa.product_changed',
    'grupo.updated',
    'grupo.member_added',
    'grupo.member_removed',
    'autorizacion.granted',
    'autorizacion.revoked',
  ]

  const PHASE1_EVENTS = [
    'empresa.created',
    'empresa.member_added',
    'empresa.member_removed',
    'empresa.branch_created',
  ]

  it('declares_the_new_events_in_the_catalog', () => {
    const codes = Object.values(contract.EVENT_CODES) as string[]
    for (const event of NEW_EVENTS) expect(codes).toContain(event)
  })

  it('has_a_payload_schema_for_each_new_event_and_the_phase1_empresa_ones', () => {
    expect(Object.keys(contract.IDENTITY_EVENT_PAYLOAD_SCHEMAS).sort()).toEqual(
      [...NEW_EVENTS, ...PHASE1_EVENTS].sort(),
    )
  })

  it('phase1_payloads_hold_ids_only_no_slug_no_first_member', () => {
    const schemas = contract.IDENTITY_EVENT_PAYLOAD_SCHEMAS
    expect(Object.keys(schemas['empresa.created'].shape)).toEqual(['empresaId'])
    expect(Object.keys(schemas['empresa.member_added'].shape).sort()).toEqual([
      'empresaId',
      'userId',
    ])
    expect(Object.keys(schemas['empresa.member_removed'].shape).sort()).toEqual(
      ['empresaId', 'userId'],
    )
    expect(Object.keys(schemas['empresa.branch_created'].shape).sort()).toEqual(
      ['empresaId', 'sucursalId'],
    )
  })

  it('payloads_hold_ids_and_state_but_no_contact_data', () => {
    const allowed = new Set([
      'empresaId',
      'userId',
      'sucursalId',
      'grupoId',
      'autorizacionId',
      'otorganteId',
      'beneficiariaId',
      'permiso',
      'producto',
      'estado',
      'rol',
    ])
    for (const schema of Object.values(
      contract.IDENTITY_EVENT_PAYLOAD_SCHEMAS,
    )) {
      for (const key of Object.keys(schema.shape)) {
        expect(allowed.has(key)).toBe(true)
      }
    }
  })

  it('product_changed_carries_company_product_and_state', () => {
    expect(
      contract.IDENTITY_EVENT_PAYLOAD_SCHEMAS[
        contract.EVENT_CODES.EMPRESA_PRODUCT_CHANGED
      ].safeParse({
        empresaId: UUID,
        producto: 'whatsapp-panel',
        estado: 'activo',
      }).success,
    ).toBe(true)
    expect(
      contract.IDENTITY_EVENT_PAYLOAD_SCHEMAS[
        contract.EVENT_CODES.EMPRESA_PRODUCT_CHANGED
      ].safeParse({ empresaId: UUID, producto: 'x', estado: 'gratis' }).success,
    ).toBe(false)
  })

  it('subscriptions_accept_the_new_events', () => {
    expect(
      contract.createSubscriptionRequestSchema.safeParse({
        url: 'https://example.test/hook',
        eventCodes: NEW_EVENTS,
      }).success,
    ).toBe(true)
  })
})

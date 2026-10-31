import { describe, expect, it } from 'vitest'
import * as contract from '../src/index'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('service audience catalog', () => {
  it('lists_the_closed_set_of_audiences_with_their_scopes', () => {
    expect({ ...contract.SERVICE_AUDIENCE_SCOPES }).toEqual({
      'auth-api': [
        'users:read',
        'webhooks:read',
        'webhooks:write',
        'empresas:leer',
        'empresas:escribir',
      ],
      'whatsapp-api': ['messages:send:text', 'messages:send:media', 'admin'],
    })
    expect([...contract.SERVICE_AUDIENCES]).toEqual([
      'auth-api',
      'whatsapp-api',
    ])
  })

  it('admin_is_not_grantable_for_auth_api_but_is_for_whatsapp_api', () => {
    expect(contract.isScopeOfAudience('auth-api', 'admin')).toBe(false)
    expect(contract.isScopeOfAudience('whatsapp-api', 'admin')).toBe(true)
  })

  it('rejects_a_scope_typo_and_an_unknown_audience', () => {
    expect(contract.isScopeOfAudience('auth-api', 'users:reed')).toBe(false)
    expect(contract.isScopeOfAudience('whatsapp-api', 'users:read')).toBe(false)
    expect(contract.isScopeOfAudience('otra-api', 'users:read')).toBe(false)
  })

  it('recognizes_service_audiences_so_a_product_slug_cannot_reuse_one', () => {
    expect(contract.isServiceAudience('whatsapp-api')).toBe(true)
    expect(contract.isServiceAudience('auth-api')).toBe(true)
    expect(contract.isServiceAudience('whatsapp-panel')).toBe(false)
  })

  it('reserves_the_issuer_slug_for_service_clients', () => {
    expect(contract.isReservedServiceClientSlug('auth-service')).toBe(true)
    expect(contract.isReservedServiceClientSlug('whatsapp-api')).toBe(false)
    expect(contract.TOKEN_ISSUER).toBe('auth-service')
  })

  it('fixes_the_token_types_and_kid_prefixes_apart', () => {
    expect(contract.USER_TOKEN_TYP).toBe('at+jwt')
    expect(contract.SERVICE_TOKEN_TYP).toBe('svc-at+jwt')
    expect(contract.USER_KID_PREFIX).toBe('usr-')
    expect(contract.SERVICE_KID_PREFIX).toBe('svc-')
    expect(contract.SERVICE_TOKEN_LIFETIME_SECONDS).toBe(300)
    expect(contract.INTERNAL_SERVICE_TOKEN_LIFETIME_SECONDS).toBe(60)
  })
})

describe('POST /internal/token schemas', () => {
  it('accepts_a_request_with_and_without_scope_and_rejects_extras', () => {
    expect(
      contract.serviceTokenRequestSchema.parse({ audience: 'whatsapp-api' }),
    ).toEqual({ audience: 'whatsapp-api' })
    expect(
      contract.serviceTokenRequestSchema.parse({
        audience: 'whatsapp-api',
        scope: 'messages:send:text',
      }),
    ).toEqual({ audience: 'whatsapp-api', scope: 'messages:send:text' })
    expect(
      contract.serviceTokenRequestSchema.safeParse({ scope: 'x' }).success,
    ).toBe(false)
    expect(
      contract.serviceTokenRequestSchema.safeParse({ audience: 'a', extra: 1 })
        .success,
    ).toBe(false)
  })

  it('response_is_the_rfc6749_shape_without_a_data_envelope', () => {
    const ok = {
      access_token: 'a.b.c',
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'messages:send:text',
    }
    expect(contract.serviceTokenResponseSchema.safeParse(ok).success).toBe(true)
    expect(
      contract.serviceTokenResponseSchema.safeParse({ data: ok }).success,
    ).toBe(false)
    expect(
      contract.serviceTokenResponseSchema.safeParse({
        ...ok,
        token_type: 'bearer',
      }).success,
    ).toBe(false)
  })

  it('error_body_uses_the_closed_rfc_codes', () => {
    expect([...contract.SERVICE_TOKEN_ERROR_CODES]).toEqual([
      'invalid_request',
      'invalid_client',
      'invalid_target',
      'invalid_scope',
      'temporarily_unavailable',
    ])
    expect(
      contract.serviceTokenErrorSchema.safeParse({
        error: 'invalid_target',
        error_description: 'unknown audience',
      }).success,
    ).toBe(true)
    expect(
      contract.serviceTokenErrorSchema.safeParse({ error: 'nope' }).success,
    ).toBe(false)
  })

  it('route_is_post_internal_token', () => {
    expect({ ...contract.INTERNAL_TOKEN_ROUTES }).toEqual({
      issue: { method: 'post', path: '/internal/token' },
    })
  })
})

describe('service client grants and es_admin', () => {
  it('grant_body_is_validated_per_audience', () => {
    const parse = (body: unknown) =>
      contract.setServiceClientGrantRequestSchema.safeParse(body).success
    expect(parse({ audience: 'whatsapp-api', scopes: ['admin'] })).toBe(true)
    expect(parse({ audience: 'auth-api', scopes: ['empresas:escribir'] })).toBe(
      true,
    )
    expect(parse({ audience: 'auth-api', scopes: ['admin'] })).toBe(false)
    expect(parse({ audience: 'whatsapp-api', scopes: ['users:read'] })).toBe(
      false,
    )
    expect(parse({ audience: 'whatsapp-api', scopes: [] })).toBe(false)
    expect(parse({ audience: 'otra-api', scopes: ['x'] })).toBe(false)
  })

  it('grant_scopes_are_deduplicated_keeping_order', () => {
    expect(
      contract.setServiceClientGrantRequestSchema.parse({
        audience: 'auth-api',
        scopes: ['webhooks:read', 'users:read', 'webhooks:read'],
      }).scopes,
    ).toEqual(['webhooks:read', 'users:read'])
  })

  it('every_catalog_audience_has_a_grant_body_variant', () => {
    for (const audience of contract.SERVICE_AUDIENCES) {
      const [scope] = contract.SERVICE_AUDIENCE_SCOPES[audience]
      expect(
        contract.setServiceClientGrantRequestSchema.safeParse({
          audience,
          scopes: [scope],
        }).success,
      ).toBe(true)
    }
  })

  it('create_body_takes_esAdmin_and_no_longer_takes_scopes', () => {
    expect(
      contract.createServiceClientRequestSchema.parse({ slug: 'mi-servicio' }),
    ).toEqual({ slug: 'mi-servicio', esAdmin: false })
    expect(
      contract.createServiceClientRequestSchema.parse({
        slug: 'mi-servicio',
        esAdmin: true,
      }).esAdmin,
    ).toBe(true)
    expect(
      contract.createServiceClientRequestSchema.safeParse({
        slug: 'mi-servicio',
        scopes: ['users:read'],
      }).success,
    ).toBe(false)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({ esAdmin: true })
        .success,
    ).toBe(true)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({
        scopes: ['users:read'],
      }).success,
    ).toBe(false)
  })

  it('public_service_client_carries_esAdmin_and_grants', () => {
    const base = {
      id: UUID,
      slug: 'whatsapp-api',
      name: 'n',
      enabled: true,
      esAdmin: false,
      grants: [{ audience: 'whatsapp-api', scopes: ['messages:send:text'] }],
      lastUsedAt: null,
      createdAt: 'x',
      updatedAt: 'x',
    }
    expect(contract.serviceClientPublicSchema.safeParse(base).success).toBe(
      true,
    )
    const { grants: _g, ...noGrants } = base
    expect(contract.serviceClientPublicSchema.safeParse(noGrants).success).toBe(
      false,
    )
  })

  it('grant_routes_hang_from_the_service_client', () => {
    expect(contract.ADMIN_ROUTES.listServiceClientGrants).toEqual({
      method: 'get',
      path: '/admin/service-clients/{slug}/grants',
    })
    expect(contract.ADMIN_ROUTES.setServiceClientGrant).toEqual({
      method: 'put',
      path: '/admin/service-clients/{slug}/grants',
    })
    expect(contract.ADMIN_ROUTES.deleteServiceClientGrant).toEqual({
      method: 'delete',
      path: '/admin/service-clients/{slug}/grants/{audience}',
    })
  })
})

describe('internal companies API', () => {
  const create = {
    ruc: '20123456789',
    razonSocial: 'Gym SAC',
    slug: 'gym-sac',
    primerMiembroUserId: UUID,
  }

  it('create_body_requires_ruc_razonSocial_slug_and_first_member', () => {
    expect(contract.createEmpresaRequestSchema.safeParse(create).success).toBe(
      true,
    )
    expect(
      contract.createEmpresaRequestSchema.safeParse({
        ...create,
        direccion: 'Av 1',
        celular: '999',
        email: 'a@b.pe',
      }).success,
    ).toBe(true)
    for (const key of Object.keys(create)) {
      const { [key]: _omitted, ...rest } = create as Record<string, string>
      expect(contract.createEmpresaRequestSchema.safeParse(rest).success).toBe(
        false,
      )
    }
    expect(
      contract.createEmpresaRequestSchema.safeParse({ ...create, extra: 1 })
        .success,
    ).toBe(false)
  })

  it('detail_response_carries_branches_and_members', () => {
    const empresa = {
      id: UUID,
      ruc: '20123456789',
      razonSocial: 'Gym SAC',
      slug: 'gym-sac',
      direccion: null,
      celular: null,
      email: null,
      img: null,
      sucursales: [
        { id: UUID, empresaId: UUID, nombre: 'Centro', direccion: null },
      ],
      miembros: [{ userId: UUID }],
    }
    expect(
      contract.empresaDetailResponseSchema.safeParse({ data: empresa }).success,
    ).toBe(true)
    const { miembros: _m, ...noMembers } = empresa
    expect(
      contract.empresaDetailResponseSchema.safeParse({ data: noMembers })
        .success,
    ).toBe(false)
  })

  it('member_and_branch_bodies', () => {
    expect(
      contract.addEmpresaMemberRequestSchema.safeParse({ userId: UUID })
        .success,
    ).toBe(true)
    expect(contract.addEmpresaMemberRequestSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      contract.createSucursalRequestSchema.safeParse({ nombre: 'Centro' })
        .success,
    ).toBe(true)
    expect(
      contract.createSucursalRequestSchema.safeParse({ nombre: '' }).success,
    ).toBe(false)
  })

  it('route_descriptors_match_the_design', () => {
    expect({ ...contract.INTERNAL_EMPRESA_ROUTES }).toEqual({
      create: { method: 'post', path: '/internal/empresas' },
      get: { method: 'get', path: '/internal/empresas/{id}' },
      addMember: { method: 'post', path: '/internal/empresas/{id}/miembros' },
      removeMember: {
        method: 'delete',
        path: '/internal/empresas/{id}/miembros/{userId}',
      },
      createBranch: {
        method: 'post',
        path: '/internal/empresas/{id}/sucursales',
      },
    })
  })

  it('user_companies_list_includes_branches', () => {
    const item = {
      id: UUID,
      ruc: '1',
      razonSocial: 'r',
      slug: 'sss',
      direccion: null,
      celular: null,
      email: null,
      img: null,
    }
    expect(
      contract.companyListResponseSchema.safeParse({
        data: [{ ...item, sucursales: [] }],
      }).success,
    ).toBe(true)
    expect(
      contract.companyListResponseSchema.safeParse({ data: [item] }).success,
    ).toBe(false)
  })
})

describe('login by product and active company', () => {
  const login = {
    phone: '51999000901',
    code: 'A1B2C3',
    challengeId: '9f86d081884c7d659a2feaa0c55ad015',
    deviceType: 'mobile',
    os: 'Android 14',
    browser: 'Chrome 120',
    userAgent: 'Mozilla/5.0 ...',
  }

  it('login_requires_producto_and_takes_an_optional_empresaId', () => {
    expect(contract.loginRequestSchema.safeParse(login).success).toBe(false)
    expect(
      contract.loginRequestSchema.safeParse({
        ...login,
        producto: 'whatsapp-panel',
      }).success,
    ).toBe(true)
    expect(
      contract.loginRequestSchema.parse({
        ...login,
        producto: 'whatsapp-panel',
        empresaId: UUID,
      }).empresaId,
    ).toBe(UUID)
    expect(
      contract.loginRequestSchema.safeParse({ ...login, producto: 'Bad Slug' })
        .success,
    ).toBe(false)
  })

  it('get_code_does_not_take_producto_or_empresaId', () => {
    expect(
      contract.getCodeRequestSchema.safeParse({
        phone: '51999000901',
        producto: 'whatsapp-panel',
      }).success,
    ).toBe(false)
    expect(
      contract.getCodeRequestSchema.safeParse({
        phone: '51999000901',
        empresaId: UUID,
      }).success,
    ).toBe(false)
  })

  it('active_company_accepts_an_id_or_null_but_not_a_missing_field', () => {
    const parse = (body: unknown) =>
      contract.setActiveEmpresaRequestSchema.safeParse(body).success
    expect(parse({ empresaId: UUID })).toBe(true)
    expect(parse({ empresaId: null })).toBe(true)
    expect(parse({})).toBe(false)
    expect(contract.AUTH_ROUTES.setActiveEmpresa).toEqual({
      method: 'post',
      path: '/auth/empresa-activa',
    })
  })
})

describe('empresa webhook events', () => {
  it('declares_the_four_empresa_events', () => {
    expect(contract.EVENT_CODES.EMPRESA_CREATED).toBe('empresa.created')
    expect(contract.EVENT_CODES.EMPRESA_MEMBER_ADDED).toBe(
      'empresa.member_added',
    )
    expect(contract.EVENT_CODES.EMPRESA_MEMBER_REMOVED).toBe(
      'empresa.member_removed',
    )
    expect(contract.EVENT_CODES.EMPRESA_BRANCH_CREATED).toBe(
      'empresa.branch_created',
    )
    expect(
      contract.createSubscriptionRequestSchema.safeParse({
        url: 'https://example.test/hook',
        eventCodes: ['empresa.member_removed'],
      }).success,
    ).toBe(true)
  })
})

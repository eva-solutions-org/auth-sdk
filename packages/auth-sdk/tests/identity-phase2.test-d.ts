/**
 * Type-level guarantees of identity phase 2: what the compiler refuses is part of the contract
 * (`auth-api` is never a delegation destination, `admin` is never delegable, a person-bound call
 * cannot omit the person, the two company views are told apart by `vista`).
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import type {
  EmpresaDetailResponse,
  EmpresaRecortadaResponse,
  InterEmpresaPermission,
  ServiceScope,
} from '@eva_solutions/auth-contracts'
import type { Result } from '../src/types'
import type {
  CreateAutorizacionInput,
  DelegatedTokenGrant,
  DelegatedTokenVerifyOptions,
  ExchangeTokenInput,
  GetEmpresaResult,
  ListAutorizacionesInput,
  S2SClient,
  ServiceTokenProvider,
  ServiceTokenSource,
} from '../src/s2s'
import type { SetServiceClientDelegationInput } from '../src/admin'

describe('delegated token verification options', () => {
  it('audience_excludes_auth_api', () => {
    expectTypeOf<
      DelegatedTokenVerifyOptions['audience']
    >().toEqualTypeOf<'whatsapp-api'>()
    expectTypeOf<'auth-api'>().not.toExtend<
      DelegatedTokenVerifyOptions['audience']
    >()
  })

  it('requires_exactly_one_scope_rule', () => {
    expectTypeOf<{
      audience: 'whatsapp-api'
      requiredScope: string
      anyScope: string[]
    }>().not.toExtend<DelegatedTokenVerifyOptions>()
    expectTypeOf<{
      audience: 'whatsapp-api'
      scopeCheck: 'deferred'
    }>().toExtend<DelegatedTokenVerifyOptions>()
  })
})

describe('delegation edges (admin)', () => {
  it('accepts_a_delegable_audience_and_scope', () => {
    expectTypeOf<{
      audience: 'whatsapp-api'
      scopes: ['messages:send:text']
    }>().toExtend<SetServiceClientDelegationInput>()
  })

  it('rejects_auth_api_and_admin', () => {
    expectTypeOf<{
      audience: 'auth-api'
      scopes: ['users:read']
    }>().not.toExtend<SetServiceClientDelegationInput>()
    expectTypeOf<{
      audience: 'whatsapp-api'
      scopes: ['admin']
    }>().not.toExtend<SetServiceClientDelegationInput>()
  })
})

describe('the person-bound calls cannot omit the person', () => {
  it('listAutorizaciones_input_requires_the_subject_token', () => {
    expectTypeOf<ListAutorizacionesInput>().toHaveProperty('subjectToken')
    expectTypeOf<{
      direccion: 'otorgadas'
    }>().not.toExtend<ListAutorizacionesInput>()
  })

  it('createAutorizacion_takes_only_inter_company_permissions', () => {
    expectTypeOf<
      CreateAutorizacionInput['permiso']
    >().toEqualTypeOf<InterEmpresaPermission>()
    // A service permission is not an authorization between companies.
    expectTypeOf<ServiceScope<'whatsapp-api'>>().not.toExtend<
      CreateAutorizacionInput['permiso']
    >()
  })

  it('member_and_branch_mutations_take_the_person_as_input', () => {
    type Params<K extends keyof S2SClient> = Parameters<S2SClient[K]>
    expectTypeOf<Params<'removeEmpresaMember'>[2]>().toHaveProperty(
      'subjectToken',
    )
    expectTypeOf<Params<'deactivateSucursal'>[2]>().toHaveProperty(
      'subjectToken',
    )
    expectTypeOf<Params<'cancelContratacion'>[1]>().toHaveProperty(
      'subjectToken',
    )
  })

  it('billing_writes_do_not_take_a_person', () => {
    type Params<K extends keyof S2SClient> = Parameters<S2SClient[K]>
    expectTypeOf<Params<'setContratacion'>[2]>().not.toHaveProperty(
      'subjectToken',
    )
    expectTypeOf<Params<'bajaEmpresa'>>().toEqualTypeOf<[empresaId: string]>()
  })
})

describe('getEmpresa views', () => {
  it('narrows_by_vista', () => {
    expectTypeOf<GetEmpresaResult>().toEqualTypeOf<
      EmpresaDetailResponse['data'] | EmpresaRecortadaResponse['data']
    >()
    const read = (view: GetEmpresaResult) => {
      if (view.vista === 'recortada') {
        expectTypeOf(view).toEqualTypeOf<EmpresaRecortadaResponse['data']>()
        expectTypeOf(view).not.toHaveProperty('email')
      } else {
        expectTypeOf(view).toHaveProperty('miembros')
      }
    }
    expectTypeOf(read).toBeFunction()
  })
})

describe('token provider', () => {
  it('exchangeToken_returns_a_Result_of_the_delegated_grant', () => {
    expectTypeOf<ServiceTokenProvider['exchangeToken']>().toEqualTypeOf<
      (input: ExchangeTokenInput) => Promise<Result<DelegatedTokenGrant>>
    >()
  })

  it('a_hand_made_source_needs_only_getToken_and_invalidate', () => {
    expectTypeOf<{
      getToken(): Promise<string>
      invalidate(): void
    }>().toExtend<ServiceTokenSource>()
    expectTypeOf<ServiceTokenSource>().not.toHaveProperty('exchangeToken')
    expectTypeOf<ServiceTokenProvider>().toExtend<ServiceTokenSource>()
  })
})

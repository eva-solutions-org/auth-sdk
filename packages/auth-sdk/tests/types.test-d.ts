/**
 * Type tests para EvaTokenPayload<TExtra> y funciones genéricas del SDK.
 * Ejecutados con: pnpm test:types (vitest typecheck)
 *
 * Nota: @ts-expect-error se usa como sentinel para validar que el typecheck
 * efectivamente falla cuando debe (el test falla si la línea NO genera error).
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import { z } from 'zod'
import type { EvaTokenPayload } from '../src/types'
import type { EvaHttpClient } from '../src/http-client'
import { evaAuth, getEvaPayload } from '../src/hono'
import { verifyAccessToken } from '../src/jwt'
import { verifyRequest } from '../src/generic/verify'

// ───── REQ-TE-002: Sin generic ≡ legacy shape ─────

describe('EvaTokenPayload sin generic', () => {
  it('es { id, sessionId, clientId, empresaId? }', () => {
    expectTypeOf<EvaTokenPayload>().toEqualTypeOf<{
      id: string
      sessionId: string
      clientId: string
      empresaId?: string
    }>()
  })
})

// ───── REQ-TE-003: Con generic aplica intersección ─────

describe('EvaTokenPayload con generic', () => {
  it('EvaTokenPayload<{ phone: string }> es { id, sessionId, phone }', () => {
    expectTypeOf<EvaTokenPayload<{ phone: string }>>().branded.toEqualTypeOf<{
      id: string
      sessionId: string
      clientId: string
      empresaId?: string
      phone: string
    }>()
  })

  it('EvaTokenPayload<{ role: "admin" | "user" }> preserva literales', () => {
    expectTypeOf<
      EvaTokenPayload<{ role: 'admin' | 'user' }>
    >().branded.toEqualTypeOf<{
      id: string
      sessionId: string
      clientId: string
      empresaId?: string
      role: 'admin' | 'user'
    }>()
  })
})

// ───── REQ-TE-010: verifyAccessToken infiere TExtra desde schema ─────

describe('verifyAccessToken return type', () => {
  it('sin schema: retorna Result<EvaTokenPayload<{}>>', () => {
    type R = Awaited<ReturnType<typeof verifyAccessToken<{}>>>
    // ok=true → data es EvaTokenPayload<{}>
    type DataOk = Extract<R, { ok: true }>['data']
    expectTypeOf<DataOk>().toEqualTypeOf<EvaTokenPayload<{}>>()
  })
})

// ───── REQ-TE-013: evaAuth devuelve MiddlewareHandler con Variables tipado ─────

describe('evaAuth con schema', () => {
  it('evaAuth({ extraClaimsSchema: z.object({phone}) }) devuelve middleware con Variables tipado', () => {
    const schema = z.object({ phone: z.string() })
    const _auth = evaAuth({ extraClaimsSchema: schema })
    // El tipo de retorno es MiddlewareHandler<{ Variables: EvaAuthVariables<{ phone: string }> }>
    // Verificamos que el tipo asignable existe — si no compila, el test falla
    type _AuthType = typeof _auth
    // Solo comprobamos que es una función (middleware handler)
    expectTypeOf<_AuthType>().toBeFunction()
  })
})

// ───── REQ-TE-015: getEvaPayload con Context tipado ─────

describe('getEvaPayload', () => {
  it('con Context<Variables<{ phone }>> retorna EvaTokenPayload<{ phone: string }>', () => {
    type Result = ReturnType<typeof getEvaPayload<{ phone: string }>>
    expectTypeOf<Result>().toEqualTypeOf<EvaTokenPayload<{ phone: string }>>()
  })
})

// ───── REQ-TE-014: verifyRequest preserva TExtra ─────

describe('verifyRequest return type', () => {
  it('sin generic: payload es EvaTokenPayload<{}>', () => {
    type R = Awaited<ReturnType<typeof verifyRequest<{}>>>
    type DataOk = Extract<R, { ok: true }>['data']
    expectTypeOf<DataOk['payload']>().toEqualTypeOf<EvaTokenPayload<{}>>()
  })
})

// ───── REQ-TE-004: TExtra restringido a Record<string, unknown> ─────

describe('TExtra constraint', () => {
  it('EvaTokenPayload acepta Record<string, unknown> como genérico', () => {
    // string keys → ok
    type _OK = EvaTokenPayload<{ x: string; y: number }>
    expectTypeOf<_OK>().toHaveProperty('x')
    expectTypeOf<_OK>().toHaveProperty('y')
  })
})

// ───── T-007: EvaError discriminated union — foundation types (REQ-ERR-03..REQ-ERR-05, REQ-RESULT-01..REQ-RESULT-03) ─────

import type { EvaError, EvaApiError, EvaSdkError, Result } from '../src/types'
import type {
  CoreErrorCode,
  ErrorCode,
  SdkErrorReason,
} from '../src/error-codes'
import type { ConfigureEvaAuthOptions } from '../src/config'
import { getMessage } from '../src/get-message'

describe('EvaApiError type (REQ-ERR-03)', () => {
  it('tiene kind, code, message, status', () => {
    expectTypeOf<EvaApiError>().toHaveProperty('kind')
    expectTypeOf<EvaApiError>().toHaveProperty('code')
    expectTypeOf<EvaApiError>().toHaveProperty('message')
    expectTypeOf<EvaApiError>().toHaveProperty('status')
  })

  it('kind es literal "api"', () => {
    expectTypeOf<EvaApiError['kind']>().toEqualTypeOf<'api'>()
  })

  it('code es string (abierto)', () => {
    expectTypeOf<EvaApiError['code']>().toEqualTypeOf<string>()
  })
})

describe('EvaSdkError type (REQ-ERR-04)', () => {
  it('tiene kind, reason, message, status', () => {
    expectTypeOf<EvaSdkError>().toHaveProperty('kind')
    expectTypeOf<EvaSdkError>().toHaveProperty('reason')
    expectTypeOf<EvaSdkError>().toHaveProperty('message')
    expectTypeOf<EvaSdkError>().toHaveProperty('status')
  })

  it('kind es literal "sdk"', () => {
    expectTypeOf<EvaSdkError['kind']>().toEqualTypeOf<'sdk'>()
  })

  it('reason es SdkErrorReason', () => {
    expectTypeOf<EvaSdkError['reason']>().toEqualTypeOf<SdkErrorReason>()
  })
})

describe('EvaError discriminated union (REQ-ERR-05)', () => {
  it('es EvaApiError | EvaSdkError', () => {
    expectTypeOf<EvaError>().toEqualTypeOf<EvaApiError | EvaSdkError>()
  })

  it('narrowing por kind — rama api tiene code', () => {
    const err = undefined as unknown as EvaError
    if (err.kind === 'api') {
      // En la rama 'api', code está disponible
      expectTypeOf(err).toHaveProperty('code')
    }
  })

  it('narrowing por kind — rama sdk tiene reason', () => {
    const err = undefined as unknown as EvaError
    if (err.kind === 'sdk') {
      // En la rama 'sdk', reason está disponible
      expectTypeOf(err).toHaveProperty('reason')
    }
  })
})

describe('Result<T> nuevo shape (REQ-RESULT-01, REQ-RESULT-02, REQ-RESULT-03)', () => {
  it('branch ok:false tiene error:EvaError (no string)', () => {
    type R = Result<string>
    type ErrBranch = Extract<R, { ok: false }>
    expectTypeOf<ErrBranch['error']>().toEqualTypeOf<EvaError>()
  })

  it('branch ok:false NO tiene status top-level (D-10 LOCKED)', () => {
    type R = Result<string>
    type ErrBranch = Extract<R, { ok: false }>
    // status NO debe existir en el branch directamente
    // @ts-expect-error — status no existe en el branch ok:false
    type _NoStatus = ErrBranch['status']
  })

  it('branch ok:true tiene data:T', () => {
    type R = Result<number>
    type OkBranch = Extract<R, { ok: true }>
    expectTypeOf<OkBranch['data']>().toEqualTypeOf<number>()
  })
})

describe('CoreErrorCode y ErrorCode (D-08 LOCKED)', () => {
  it('CoreErrorCode incluye unauthorized', () => {
    expectTypeOf<'unauthorized'>().toMatchTypeOf<CoreErrorCode>()
  })

  it('ErrorCode acepta CoreErrorCode', () => {
    expectTypeOf<CoreErrorCode>().toMatchTypeOf<ErrorCode>()
  })

  it('ErrorCode acepta strings arbitrarios (catálogo abierto)', () => {
    expectTypeOf<'service_client_already_exists'>().toMatchTypeOf<ErrorCode>()
  })
})

describe('SdkErrorReason (REQ-ERR-07)', () => {
  it('es unión de 6 literales', () => {
    expectTypeOf<SdkErrorReason>().toEqualTypeOf<
      | 'auth_required'
      | 'token_invalid'
      | 'refresh_no_tokens'
      | 'verify_failed'
      | 'network'
      | 'malformed'
    >()
  })
})

describe('getMessage helper', () => {
  it('acepta EvaError y retorna string', () => {
    expectTypeOf(getMessage).parameter(0).toEqualTypeOf<EvaError>()
    expectTypeOf(getMessage).returns.toEqualTypeOf<string>()
  })
})

describe('ConfigureEvaAuthOptions.errorWire (REQ-DOC-05)', () => {
  it('acepta "api" | "string" | undefined', () => {
    type EW = ConfigureEvaAuthOptions['errorWire']
    expectTypeOf<EW>().toEqualTypeOf<'api' | 'string' | undefined>()
  })
})

// ───── T-040: Webhooks / Admin / S2S types (REQ-WH-08, REQ-ADMIN-06, REQ-S2S-06) ─────

import type { WebhookPayload, EventCode } from '../src/webhooks/types'
import { EVENT_CODES } from '../src/webhooks/constants'
import type {
  ServiceClientPublic,
  CreateServiceClientResult,
} from '../src/admin/types'
import type { S2SClientConfig } from '../src/s2s/types'
import type { AdminErrorCode } from '../src/admin/error-codes'
import type { S2SErrorCode } from '../src/s2s/error-codes'
import { assertType } from 'vitest'

// REQ-WH-08 — WebhookPayload importable + EventCode assignable
describe('WebhookPayload y EventCode (REQ-WH-08)', () => {
  it('WebhookPayload importa sin error y tiene el shape esperado', () => {
    expectTypeOf<WebhookPayload>().toHaveProperty('id')
    expectTypeOf<WebhookPayload>().toHaveProperty('eventCode')
    expectTypeOf<WebhookPayload>().toHaveProperty('timestamp')
    expectTypeOf<WebhookPayload>().toHaveProperty('data')
  })

  it('EventCode acepta valores del catálogo EVENT_CODES', () => {
    assertType<EventCode>(EVENT_CODES.USER_CREATED)
    assertType<EventCode>(EVENT_CODES.USER_DELETED)
    assertType<EventCode>(EVENT_CODES.SESSION_CREATED)
  })

  it('EventCode es la unión de los 15 event codes del catálogo', () => {
    expectTypeOf<EventCode>().toEqualTypeOf<
      | 'user.created'
      | 'user.verified'
      | 'user.login_success'
      | 'user.login_failed'
      | 'session.created'
      | 'session.deleted'
      | 'session.deleted_all'
      | 'user.profile_updated'
      | 'user.deleted'
      | 'user.restored'
      | 'user.hard_deleted'
      | 'empresa.created'
      | 'empresa.member_added'
      | 'empresa.member_removed'
      | 'empresa.branch_created'
    >()
  })

  it('EventCode NO acepta strings arbitrarios — cadena de más falla en @ts-expect-error', () => {
    // @ts-expect-error — 'invalid.event' no es un EventCode válido
    assertType<EventCode>('invalid.event' as string)
  })
})

// REQ-ADMIN-06 — ServiceClientPublic + CreateServiceClientResult importables
describe('Admin types (REQ-ADMIN-06)', () => {
  it('ServiceClientPublic tiene el shape esperado', () => {
    expectTypeOf<ServiceClientPublic>().toHaveProperty('id')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('slug')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('name')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('enabled')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('esAdmin')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('grants')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('createdAt')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('updatedAt')
  })

  it('ServiceClientPublic es assignable (assertType no falla)', () => {
    assertType<ServiceClientPublic>({
      id: 'svc-001',
      slug: 'my-service',
      name: 'My Service',
      enabled: true,
      esAdmin: false,
      grants: [{ audience: 'auth-api', scopes: ['users:read'] }],
      lastUsedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })
  })

  it('CreateServiceClientResult tiene secret y warning', () => {
    expectTypeOf<CreateServiceClientResult>().toHaveProperty('id')
    expectTypeOf<CreateServiceClientResult>().toHaveProperty('slug')
    expectTypeOf<CreateServiceClientResult>().toHaveProperty('secret')
    expectTypeOf<CreateServiceClientResult>().toHaveProperty('warning')
  })

  it('CreateServiceClientResult es assignable (assertType no falla)', () => {
    assertType<CreateServiceClientResult>({
      id: 'svc-001',
      slug: 'my-service',
      name: 'My Service',
      esAdmin: false,
      enabled: true,
      secret: 'abc123hex',
      warning: 'Store the secret now',
    })
  })
})

// AdminErrorCode / S2SErrorCode — uniones cerradas, asignables al ErrorCode abierto
describe('AdminErrorCode y S2SErrorCode', () => {
  it('AdminErrorCode es la unión exacta de los codes admin', () => {
    expectTypeOf<AdminErrorCode>().toEqualTypeOf<
      | 'service_client_already_exists'
      | 'service_client_not_found'
      | 'service_client_secret_rotation_conflict'
      | 'last_admin_client'
    >()
  })

  it('S2SErrorCode es la unión exacta de los codes s2s', () => {
    expectTypeOf<S2SErrorCode>().toEqualTypeOf<
      | 'user_not_found'
      | 'webhook_subscription_duplicate'
      | 'webhook_subscription_not_found'
      | 'webhook_secret_rotation_conflict'
      | 'webhook_url_invalid'
      | 'webhook_event_codes_empty'
    >()
  })

  it('ambas son asignables a ErrorCode', () => {
    expectTypeOf<AdminErrorCode>().toMatchTypeOf<ErrorCode>()
    expectTypeOf<S2SErrorCode>().toMatchTypeOf<ErrorCode>()
  })

  it('un code fuera de la unión no es AdminErrorCode ni S2SErrorCode', () => {
    // @ts-expect-error — 'no_such_code' no pertenece a AdminErrorCode
    assertType<AdminErrorCode>('no_such_code')
    // @ts-expect-error — 'no_such_code' no pertenece a S2SErrorCode
    assertType<S2SErrorCode>('no_such_code')
  })
})

// REQ-S2S-06 — S2SClientConfig importable
describe('S2S types (REQ-S2S-06)', () => {
  it('S2SClientConfig tiene baseUrl y tokenProvider, y ya no las credenciales', () => {
    expectTypeOf<S2SClientConfig>().toHaveProperty('baseUrl')
    expectTypeOf<S2SClientConfig>().toHaveProperty('tokenProvider')
    expectTypeOf<S2SClientConfig>().not.toHaveProperty('secretHex')
  })

  it('S2SClientConfig es assignable (assertType no falla)', () => {
    assertType<S2SClientConfig>({
      baseUrl: 'https://auth.example.com',
      tokenProvider: { getToken: async () => 't', invalidate: () => {} },
    })
  })
})

// REQ-ERR-03 — assertType directo EvaApiError
describe('EvaApiError assertType (REQ-ERR-03)', () => {
  it('objeto literal con kind/code/message/status es assignable a EvaApiError', () => {
    assertType<EvaApiError>({
      kind: 'api',
      code: 'unauthorized',
      message: 'x',
      status: 401,
    })
  })
})

// REQ-ERR-04 — assertType directo EvaSdkError
describe('EvaSdkError assertType (REQ-ERR-04)', () => {
  it('objeto literal con kind/reason/message/status es assignable a EvaSdkError', () => {
    assertType<EvaSdkError>({
      kind: 'sdk',
      reason: 'token_invalid',
      message: 'x',
      status: 401,
    })
  })
})

// REQ-ERR-05 — assertType EvaError con valor api o sdk
describe('EvaError assertType (REQ-ERR-05)', () => {
  it('un EvaApiError es assignable a EvaError', () => {
    const apiOrSdkError: EvaApiError = {
      kind: 'api',
      code: 'unauthorized',
      message: 'x',
      status: 401,
    }
    assertType<EvaError>(apiOrSdkError)
  })

  it('un EvaSdkError es assignable a EvaError', () => {
    const sdkErr: EvaSdkError = {
      kind: 'sdk',
      reason: 'token_invalid',
      message: 'x',
      status: 401,
    }
    assertType<EvaError>(sdkErr)
  })
})

// REQ-ERR-06 — SdkErrorReason solo acepta los 6 valores — 7mo valor falla
describe('SdkErrorReason test negativo (REQ-ERR-06)', () => {
  it('valor fuera de los 6 literales NO es assignable a SdkErrorReason', () => {
    // @ts-expect-error — 'unknown_reason' no está en SdkErrorReason
    assertType<SdkErrorReason>('unknown_reason' as string)
  })
})

// REQ-ERR-07 — CoreErrorCode cerrado / ErrorCode abierto
describe('CoreErrorCode cerrado vs ErrorCode abierto (REQ-ERR-07)', () => {
  it('CoreErrorCode NO acepta strings arbitrarios', () => {
    // @ts-expect-error — 'feature_specific_error' no está en CoreErrorCode
    assertType<CoreErrorCode>('feature_specific_error' as string)
  })

  it('ErrorCode acepta strings arbitrarios (catálogo abierto)', () => {
    assertType<ErrorCode>('service_client_already_exists')
    assertType<ErrorCode>('feature_specific_error')
  })
})

// REQ-RESULT-01 — legacy shape { ok: false, error: string, status: number } DEBE FALLAR
describe('Result legacy shape FALLA (REQ-RESULT-01)', () => {
  it('{ ok: false, error: string, status: 401 } NO es assignable a Result<string>', () => {
    const _r: Result<string> = {
      ok: false,
      // @ts-expect-error — error debe ser EvaError, no string
      error: 'some error string',
      status: 401,
    }
    void _r
  })
})

// REQ-RESULT-02 — narrowing exhaustivo con never en else
describe('Result narrowing exhaustivo por kind (REQ-RESULT-02)', () => {
  it('rama else tras api+sdk es never', () => {
    const err = undefined as unknown as EvaError
    if (err.kind === 'api') {
      expectTypeOf(err).toEqualTypeOf<EvaApiError>()
    } else if (err.kind === 'sdk') {
      expectTypeOf(err).toEqualTypeOf<EvaSdkError>()
    } else {
      // Tras agotar 'api' y 'sdk', el tipo del else es never
      expectTypeOf(err).toBeNever()
    }
  })
})

// ───── Batch-14 G1: AccountState (literales vs string arbitrario) ─────

import type { AccountState } from '../src/account-states'
import { ACCOUNT_STATES } from '../src/account-states'

describe('AccountState (Batch-14 G1)', () => {
  it('AccountState es la unión de los 6 literales', () => {
    expectTypeOf<AccountState>().toEqualTypeOf<
      | 'no_verificado'
      | 'verificado'
      | 'pendiente_de_verificacion'
      | 'suspendido'
      | 'baneado'
      | 'eliminado'
    >()
  })

  it('ACCOUNT_STATES.verificado es assignable a AccountState', () => {
    assertType<AccountState>(ACCOUNT_STATES.verificado)
  })

  it('ACCOUNT_STATES.suspendido es assignable a AccountState', () => {
    assertType<AccountState>(ACCOUNT_STATES.suspendido)
  })

  it('string arbitrario "foo" NO es assignable a AccountState', () => {
    // @ts-expect-error — 'foo' no es un AccountState válido
    assertType<AccountState>('foo' as string)
  })
})

// REQ-RESULT-03 — { ok: true, data: 'hello' } no falla
describe('Result ok:true no falla (REQ-RESULT-03)', () => {
  it('{ ok: true, data: string } es assignable a Result<string>', () => {
    assertType<Result<string>>({ ok: true, data: 'hello' })
  })
})

// ───── T-47: EvaErrorMessages + configureEvaAuth + evaAuthOpenAPIRoutes ─────

import type { EvaErrorMessages } from '../src/error-messages'
import { evaAuthOpenAPIRoutes } from '../src/hono-openapi/index'
import { OpenAPIHono } from '@hono/zod-openapi'

describe('EvaErrorMessages type', () => {
  it('tiene exactamente las 17 keys requeridas como string', () => {
    expectTypeOf<EvaErrorMessages['authRequired']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenInvalid']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenExpired']>().toEqualTypeOf<string>()
    expectTypeOf<
      EvaErrorMessages['tokenClaimsInvalid']
    >().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenNotFound']>().toEqualTypeOf<string>()
    expectTypeOf<
      EvaErrorMessages['verifyFailedAfterRefresh']
    >().toEqualTypeOf<string>()
    expectTypeOf<
      EvaErrorMessages['refreshNoNewTokens']
    >().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['refreshFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['loginFailed']>().toEqualTypeOf<string>()
    expectTypeOf<
      EvaErrorMessages['registrationFailed']
    >().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['logoutFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['invalidJsonBody']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['invalidPhone']>().toEqualTypeOf<string>()
    expectTypeOf<
      EvaErrorMessages['invalidUpdateBody']
    >().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['sessionInvalid']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['originNotAllowed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['internalError']>().toEqualTypeOf<string>()
  })
})

describe('ConfigureEvaAuthOptions.errorMessages', () => {
  it('acepta Partial<EvaErrorMessages> opcional', () => {
    type EM = ConfigureEvaAuthOptions['errorMessages']
    expectTypeOf<EM>().toEqualTypeOf<Partial<EvaErrorMessages> | undefined>()
  })
})

describe('evaAuthOpenAPIRoutes return type', () => {
  it('retorna OpenAPIHono', () => {
    const result = evaAuthOpenAPIRoutes()
    expectTypeOf(result).toMatchTypeOf<OpenAPIHono>()
  })
})

// ───── REQ-SDK-04: http-client.getCode expone challengeId ─────

describe('http-client.getCode return type', () => {
  it('getCode retorna Result<{ message: string; challengeId: string }>', () => {
    expectTypeOf<Awaited<ReturnType<EvaHttpClient['getCode']>>>().toEqualTypeOf<
      Result<{ message: string; challengeId: string }>
    >()
  })
})

// ───── S1 contract aliases (D-28): old SDK type == contract type, proven before the swap ─────

import type { z as zod } from 'zod'
import type {
  ErrorResponse as ContractErrorResponse,
  GetCodeResponse as ContractGetCodeResponse,
  LoginResponse as ContractLoginResponse,
  ERROR_CODES as CONTRACT_ERROR_CODES,
  HEADERS as CONTRACT_HEADERS,
} from '@eva_solutions/auth-contracts'
import type {
  ErrorResponseSchema,
  GetCodeResponseSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
} from '../src/schemas'
import type { ERROR_CODES as SDK_ERROR_CODES } from '../src/error-codes'
import type { HEADERS as SDK_HEADERS } from '../src/constants'

describe('S1 SDK mirrors equal the contract (D-28)', () => {
  it('ErrorResponseSchema output == contract ErrorResponse', () => {
    expectTypeOf<
      zod.output<typeof ErrorResponseSchema>
    >().toEqualTypeOf<ContractErrorResponse>()
  })

  it('GetCodeResponseSchema output == contract GetCodeResponse', () => {
    expectTypeOf<
      zod.output<typeof GetCodeResponseSchema>
    >().toEqualTypeOf<ContractGetCodeResponse>()
  })

  it('LoginResponseSchema and RefreshResponseSchema output == contract LoginResponse', () => {
    expectTypeOf<
      zod.output<typeof LoginResponseSchema>
    >().toEqualTypeOf<ContractLoginResponse>()
    expectTypeOf<
      zod.output<typeof RefreshResponseSchema>
    >().toEqualTypeOf<ContractLoginResponse>()
  })

  it('ERROR_CODES and HEADERS have the contract type', () => {
    expectTypeOf<typeof SDK_ERROR_CODES>().toEqualTypeOf<
      typeof CONTRACT_ERROR_CODES
    >()
    expectTypeOf<typeof SDK_HEADERS>().toEqualTypeOf<typeof CONTRACT_HEADERS>()
  })
})

// ───── S2 contract aliases (D-28): old SDK type == contract type, proven before the swap ─────

import type {
  ACCOUNT_STATES as CONTRACT_ACCOUNT_STATES,
  ACTIVITY_STATES as CONTRACT_ACTIVITY_STATES,
  PRIVACY_STATES as CONTRACT_PRIVACY_STATES,
  Company as ContractCompany,
  ProfileResponse as ContractProfileResponse,
  PublicProfile as ContractPublicProfile,
  Session as ContractSession,
  UsersBatchRequest as ContractUsersBatchRequest,
  UsersBatchResponse as ContractUsersBatchResponse,
} from '@eva_solutions/auth-contracts'
import type {
  ActivityState,
  EvaEmpresa,
  EvaSession,
  EvaUser,
  PrivacyState,
} from '../src/types'
import type { ACCOUNT_STATES as SDK_ACCOUNT_STATES } from '../src/account-states'
import type {
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  S2SGetUserResult,
} from '../src/s2s/types'

describe('S2 SDK mirrors equal the contract (D-28)', () => {
  it('EvaUser == contract PublicProfile', () => {
    expectTypeOf<EvaUser>().toEqualTypeOf<ContractPublicProfile>()
  })

  it('EvaSession == contract Session and EvaEmpresa == contract Company', () => {
    expectTypeOf<EvaSession>().toEqualTypeOf<ContractSession>()
    expectTypeOf<EvaEmpresa>().toEqualTypeOf<ContractCompany>()
  })

  it('ActivityState and PrivacyState are the members of the contract tuples', () => {
    expectTypeOf<ActivityState>().toEqualTypeOf<
      (typeof CONTRACT_ACTIVITY_STATES)[number]
    >()
    expectTypeOf<PrivacyState>().toEqualTypeOf<
      (typeof CONTRACT_PRIVACY_STATES)[number]
    >()
  })

  it('ACCOUNT_STATES has the contract type', () => {
    expectTypeOf<typeof SDK_ACCOUNT_STATES>().toEqualTypeOf<
      typeof CONTRACT_ACCOUNT_STATES
    >()
  })

  it('S2S batch input and result equal the contract batch shapes', () => {
    expectTypeOf<S2SBatchUsersInput>().toEqualTypeOf<ContractUsersBatchRequest>()
    expectTypeOf<S2SBatchUsersResult>().toEqualTypeOf<
      ContractUsersBatchResponse['data']
    >()
  })

  it('S2S get user result equals the contract profile data (no { user } wrapper)', () => {
    expectTypeOf<S2SGetUserResult>().toEqualTypeOf<
      ContractProfileResponse['data']
    >()
  })
})

// ───── S3 contract aliases (D-28): old SDK type == contract type, proven before the swap ─────

import type {
  CreateServiceClientRequest as ContractCreateServiceClientRequest,
  CreateServiceClientResponse as ContractCreateServiceClientResponse,
  CreateSubscriptionRequest as ContractCreateSubscriptionRequest,
  DeliveriesQuery as ContractDeliveriesQuery,
  Delivery as ContractDelivery,
  EVENT_CODES as CONTRACT_EVENT_CODES,
  EventCode as ContractEventCode,
  RestoreUserResponse as ContractRestoreUserResponse,
  RotateServiceClientSecretResponse as ContractRotateServiceClientSecretResponse,
  RotateSubscriptionSecretResponse as ContractRotateSubscriptionSecretResponse,
  ServiceClientPublic as ContractServiceClientPublic,
  ServiceScope as ContractServiceScope,
  Subscription as ContractSubscription,
  UpdateServiceClientRequest as ContractUpdateServiceClientRequest,
  UpdateServiceClientResponse as ContractUpdateServiceClientResponse,
  UpdateSubscriptionRequest as ContractUpdateSubscriptionRequest,
  WEBHOOK_HEADERS as CONTRACT_WEBHOOK_HEADERS,
} from '@eva_solutions/auth-contracts'
import type {
  EVENT_CODES as SDK_EVENT_CODES,
  WEBHOOK_HEADERS as SDK_WEBHOOK_HEADERS,
} from '../src/webhooks/constants'
import type {
  RotateWebhookSecretResult,
  WebhookDelivery,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
} from '../src/webhooks/types'
import type { MaintenanceCleanupResponse as ContractMaintenanceCleanupResponse } from '@eva_solutions/auth-contracts'
import type {
  CreateServiceClientInput,
  MaintenanceCleanupQuery,
  MaintenanceCleanupResult,
  RestoreUserResult,
  RotateSecretResult,
  UpdateServiceClientInput,
  UpdateServiceClientResult,
} from '../src/admin/types'
import type {
  CreateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  UpdateWebhookSubscriptionInput,
} from '../src/s2s/types'
import type { S2SScope } from '../src/s2s/constants'

describe('S3 SDK mirrors equal the contract (D-28)', () => {
  it('webhook constants have the contract type', () => {
    expectTypeOf<typeof SDK_EVENT_CODES>().toEqualTypeOf<
      typeof CONTRACT_EVENT_CODES
    >()
    expectTypeOf<typeof SDK_WEBHOOK_HEADERS>().toEqualTypeOf<
      typeof CONTRACT_WEBHOOK_HEADERS
    >()
    expectTypeOf<EventCode>().toEqualTypeOf<ContractEventCode>()
  })

  it('WebhookDelivery and RotateWebhookSecretResult equal the contract shapes', () => {
    expectTypeOf<WebhookDelivery>().toEqualTypeOf<ContractDelivery>()
    expectTypeOf<RotateWebhookSecretResult>().toEqualTypeOf<
      ContractRotateSubscriptionSecretResponse['data']
    >()
  })

  it('admin result shapes equal the contract responses', () => {
    expectTypeOf<ServiceClientPublic>().toEqualTypeOf<ContractServiceClientPublic>()
    expectTypeOf<CreateServiceClientResult>().toEqualTypeOf<
      ContractCreateServiceClientResponse['data']
    >()
    expectTypeOf<UpdateServiceClientResult>().toEqualTypeOf<
      ContractUpdateServiceClientResponse['data']
    >()
    expectTypeOf<RotateSecretResult>().toEqualTypeOf<
      ContractRotateServiceClientSecretResponse['data']
    >()
  })

  it('maintenanceCleanup result equals the contract response and its query takes a number', () => {
    expectTypeOf<MaintenanceCleanupResult>().toEqualTypeOf<
      ContractMaintenanceCleanupResponse['data']
    >()
    expectTypeOf<MaintenanceCleanupQuery>().toEqualTypeOf<{ limit?: number }>()
  })

  it('webhook subscription inputs equal the contract request shapes', () => {
    expectTypeOf<CreateWebhookSubscriptionInput>().toEqualTypeOf<ContractCreateSubscriptionRequest>()
    expectTypeOf<UpdateWebhookSubscriptionInput>().toEqualTypeOf<ContractUpdateSubscriptionRequest>()
  })

  // SDK-owned on purpose (listed in apply-progress): the SDK type is more ergonomic than the wire
  // type, so these stay hand-written and this block records that they do NOT alias the contract.
  it('SDK-owned ergonomic types stay different from the wire types', () => {
    // `eventCodes` is `EventCode[]` for SDK callers, `string[]` on the wire
    expectTypeOf<WebhookSubscription>().not.toEqualTypeOf<ContractSubscription>()
    expectTypeOf<
      WebhookSubscriptionWithSecret['subscription']
    >().toEqualTypeOf<WebhookSubscription>()
    // the coerced numbers of the query are `unknown` as zod input; the SDK takes numbers
    expectTypeOf<ListWebhookDeliveriesQuery>().not.toEqualTypeOf<ContractDeliveriesQuery>()
    // the admin inputs are the contract request types (nothing is loosened any more)
    expectTypeOf<CreateServiceClientInput>().toEqualTypeOf<ContractCreateServiceClientRequest>()
    expectTypeOf<UpdateServiceClientInput>().toEqualTypeOf<ContractUpdateServiceClientRequest>()
    // `stateAccount` is the full AccountState union in the SDK, the one restore literal on the wire
    expectTypeOf<RestoreUserResult>().not.toEqualTypeOf<
      ContractRestoreUserResponse['data']
    >()
  })

  it('S2S_SCOPES values are the contract scopes (D-27)', () => {
    expectTypeOf<S2SScope>().toEqualTypeOf<ContractServiceScope<'auth-api'>>()
  })
})

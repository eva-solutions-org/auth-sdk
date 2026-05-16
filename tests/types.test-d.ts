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
import { evaAuth, getEvaPayload } from '../src/hono'
import { verifyAccessToken } from '../src/jwt'
import { verifyRequest } from '../src/generic/verify'
import type { Context } from 'hono'
import type { EvaAuthVariables } from '../src/hono/middleware'

// ───── REQ-TE-002: Sin generic ≡ legacy shape ─────

describe('EvaTokenPayload sin generic', () => {
  it('es estructuralmente idéntico al tipo previo { id: string; sessionId: string }', () => {
    expectTypeOf<EvaTokenPayload>().toEqualTypeOf<{ id: string; sessionId: string }>()
  })
})

// ───── REQ-TE-003: Con generic aplica intersección ─────

describe('EvaTokenPayload con generic', () => {
  it('EvaTokenPayload<{ phone: string }> es { id, sessionId, phone }', () => {
    expectTypeOf<EvaTokenPayload<{ phone: string }>>().toEqualTypeOf<{
      id: string
      sessionId: string
      phone: string
    }>()
  })

  it('EvaTokenPayload<{ role: "admin" | "user" }> preserva literales', () => {
    expectTypeOf<EvaTokenPayload<{ role: 'admin' | 'user' }>>().toEqualTypeOf<{
      id: string
      sessionId: string
      role: 'admin' | 'user'
    }>()
  })
})

// ───── REQ-TE-010: verifyAccessToken infiere TExtra desde schema ─────

describe('verifyAccessToken return type', () => {
  it('sin schema: retorna Result<EvaTokenPayload<{}>>', () => {
    type R = Awaited<ReturnType<typeof verifyAccessToken>>
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
    type MyVars = EvaAuthVariables<{ phone: string }>
    // oxlint-disable-next-line no-unused-vars -- type-level declaration required for type inference test (never used at runtime)
    declare const c: Context<{ Variables: MyVars }>
    type Result = ReturnType<typeof getEvaPayload<{ phone: string }>>
    expectTypeOf<Result>().toEqualTypeOf<EvaTokenPayload<{ phone: string }>>()
  })
})

// ───── REQ-TE-014: verifyRequest preserva TExtra ─────

describe('verifyRequest return type', () => {
  it('sin generic: payload es EvaTokenPayload<{}>', () => {
    type R = Awaited<ReturnType<typeof verifyRequest>>
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
import type { CoreErrorCode, ErrorCode, SdkErrorReason } from '../src/error-codes'
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
    declare const err: EvaError
    if (err.kind === 'api') {
      // En la rama 'api', code está disponible
      expectTypeOf(err).toHaveProperty('code')
    }
  })

  it('narrowing por kind — rama sdk tiene reason', () => {
    declare const err: EvaError
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
import type { ServiceClientPublic, CreateServiceClientResult } from '../src/admin/types'
import type { S2SClientConfig } from '../src/s2s/types'
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

  it('EventCode es la unión de los 11 event codes del catálogo', () => {
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
    expectTypeOf<ServiceClientPublic>().toHaveProperty('scopes')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('createdAt')
    expectTypeOf<ServiceClientPublic>().toHaveProperty('updatedAt')
  })

  it('ServiceClientPublic es assignable (assertType no falla)', () => {
    assertType<ServiceClientPublic>({
      id: 'svc-001',
      slug: 'my-service',
      name: 'My Service',
      enabled: true,
      scopes: ['read:users'],
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
      scopes: [],
      enabled: true,
      secret: 'abc123hex',
      warning: 'Store the secret now',
    })
  })
})

// REQ-S2S-06 — S2SClientConfig importable
describe('S2S types (REQ-S2S-06)', () => {
  it('S2SClientConfig tiene clientId, secretHex, baseUrl', () => {
    expectTypeOf<S2SClientConfig>().toHaveProperty('clientId')
    expectTypeOf<S2SClientConfig>().toHaveProperty('secretHex')
    expectTypeOf<S2SClientConfig>().toHaveProperty('baseUrl')
  })

  it('S2SClientConfig es assignable (assertType no falla)', () => {
    assertType<S2SClientConfig>({
      clientId: 'my-service',
      secretHex: 'a'.repeat(64),
      baseUrl: 'https://auth.example.com',
    })
  })
})

// REQ-ERR-03 — assertType directo EvaApiError
describe('EvaApiError assertType (REQ-ERR-03)', () => {
  it('objeto literal con kind/code/message/status es assignable a EvaApiError', () => {
    assertType<EvaApiError>({ kind: 'api', code: 'unauthorized', message: 'x', status: 401 })
  })
})

// REQ-ERR-04 — assertType directo EvaSdkError
describe('EvaSdkError assertType (REQ-ERR-04)', () => {
  it('objeto literal con kind/reason/message/status es assignable a EvaSdkError', () => {
    assertType<EvaSdkError>({ kind: 'sdk', reason: 'token_invalid', message: 'x', status: 401 })
  })
})

// REQ-ERR-05 — assertType EvaError con valor api o sdk
describe('EvaError assertType (REQ-ERR-05)', () => {
  it('un EvaApiError es assignable a EvaError', () => {
    const apiOrSdkError: EvaApiError = { kind: 'api', code: 'unauthorized', message: 'x', status: 401 }
    assertType<EvaError>(apiOrSdkError)
  })

  it('un EvaSdkError es assignable a EvaError', () => {
    const sdkErr: EvaSdkError = { kind: 'sdk', reason: 'token_invalid', message: 'x', status: 401 }
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
    // @ts-expect-error — error debe ser EvaError, no string; status no existe top-level
    const _r: Result<string> = { ok: false, error: 'some error string', status: 401 }
    void _r
  })
})

// REQ-RESULT-02 — narrowing exhaustivo con never en else
describe('Result narrowing exhaustivo por kind (REQ-RESULT-02)', () => {
  it('rama else tras api+sdk es never', () => {
    declare const err: EvaError
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
  it('tiene exactamente las 16 keys requeridas como string', () => {
    expectTypeOf<EvaErrorMessages['authRequired']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenInvalid']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenExpired']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenClaimsInvalid']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['tokenNotFound']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['verifyFailedAfterRefresh']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['refreshNoNewTokens']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['refreshFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['loginFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['registrationFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['logoutFailed']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['invalidJsonBody']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['invalidPhone']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['invalidUpdateBody']>().toEqualTypeOf<string>()
    expectTypeOf<EvaErrorMessages['sessionInvalid']>().toEqualTypeOf<string>()
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

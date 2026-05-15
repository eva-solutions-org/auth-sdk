/**
 * Type tests para la capa React del SDK.
 * Valida que AuthState y AuthContextValue exponen EvaError (no EvaAuthError legacy).
 * Ejecutados con: pnpm test:types (vitest typecheck)
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import type { AuthState, AuthContextValue } from '../src/react/eva-auth-provider'
import type { EvaError, Result } from '../src/types'

// ───── AuthState expone EvaError ─────

describe('AuthState.error — tipo EvaError | null', () => {
  it('error es EvaError | null (no string ni EvaAuthError legacy)', () => {
    expectTypeOf<AuthState['error']>().toEqualTypeOf<EvaError | null>()
  })
})

// ───── AuthContextValue hereda error de AuthState ─────

describe('AuthContextValue.error — heredado de AuthState', () => {
  it('error es EvaError | null en el context value', () => {
    expectTypeOf<AuthContextValue['error']>().toEqualTypeOf<EvaError | null>()
  })
})

// ───── login.getCode y login.verify retornan Result con EvaError ─────

describe('AuthContextValue.login.getCode — Result<{ message }>', () => {
  it('retorna Promise<Result<{ message: string }>>', () => {
    expectTypeOf<AuthContextValue['login']['getCode']>().toBeFunction()
    expectTypeOf<ReturnType<AuthContextValue['login']['getCode']>>().toEqualTypeOf<
      Promise<Result<{ message: string }>>
    >()
  })
})

describe('AuthContextValue.logout — Result<{ message }>', () => {
  it('retorna Promise<Result<{ message: string }>>', () => {
    expectTypeOf<ReturnType<AuthContextValue['logout']>>().toEqualTypeOf<
      Promise<Result<{ message: string }>>
    >()
  })
})

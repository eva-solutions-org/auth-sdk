/**
 * Key equality between the BFF input schemas / http-client params and the contract request types
 * (D-30). The BFF schemas stay loose (`z.string().min(1)`), so only the KEYS are compared; the
 * `PATCH /user` record schema is excluded on purpose (it accepts any key).
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import type { z } from 'zod'
import type {
  GetCodeRequest,
  LoginRequest,
} from '@eva_solutions/auth-contracts'
import type { GetCodeSchema, LoginSchema } from '../src/schemas'
import type { EvaHttpClient } from '../src/http-client'

type DeviceKeys = 'deviceType' | 'os' | 'browser' | 'userAgent'

describe('BFF schema keys follow the contract request types', () => {
  it('GetCodeSchema keys == keyof GetCodeRequest', () => {
    expectTypeOf<keyof z.infer<typeof GetCodeSchema>>().toEqualTypeOf<
      keyof GetCodeRequest
    >()
  })

  it('LoginSchema keys == LoginRequest keys minus the device fields', () => {
    expectTypeOf<keyof z.infer<typeof LoginSchema>>().toEqualTypeOf<
      Exclude<keyof LoginRequest, DeviceKeys>
    >()
  })

  it('http-client login params keys == keyof LoginRequest', () => {
    expectTypeOf<keyof Parameters<EvaHttpClient['login']>[0]>().toEqualTypeOf<
      keyof LoginRequest
    >()
  })

  it('http-client getCode params keys == keyof GetCodeRequest', () => {
    expectTypeOf<keyof Parameters<EvaHttpClient['getCode']>[0]>().toEqualTypeOf<
      keyof GetCodeRequest
    >()
  })
})

import { describe, it, expect } from 'vitest'
import type { RouteDescriptor } from '@eva_solutions/auth-contracts'
import { apiPath } from '../src/api-path'

const NO_PARAMS: RouteDescriptor = { method: 'post', path: '/login' }
const ONE_PARAM: RouteDescriptor = { method: 'delete', path: '/sessions/{id}' }
const TWO_PARAMS: RouteDescriptor = {
  method: 'get',
  path: '/things/{kind}/items/{id}',
}

describe('apiPath', () => {
  it('fills_params_and_throws_on_missing: a route without params is returned as is', () => {
    expect(apiPath(NO_PARAMS)).toBe('/login')
  })

  it('fills_params_and_throws_on_missing: fills every {param} from the params object', () => {
    expect(apiPath(ONE_PARAM, { id: 's-1' })).toBe('/sessions/s-1')
    expect(apiPath(TWO_PARAMS, { kind: 'a', id: 'b' })).toBe(
      '/things/a/items/b',
    )
  })

  it('fills_params_and_throws_on_missing: throws naming the missing param', () => {
    expect(() => apiPath(ONE_PARAM)).toThrow(
      '[eva-auth-sdk] missing path param id',
    )
    expect(() => apiPath(TWO_PARAMS, { kind: 'a' })).toThrow(
      '[eva-auth-sdk] missing path param id',
    )
  })

  it('does not add the API prefix before the prefix slice', () => {
    expect(apiPath(NO_PARAMS).startsWith('/api/')).toBe(false)
  })
})

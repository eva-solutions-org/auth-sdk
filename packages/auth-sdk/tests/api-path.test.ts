import { describe, it, expect } from 'vitest'
import { API_PREFIX } from '@eva_solutions/auth-contracts'
import type { RouteDescriptor } from '@eva_solutions/auth-contracts'
import { apiPath } from '../src/api-path'

const NO_PARAMS: RouteDescriptor = { method: 'post', path: '/login' }
const ONE_PARAM: RouteDescriptor = { method: 'delete', path: '/sessions/{id}' }
const TWO_PARAMS: RouteDescriptor = {
  method: 'get',
  path: '/things/{kind}/items/{id}',
}

describe('apiPath', () => {
  it('fills_params_and_throws_on_missing: a route without params gets only the prefix', () => {
    expect(apiPath(NO_PARAMS)).toBe('/api/v1/login')
  })

  it('fills_params_and_throws_on_missing: fills every {param} from the params object', () => {
    expect(apiPath(ONE_PARAM, { id: 's-1' })).toBe('/api/v1/sessions/s-1')
    expect(apiPath(TWO_PARAMS, { kind: 'a', id: 'b' })).toBe(
      '/api/v1/things/a/items/b',
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

  it('prefix_added_in_s4: every built path is API_PREFIX + the filled descriptor path', () => {
    expect(API_PREFIX).toBe('/api/v1')
    expect(apiPath(NO_PARAMS)).toBe(`${API_PREFIX}/login`)
    expect(apiPath(ONE_PARAM, { id: 's-1' })).toBe(`${API_PREFIX}/sessions/s-1`)
  })
})

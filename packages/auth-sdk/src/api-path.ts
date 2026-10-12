import type { RouteDescriptor } from '@eva_solutions/auth-contracts'

const PATH_PARAM = /\{(\w+)\}/g

/**
 * Builds the request path of a contract route: fills every `{param}` of the descriptor path.
 * Throws when a param is missing (a programming error, never a runtime condition).
 *
 * Today it returns the path as the contract declares it. The API version prefix is added here in
 * a later slice, so every client call picks it up from this single place.
 *
 * Import rule: this module may be reached from `src/react`, so it only takes `import type` from the
 * contract (a by-value import of a schema module would bloat the react bundle).
 */
export function apiPath(
  route: RouteDescriptor,
  params: Readonly<Record<string, string>> = {},
): string {
  return route.path.replace(PATH_PARAM, (_match, key: string) => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(`[eva-auth-sdk] missing path param ${key}`)
    }
    return value
  })
}

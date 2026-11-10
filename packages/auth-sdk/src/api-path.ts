import { API_PREFIX } from '@eva_solutions/auth-contracts'
import type { RouteDescriptor } from '@eva_solutions/auth-contracts'

const PATH_PARAM = /\{(\w+)\}/g

/**
 * Builds the request path of a contract route: fills every `{param}` of the descriptor path and
 * returns `API_PREFIX + path`. Throws when a param is missing (a programming error, never a
 * runtime condition).
 *
 * Every versioned route is built here, so the prefix lives in this single place. Routes that stay
 * at the root (`/.well-known/jwks.json` in `jwks.ts`, `/health` in `http-client.ts`) do not go
 * through this helper. Requests to `/internal/*` sign the final URL pathname, which already
 * includes the prefix.
 *
 * Import rule (react closure): only `http-client.ts` and the S2S/admin clients import this module,
 * none of them reachable from `src/react`. The by-value import of `API_PREFIX` is safe because it
 * comes from the PURE `routes` module of the contract (no zod). Keep it that way: never import a
 * schema module by value here.
 */
export function apiPath(
  route: RouteDescriptor,
  params: Readonly<Record<string, string>> = {},
): string {
  const filled = route.path.replace(PATH_PARAM, (_match, key: string) => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(`[eva-auth-sdk] missing path param ${key}`)
    }
    return value
  })
  return `${API_PREFIX}${filled}`
}

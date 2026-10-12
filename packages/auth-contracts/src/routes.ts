/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). Routes are plain data.
 */

/** Version prefix of every Auth route except the root ones (JWKS, health, docs UI). */
export const API_PREFIX = '/api/v1' as const

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete'

/**
 * Route as data: `path` is relative to {@link API_PREFIX} and uses the OpenAPI template form
 * (`/sessions/{id}`). `createRoute` stays in the API; the contract only describes the route.
 */
export type RouteDescriptor = {
  readonly method: HttpMethod
  readonly path: `/${string}`
}

/** Login, refresh and logout routes. Relative to {@link API_PREFIX}. */
export const AUTH_ROUTES = {
  getCode: { method: 'post', path: '/login/get-code' },
  login: { method: 'post', path: '/login' },
  refresh: { method: 'post', path: '/login/refresh' },
  logout: { method: 'post', path: '/login/logout' },
} as const satisfies Record<string, RouteDescriptor>

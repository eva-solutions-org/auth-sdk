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

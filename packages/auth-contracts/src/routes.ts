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

/** Routes of the authenticated user profile. Relative to {@link API_PREFIX}. */
export const USER_ROUTES = {
  get: { method: 'get', path: '/user' },
  update: { method: 'patch', path: '/user' },
  deactivate: { method: 'delete', path: '/user' },
  listCompanies: { method: 'get', path: '/user/empresas' },
} as const satisfies Record<string, RouteDescriptor>

/** Routes of the authenticated user sessions. Relative to {@link API_PREFIX}. */
export const SESSION_ROUTES = {
  list: { method: 'get', path: '/sessions' },
  deleteOne: { method: 'delete', path: '/sessions/{id}' },
  deleteAll: { method: 'delete', path: '/sessions' },
} as const satisfies Record<string, RouteDescriptor>

/** Service-to-service user lookups. Relative to {@link API_PREFIX}. */
export const INTERNAL_USER_ROUTES = {
  get: { method: 'get', path: '/internal/users/{id}' },
  batch: { method: 'post', path: '/internal/users/batch' },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Webhook subscription and delivery routes of the service-to-service surface. Relative to
 * {@link API_PREFIX}.
 */
export const WEBHOOK_ROUTES = {
  createSubscription: {
    method: 'post',
    path: '/internal/webhooks/subscriptions',
  },
  listSubscriptions: {
    method: 'get',
    path: '/internal/webhooks/subscriptions',
  },
  getSubscription: {
    method: 'get',
    path: '/internal/webhooks/subscriptions/{id}',
  },
  updateSubscription: {
    method: 'patch',
    path: '/internal/webhooks/subscriptions/{id}',
  },
  deleteSubscription: {
    method: 'delete',
    path: '/internal/webhooks/subscriptions/{id}',
  },
  rotateSubscriptionSecret: {
    method: 'post',
    path: '/internal/webhooks/subscriptions/{id}/rotate-secret',
  },
  listDeliveries: { method: 'get', path: '/internal/webhooks/deliveries' },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Admin routes: service client provisioning and user restore. Relative to {@link API_PREFIX}.
 */
export const ADMIN_ROUTES = {
  createServiceClient: { method: 'post', path: '/admin/service-clients' },
  listServiceClients: { method: 'get', path: '/admin/service-clients' },
  getServiceClient: { method: 'get', path: '/admin/service-clients/{slug}' },
  updateServiceClient: {
    method: 'patch',
    path: '/admin/service-clients/{slug}',
  },
  deleteServiceClient: {
    method: 'delete',
    path: '/admin/service-clients/{slug}',
  },
  rotateServiceClientSecret: {
    method: 'post',
    path: '/admin/service-clients/{slug}/rotate-secret',
  },
  restoreUser: { method: 'post', path: '/admin/users/{id}/restore' },
} as const satisfies Record<string, RouteDescriptor>

/** Login, refresh and logout routes. Relative to {@link API_PREFIX}. */
export const AUTH_ROUTES = {
  getCode: { method: 'post', path: '/login/get-code' },
  login: { method: 'post', path: '/login' },
  refresh: { method: 'post', path: '/login/refresh' },
  logout: { method: 'post', path: '/login/logout' },
} as const satisfies Record<string, RouteDescriptor>

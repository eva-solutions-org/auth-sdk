/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). Routes are plain data.
 */

/** Version prefix of every Auth route except the root ones (JWKS, health, docs UI). */
export const API_PREFIX = '/api/v1' as const

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

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
 * Service token endpoint. The only service-to-service route that authenticates with the signed
 * request of the service client. Relative to {@link API_PREFIX}.
 */
export const INTERNAL_TOKEN_ROUTES = {
  issue: { method: 'post', path: '/internal/token' },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Token exchange (RFC 8693). Authenticated with the Bearer service token of the actor
 * (`aud: auth-api`, permission `tokens:exchange`), not with the signed request. Relative to
 * {@link API_PREFIX}.
 */
export const INTERNAL_TOKEN_EXCHANGE_ROUTES = {
  exchange: { method: 'post', path: '/internal/token-exchange' },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Companies, branches, members, contracts and authorizations, service-to-service (Bearer service
 * token plus, where a person acts, the `subjectToken`). Relative to {@link API_PREFIX}.
 */
export const INTERNAL_EMPRESA_ROUTES = {
  create: { method: 'post', path: '/internal/empresas' },
  list: { method: 'get', path: '/internal/empresas' },
  get: { method: 'get', path: '/internal/empresas/{id}' },
  update: { method: 'patch', path: '/internal/empresas/{id}' },
  baja: { method: 'post', path: '/internal/empresas/{id}/baja' },
  reactivar: { method: 'post', path: '/internal/empresas/{id}/reactivar' },
  addMember: { method: 'post', path: '/internal/empresas/{id}/miembros' },
  updateMember: {
    method: 'patch',
    path: '/internal/empresas/{id}/miembros/{userId}',
  },
  removeMember: {
    method: 'delete',
    path: '/internal/empresas/{id}/miembros/{userId}',
  },
  createBranch: { method: 'post', path: '/internal/empresas/{id}/sucursales' },
  updateBranch: {
    method: 'patch',
    path: '/internal/empresas/{id}/sucursales/{sucursalId}',
  },
  deactivateBranch: {
    method: 'delete',
    path: '/internal/empresas/{id}/sucursales/{sucursalId}',
  },
  requestContratacion: {
    method: 'post',
    path: '/internal/empresas/{id}/productos',
  },
  cancelContratacion: {
    method: 'delete',
    path: '/internal/empresas/{id}/productos',
  },
  getContratacion: {
    method: 'get',
    path: '/internal/empresas/{id}/productos/{producto}',
  },
  setContratacion: {
    method: 'put',
    path: '/internal/empresas/{id}/productos/{producto}',
  },
  createAutorizacion: {
    method: 'post',
    path: '/internal/empresas/{id}/autorizaciones',
  },
  listAutorizaciones: {
    method: 'get',
    path: '/internal/empresas/{id}/autorizaciones',
  },
  deleteAutorizacion: {
    method: 'delete',
    path: '/internal/empresas/{id}/autorizaciones/{autorizacionId}',
  },
} as const satisfies Record<string, RouteDescriptor>

/** Groups of companies, service-to-service. Relative to {@link API_PREFIX}. */
export const INTERNAL_GRUPO_ROUTES = {
  create: { method: 'post', path: '/internal/grupos' },
  rename: { method: 'patch', path: '/internal/grupos/{id}' },
  addEmpresa: { method: 'post', path: '/internal/grupos/{id}/empresas' },
  removeEmpresa: {
    method: 'delete',
    path: '/internal/grupos/{id}/empresas/{empresaId}',
  },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Authorization check, service-to-service: only for actors with no product whose audience owns the
 * permission. Relative to {@link API_PREFIX}.
 */
export const INTERNAL_AUTORIZACION_ROUTES = {
  verificar: { method: 'get', path: '/internal/autorizaciones/verificar' },
} as const satisfies Record<string, RouteDescriptor>

/**
 * Directory of companies: users with the access token of any enabled product, and services with
 * `directorio:leer`. Relative to {@link API_PREFIX}.
 */
export const DIRECTORIO_ROUTES = {
  search: { method: 'get', path: '/directorio' },
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
 * Admin routes: service client provisioning (grants, delegations), products, company holder/baja/contract operations, user restore, webhook delivery republish and maintenance cleanup. Relative to {@link API_PREFIX}.
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
  listServiceClientGrants: {
    method: 'get',
    path: '/admin/service-clients/{slug}/grants',
  },
  setServiceClientGrant: {
    method: 'put',
    path: '/admin/service-clients/{slug}/grants',
  },
  deleteServiceClientGrant: {
    method: 'delete',
    path: '/admin/service-clients/{slug}/grants/{audience}',
  },
  listServiceClientDelegations: {
    method: 'get',
    path: '/admin/service-clients/{slug}/delegations',
  },
  setServiceClientDelegation: {
    method: 'put',
    path: '/admin/service-clients/{slug}/delegations',
  },
  deleteServiceClientDelegation: {
    method: 'delete',
    path: '/admin/service-clients/{slug}/delegations/{audience}',
  },
  listProductos: { method: 'get', path: '/admin/productos' },
  createProducto: { method: 'post', path: '/admin/productos' },
  updateProducto: { method: 'patch', path: '/admin/productos/{slug}' },
  getProductoPermisosAutorizables: {
    method: 'get',
    path: '/admin/productos/{slug}/permisos-autorizables',
  },
  setProductoPermisosAutorizables: {
    method: 'put',
    path: '/admin/productos/{slug}/permisos-autorizables',
  },
  reassignEmpresaTitular: {
    method: 'post',
    path: '/admin/empresas/{id}/titular',
  },
  bajaEmpresa: { method: 'post', path: '/admin/empresas/{id}/baja' },
  reactivarEmpresa: { method: 'post', path: '/admin/empresas/{id}/reactivar' },
  setContratacion: {
    method: 'put',
    path: '/admin/empresas/{id}/productos/{producto}',
  },
  restoreUser: { method: 'post', path: '/admin/users/{id}/restore' },
  republishPendingWebhooks: {
    method: 'post',
    path: '/admin/webhooks/republish-pending',
  },
  maintenanceCleanup: { method: 'post', path: '/admin/maintenance/cleanup' },
} as const satisfies Record<string, RouteDescriptor>

/** Login, refresh, logout and active company routes. Relative to {@link API_PREFIX}. */
export const AUTH_ROUTES = {
  getCode: { method: 'post', path: '/login/get-code' },
  login: { method: 'post', path: '/login' },
  refresh: { method: 'post', path: '/login/refresh' },
  logout: { method: 'post', path: '/login/logout' },
  setActiveEmpresa: { method: 'post', path: '/auth/empresa-activa' },
} as const satisfies Record<string, RouteDescriptor>

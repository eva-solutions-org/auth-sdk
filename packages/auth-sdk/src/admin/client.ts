/**
 * Cliente Admin para provisioning de service clients y gestión de usuarios
 * en el Auth Service.
 *
 * REQ-ADMIN-01, REQ-ADMIN-02, REQ-ADMIN-03, REQ-ADMIN-04, REQ-ADMIN-05 LOCKED.
 * REQ-RESTORE-01 LOCKED: endpoint POST /admin/users/:id/restore.
 *
 * Autenticación: firma HMAC S2S de un service client con la marca `esAdmin` (la superficie
 * `/admin` de Auth es la única, junto con el pedido de token, que conserva la firma). Una persona,
 * un client: el API registra el slug que firmó como `actor`.
 *
 * Endpoints:
 *   POST   /admin/service-clients                       → createServiceClient
 *   GET    /admin/service-clients                       → listServiceClients
 *   GET    /admin/service-clients/:slug                 → getServiceClient
 *   PATCH  /admin/service-clients/:slug                 → updateServiceClient
 *   DELETE /admin/service-clients/:slug                 → deleteServiceClient (204)
 *   POST   /admin/service-clients/:slug/rotate-secret   → rotateServiceClientSecret
 *   GET    /admin/service-clients/:slug/grants          → listServiceClientGrants
 *   PUT    /admin/service-clients/:slug/grants          → setServiceClientGrant
 *   DELETE /admin/service-clients/:slug/grants/:audience → deleteServiceClientGrant (204)
 *   POST   /admin/users/:id/restore                     → restoreUser
 *   POST   /admin/webhooks/republish-pending            → republishPendingWebhooks
 *   POST   /admin/maintenance/cleanup                   → maintenanceCleanup
 *
 * Los paths salen de `ADMIN_ROUTES` (contrato compartido) vía `apiPath`; el slug y el id se
 * codifican como UN segmento con `encodePathSegment` (el mismo helper del cliente S2S) antes de
 * insertarlos. Un slug/id vacío, `.`, `..` o que no sea string devuelve un `Result` de error
 * (`kind: 'sdk'`, `reason: 'malformed'`) sin hacer la request.
 */

import { ADMIN_ROUTES } from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { validateHttpsUrl } from '../config'
import { parseErrorResponse } from '../parse-error-response'
import { encodePathSegment } from '../path-segment'
import { signS2SHeaders } from '../s2s/sign'
import type { Result } from '../types'
import type {
  AdminClientConfig,
  ServiceClientPublic,
  CreateServiceClientInput,
  CreateServiceClientResult,
  ListServiceClientGrantsResult,
  ServiceClientGrant,
  SetServiceClientGrantInput,
  UpdateServiceClientInput,
  UpdateServiceClientResult,
  RotateSecretResult,
  RestoreUserResult,
  MaintenanceCleanupQuery,
  MaintenanceCleanupResult,
  RepublishPendingWebhooksQuery,
  RepublishPendingWebhooksResult,
} from './types'

const encoder = new TextEncoder()

/**
 * Tipo del cliente Admin retornado por `createAdminClient`.
 */
export type AdminClient = {
  createServiceClient(
    input: CreateServiceClientInput,
  ): Promise<Result<CreateServiceClientResult>>
  listServiceClients(): Promise<Result<{ clientes: ServiceClientPublic[] }>>
  getServiceClient(
    slug: string,
  ): Promise<Result<{ cliente: ServiceClientPublic }>>
  updateServiceClient(
    slug: string,
    input: UpdateServiceClientInput,
  ): Promise<Result<UpdateServiceClientResult>>
  deleteServiceClient(slug: string): Promise<Result<void>>
  rotateServiceClientSecret(slug: string): Promise<Result<RotateSecretResult>>
  listServiceClientGrants(
    slug: string,
  ): Promise<Result<ListServiceClientGrantsResult>>
  /** Crea o reemplaza la concesión del client sobre una audiencia. */
  setServiceClientGrant(
    slug: string,
    input: SetServiceClientGrantInput,
  ): Promise<Result<{ grant: ServiceClientGrant }>>
  deleteServiceClientGrant(
    slug: string,
    audience: string,
  ): Promise<Result<void>>
  restoreUser(userId: string): Promise<Result<RestoreUserResult>>
  republishPendingWebhooks(
    query?: RepublishPendingWebhooksQuery,
  ): Promise<Result<RepublishPendingWebhooksResult>>
  maintenanceCleanup(
    query?: MaintenanceCleanupQuery,
  ): Promise<Result<MaintenanceCleanupResult>>
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Realiza un fetch autenticado S2S firmando el request con HMAC-SHA-256.
 * Retorna `Result<T>` con la propiedad `data` del body de respuesta.
 */
async function adminFetch<T>({
  config,
  method,
  pathname,
  rawQuery = '',
  body,
}: {
  config: AdminClientConfig
  method: string
  pathname: string
  rawQuery?: string
  body?: unknown
}): Promise<Result<T>> {
  try {
    const bodyBytes: Uint8Array =
      body !== undefined
        ? encoder.encode(JSON.stringify(body))
        : new Uint8Array(0)

    const url = rawQuery
      ? `${config.baseUrl}${pathname}?${rawQuery}`
      : `${config.baseUrl}${pathname}`

    // Se firma el pathname y el query de la URL FINAL (incluido el prefijo de `baseUrl`), que es
    // lo que el verificador lee en `request.url`.
    const target = new URL(url)
    const authHeaders = await signS2SHeaders({
      method,
      path: target.pathname,
      rawQuery: target.search.slice(1),
      bodyBytes,
      clientId: config.clientId,
      secretHex: config.secretHex,
    })

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...authHeaders,
    }

    const res = await fetch(url, {
      method,
      headers,
      body: bodyBytes.length > 0 ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const responseBody = await res.json().catch(() => null)
      return { ok: false, error: parseErrorResponse(res.status, responseBody) }
    }

    // 204 No Content — Result<void>
    if (res.status === 204) {
      return { ok: true, data: undefined as T }
    }

    const json = (await res.json()) as { data: T }
    return { ok: true, data: json.data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'network',
        message,
        status: 0,
      },
    }
  }
}

/**
 * Result de error para un slug/id que no se puede usar como segmento del path. Se devuelve antes
 * de armar la URL: `apiPath` lanzaría con un param ausente y la promesa se rechazaría.
 */
function invalidParamResult(method: string, param: string): Result<never> {
  return {
    ok: false,
    error: {
      kind: 'sdk',
      reason: 'malformed',
      message: `${method}: ${param} inválido (no puede ser vacío, "." ni "..")`,
      status: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Crea un cliente Admin para provisioning del Auth Service.
 *
 * ADVERTENCIA: solo usar desde backends o herramientas de operador seguras — el secret del
 * service client admin nunca debe exponerse en el cliente/browser.
 *
 * @example
 * ```ts
 * const admin = createAdminClient({
 *   clientId: process.env.AUTH_ADMIN_SLUG,
 *   secretHex: process.env.AUTH_ADMIN_SECRET,
 *   baseUrl: 'https://auth.miapp.com',
 * })
 * const result = await admin.createServiceClient({ slug: 'mi-servicio' })
 * if (!result.ok) return handleError(result.error)
 * console.log('Secret (guardar ahora):', result.data.secret)
 * ```
 */
export function createAdminClient(config: AdminClientConfig): AdminClient {
  validateHttpsUrl(config.baseUrl, 'AdminClientConfig.baseUrl')
  return {
    async createServiceClient(
      input: CreateServiceClientInput,
    ): Promise<Result<CreateServiceClientResult>> {
      return adminFetch<CreateServiceClientResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.createServiceClient),
        body: input,
      })
    },

    async listServiceClients(): Promise<
      Result<{ clientes: ServiceClientPublic[] }>
    > {
      return adminFetch<{ clientes: ServiceClientPublic[] }>({
        config,
        method: 'GET',
        pathname: apiPath(ADMIN_ROUTES.listServiceClients),
      })
    },

    async getServiceClient(
      slug: string,
    ): Promise<Result<{ cliente: ServiceClientPublic }>> {
      const segment = encodePathSegment(slug)
      if (segment === null)
        return invalidParamResult('getServiceClient', 'slug')
      return adminFetch<{ cliente: ServiceClientPublic }>({
        config,
        method: 'GET',
        pathname: apiPath(ADMIN_ROUTES.getServiceClient, { slug: segment }),
      })
    },

    async updateServiceClient(
      slug: string,
      input: UpdateServiceClientInput,
    ): Promise<Result<UpdateServiceClientResult>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('updateServiceClient', 'slug')
      }
      return adminFetch<UpdateServiceClientResult>({
        config,
        method: 'PATCH',
        pathname: apiPath(ADMIN_ROUTES.updateServiceClient, { slug: segment }),
        body: input,
      })
    },

    async deleteServiceClient(slug: string): Promise<Result<void>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('deleteServiceClient', 'slug')
      }
      return adminFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(ADMIN_ROUTES.deleteServiceClient, { slug: segment }),
      })
    },

    async rotateServiceClientSecret(
      slug: string,
    ): Promise<Result<RotateSecretResult>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('rotateServiceClientSecret', 'slug')
      }
      return adminFetch<RotateSecretResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.rotateServiceClientSecret, {
          slug: segment,
        }),
      })
    },

    async listServiceClientGrants(
      slug: string,
    ): Promise<Result<ListServiceClientGrantsResult>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('listServiceClientGrants', 'slug')
      }
      return adminFetch<ListServiceClientGrantsResult>({
        config,
        method: 'GET',
        pathname: apiPath(ADMIN_ROUTES.listServiceClientGrants, {
          slug: segment,
        }),
      })
    },

    async setServiceClientGrant(
      slug: string,
      input: SetServiceClientGrantInput,
    ): Promise<Result<{ grant: ServiceClientGrant }>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('setServiceClientGrant', 'slug')
      }
      return adminFetch<{ grant: ServiceClientGrant }>({
        config,
        method: 'PUT',
        pathname: apiPath(ADMIN_ROUTES.setServiceClientGrant, {
          slug: segment,
        }),
        body: input,
      })
    },

    async deleteServiceClientGrant(
      slug: string,
      audience: string,
    ): Promise<Result<void>> {
      const segment = encodePathSegment(slug)
      if (segment === null) {
        return invalidParamResult('deleteServiceClientGrant', 'slug')
      }
      const audienceSegment = encodePathSegment(audience)
      if (audienceSegment === null) {
        return invalidParamResult('deleteServiceClientGrant', 'audience')
      }
      return adminFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(ADMIN_ROUTES.deleteServiceClientGrant, {
          slug: segment,
          audience: audienceSegment,
        }),
      })
    },

    async restoreUser(userId: string): Promise<Result<RestoreUserResult>> {
      const segment = encodePathSegment(userId)
      if (segment === null) return invalidParamResult('restoreUser', 'userId')
      return adminFetch<RestoreUserResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.restoreUser, { id: segment }),
      })
    },

    async republishPendingWebhooks(
      query?: RepublishPendingWebhooksQuery,
    ): Promise<Result<RepublishPendingWebhooksResult>> {
      const params = new URLSearchParams()
      if (query?.older_than_minutes !== undefined) {
        params.set('older_than_minutes', String(query.older_than_minutes))
      }
      if (query?.limit !== undefined) {
        params.set('limit', String(query.limit))
      }
      return adminFetch<RepublishPendingWebhooksResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.republishPendingWebhooks),
        rawQuery: params.toString(),
      })
    },

    async maintenanceCleanup(
      query?: MaintenanceCleanupQuery,
    ): Promise<Result<MaintenanceCleanupResult>> {
      const params = new URLSearchParams()
      if (query?.limit !== undefined) {
        params.set('limit', String(query.limit))
      }
      return adminFetch<MaintenanceCleanupResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.maintenanceCleanup),
        rawQuery: params.toString(),
      })
    },
  }
}

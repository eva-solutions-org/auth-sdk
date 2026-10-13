/**
 * Cliente Admin para provisioning de service clients y gestión de usuarios
 * en el Auth Service.
 *
 * REQ-ADMIN-01, REQ-ADMIN-02, REQ-ADMIN-03, REQ-ADMIN-04, REQ-ADMIN-05 LOCKED.
 * REQ-RESTORE-01 LOCKED: endpoint POST /admin/users/:id/restore.
 *
 * Autenticación: header `X-Admin-Password` con la contraseña global de admin.
 *
 * Endpoints:
 *   POST   /admin/service-clients                       → createServiceClient
 *   GET    /admin/service-clients                       → listServiceClients
 *   GET    /admin/service-clients/:slug                 → getServiceClient
 *   PATCH  /admin/service-clients/:slug                 → updateServiceClient
 *   DELETE /admin/service-clients/:slug                 → deleteServiceClient (204)
 *   POST   /admin/service-clients/:slug/rotate-secret   → rotateServiceClientSecret
 *   POST   /admin/users/:id/restore                     → restoreUser
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
import type { Result } from '../types'
import type {
  AdminClientConfig,
  ServiceClientPublic,
  CreateServiceClientInput,
  CreateServiceClientResult,
  UpdateServiceClientInput,
  UpdateServiceClientResult,
  RotateSecretResult,
  RestoreUserResult,
} from './types'

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
  restoreUser(userId: string): Promise<Result<RestoreUserResult>>
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Realiza un fetch autenticado con el header de admin password.
 * Retorna `Result<T>` con la propiedad `data` del body de respuesta.
 */
async function adminFetch<T>({
  config,
  method,
  pathname,
  body,
}: {
  config: AdminClientConfig
  method: string
  pathname: string
  body?: unknown
}): Promise<Result<T>> {
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-admin-password': config.adminPassword,
    }

    const url = `${config.baseUrl}${pathname}`

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
 * ADVERTENCIA: solo usar desde backends seguros — la contraseña de admin
 * nunca debe exponerse en el cliente/browser.
 *
 * @example
 * ```ts
 * const admin = createAdminClient({
 *   adminPassword: process.env.EVA_ADMIN_PASSWORD,
 *   baseUrl: 'https://auth.miapp.com',
 * })
 * const result = await admin.createServiceClient({ slug: 'mi-servicio', scopes: ['users:read'] })
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

    async restoreUser(userId: string): Promise<Result<RestoreUserResult>> {
      const segment = encodePathSegment(userId)
      if (segment === null) return invalidParamResult('restoreUser', 'userId')
      return adminFetch<RestoreUserResult>({
        config,
        method: 'POST',
        pathname: apiPath(ADMIN_ROUTES.restoreUser, { id: segment }),
      })
    },
  }
}

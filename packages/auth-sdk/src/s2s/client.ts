/**
 * Cliente S2S (service-to-service) para llamar a la API interna del Auth Service desde servicios
 * backend. Autentica cada llamada con `Authorization: Bearer <token de servicio>` (audiencia
 * `auth-api`) que entrega un `ServiceTokenProvider`; ante un 401 invalida el token y reintenta UNA vez.
 *
 * REQ-S2S-01, REQ-S2S-04, REQ-INT-01, REQ-INT-02 LOCKED.
 *
 * Endpoints disponibles:
 *   GET  /internal/users/:id
 *   POST /internal/users/batch
 *   POST /internal/webhooks/subscriptions
 *   GET  /internal/webhooks/subscriptions
 *   GET  /internal/webhooks/subscriptions/:id
 *   PATCH /internal/webhooks/subscriptions/:id
 *   DELETE /internal/webhooks/subscriptions/:id
 *   POST /internal/webhooks/subscriptions/:id/rotate-secret
 *   GET  /internal/webhooks/deliveries
 *   POST /internal/empresas
 *   GET  /internal/empresas/:id
 *   POST /internal/empresas/:id/miembros
 *   DELETE /internal/empresas/:id/miembros/:userId
 *   POST /internal/empresas/:id/sucursales
 *
 * Los paths salen de `INTERNAL_USER_ROUTES`, `WEBHOOK_ROUTES` e `INTERNAL_EMPRESA_ROUTES`
 * (contrato compartido) vía `apiPath`.
 */

import {
  INTERNAL_EMPRESA_ROUTES,
  INTERNAL_USER_ROUTES,
  USERS_BATCH_MAX_IDS,
  WEBHOOK_ROUTES,
} from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { validateHttpsUrl } from '../config'
import { parseErrorResponse } from '../parse-error-response'
import { encodePathSegment } from '../path-segment'
import type { Result } from '../types'
import type {
  S2SClientConfig,
  S2SGetUserResult,
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  CreateEmpresaInput,
  CreateSucursalInput,
  EmpresaResult,
  EmpresaDetailResult,
  EmpresaMemberResult,
  SucursalResult,
} from './types'
import { ServiceTokenRequestError } from './token-provider'
import type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from '../webhooks/types'

/**
 * Tipo del cliente S2S retornado por `createS2SClient`.
 */
export type S2SClient = {
  getUser(userId: string): Promise<Result<S2SGetUserResult>>
  batchUsers(input: S2SBatchUsersInput): Promise<Result<S2SBatchUsersResult>>
  createWebhookSubscription(
    input: CreateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionWithSecret>>
  listWebhookSubscriptions(): Promise<
    Result<{ subscriptions: WebhookSubscription[] }>
  >
  getWebhookSubscription(id: string): Promise<Result<WebhookSubscription>>
  updateWebhookSubscription(
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscription>>
  deleteWebhookSubscription(id: string): Promise<Result<void>>
  rotateWebhookSubscriptionSecret(
    id: string,
  ): Promise<Result<RotateWebhookSecretResult>>
  listWebhookDeliveries(
    query?: ListWebhookDeliveriesQuery,
  ): Promise<Result<{ deliveries: WebhookDelivery[] }>>
  /** Crea la empresa y su primer miembro en una sola operación (`empresas:escribir`). */
  createEmpresa(input: CreateEmpresaInput): Promise<Result<EmpresaResult>>
  /** Empresa con sus sucursales y miembros (`empresas:leer`). */
  getEmpresa(empresaId: string): Promise<Result<EmpresaDetailResult>>
  /** Agrega un miembro; si ya lo es, 409 `conflict` (`empresas:escribir`). */
  addEmpresaMember(
    empresaId: string,
    userId: string,
  ): Promise<Result<EmpresaMemberResult>>
  /** Quita un miembro; si no lo es, 404 `not_found` (`empresas:escribir`). */
  removeEmpresaMember(empresaId: string, userId: string): Promise<Result<void>>
  /** Crea una sucursal de la empresa (`empresas:escribir`). */
  createSucursal(
    empresaId: string,
    input: CreateSucursalInput,
  ): Promise<Result<SucursalResult>>
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Construye el query string a partir de un objeto de parámetros.
 * Omite valores undefined.
 */
function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      )
    }
  }
  return parts.join('&')
}

function invalidIdResult(method: string): Result<never> {
  return {
    ok: false,
    error: {
      kind: 'sdk',
      reason: 'malformed',
      message: `${method}: id inválido (no puede ser vacío, "." ni "..")`,
      status: 0,
    },
  }
}

/**
 * Realiza un fetch autenticado con el token de servicio del proveedor. Un 401 invalida el token y
 * reintenta una sola vez con uno nuevo. Retorna `Result<T>` con la propiedad `data` del body.
 */
async function s2sFetch<T>({
  config,
  method,
  pathname,
  rawQuery = '',
  body,
}: {
  config: S2SClientConfig
  method: string
  pathname: string
  rawQuery?: string
  body?: unknown
}): Promise<Result<T>> {
  try {
    const bodyText = body !== undefined ? JSON.stringify(body) : undefined
    const url = rawQuery
      ? `${config.baseUrl}${pathname}?${rawQuery}`
      : `${config.baseUrl}${pathname}`

    let usedToken = ''
    const send = async (): Promise<Response> => {
      const token = await config.tokenProvider.getToken()
      usedToken = token
      return fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: bodyText,
        signal: AbortSignal.timeout(10_000),
      })
    }

    let res = await send()
    if (res.status === 401) {
      // El token pudo vencer o revocarse antes de lo que creía el proveedor: se descarta y se
      // reintenta UNA vez. Un segundo 401 es definitivo.
      // Se pasa el token rechazado: con N 401 simultáneos solo el primero descarta; el resto
      // comparte el token renovado en vez de provocar un pedido por cada uno.
      config.tokenProvider.invalidate(usedToken)
      res = await send()
    }

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
    // El Auth Service rechazó el pedido de token (firma inválida, client deshabilitado, sin
    // concesión): es un error de API con su `error` RFC 6749 como code.
    if (err instanceof ServiceTokenRequestError) {
      return {
        ok: false,
        error: {
          kind: 'api',
          code: err.code,
          message: err.message,
          status: err.status,
        },
      }
    }
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Crea un cliente S2S autenticado para comunicarse con la API interna del Auth Service.
 *
 * @example
 * ```ts
 * const tokenProvider = createServiceTokenProvider({
 *   authUrl: 'https://auth.miapp.com',
 *   clientId: 'mi-servicio',
 *   secretHex: env.AUTH_CLIENT_SECRET_HEX,
 *   audience: 'auth-api',
 * })
 * const s2s = createS2SClient({ baseUrl: 'https://auth.miapp.com', tokenProvider })
 * const result = await s2s.getUser(userId)
 * if (!result.ok) return handleError(result.error)
 * return result.data // perfil del usuario
 * ```
 */
export function createS2SClient(config: S2SClientConfig): S2SClient {
  validateHttpsUrl(config.baseUrl, 'S2SClientConfig.baseUrl')
  return {
    async getUser(userId: string): Promise<Result<S2SGetUserResult>> {
      const segment = encodePathSegment(userId)
      if (segment === null) return invalidIdResult('getUser')
      return s2sFetch<S2SGetUserResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_USER_ROUTES.get, { id: segment }),
      })
    },

    /**
     * Consulta múltiples usuarios por ID en una sola llamada.
     *
     * @param input - Input con la lista de IDs a consultar.
     * @param input.ids - Máximo `USERS_BATCH_MAX_IDS` (100, constante del contrato compartido)
     *   IDs por llamada. El schema del request no lleva ese tope: lo aplica este cliente.
     *   Si se superan, retorna error sin hacer fetch al API.
     */
    async batchUsers(
      input: S2SBatchUsersInput,
    ): Promise<Result<S2SBatchUsersResult>> {
      if (input.ids.length > USERS_BATCH_MAX_IDS) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `batchUsers acepta máximo ${USERS_BATCH_MAX_IDS} IDs por llamada (recibidos: ${input.ids.length})`,
            status: 0,
          },
        }
      }
      return s2sFetch<S2SBatchUsersResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_USER_ROUTES.batch),
        body: input,
      })
    },

    async createWebhookSubscription(
      input: CreateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscriptionWithSecret>> {
      return s2sFetch<WebhookSubscriptionWithSecret>({
        config,
        method: 'POST',
        pathname: apiPath(WEBHOOK_ROUTES.createSubscription),
        body: input,
      })
    },

    async listWebhookSubscriptions(): Promise<
      Result<{ subscriptions: WebhookSubscription[] }>
    > {
      return s2sFetch<{ subscriptions: WebhookSubscription[] }>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.listSubscriptions),
      })
    },

    async getWebhookSubscription(
      id: string,
    ): Promise<Result<WebhookSubscription>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('getWebhookSubscription')
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.getSubscription, { id: segment }),
      })
    },

    async updateWebhookSubscription(
      id: string,
      input: UpdateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscription>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('updateWebhookSubscription')
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'PATCH',
        pathname: apiPath(WEBHOOK_ROUTES.updateSubscription, { id: segment }),
        body: input,
      })
    },

    async deleteWebhookSubscription(id: string): Promise<Result<void>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('deleteWebhookSubscription')
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(WEBHOOK_ROUTES.deleteSubscription, { id: segment }),
      })
    },

    async rotateWebhookSubscriptionSecret(
      id: string,
    ): Promise<Result<RotateWebhookSecretResult>> {
      const segment = encodePathSegment(id)
      if (segment === null)
        return invalidIdResult('rotateWebhookSubscriptionSecret')
      return s2sFetch<RotateWebhookSecretResult>({
        config,
        method: 'POST',
        pathname: apiPath(WEBHOOK_ROUTES.rotateSubscriptionSecret, {
          id: segment,
        }),
      })
    },

    async listWebhookDeliveries(
      query?: ListWebhookDeliveriesQuery,
    ): Promise<Result<{ deliveries: WebhookDelivery[] }>> {
      if (
        query?.limit !== undefined &&
        (query.limit < 1 || query.limit > 100)
      ) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `listWebhookDeliveries: limit debe estar entre 1 y 100 (recibido: ${query.limit})`,
            status: 0,
          },
        }
      }
      if (query?.offset !== undefined && query.offset < 0) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `listWebhookDeliveries: offset no puede ser negativo (recibido: ${query.offset})`,
            status: 0,
          },
        }
      }
      const rawQuery = query
        ? buildQueryString(query as Record<string, string | number | undefined>)
        : ''
      return s2sFetch<{ deliveries: WebhookDelivery[] }>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.listDeliveries),
        rawQuery,
      })
    },

    async createEmpresa(
      input: CreateEmpresaInput,
    ): Promise<Result<EmpresaResult>> {
      return s2sFetch<EmpresaResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.create),
        body: input,
      })
    },

    async getEmpresa(empresaId: string): Promise<Result<EmpresaDetailResult>> {
      const segment = encodePathSegment(empresaId)
      if (segment === null) return invalidIdResult('getEmpresa')
      return s2sFetch<EmpresaDetailResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.get, { id: segment }),
      })
    },

    async addEmpresaMember(
      empresaId: string,
      userId: string,
    ): Promise<Result<EmpresaMemberResult>> {
      const segment = encodePathSegment(empresaId)
      if (segment === null) return invalidIdResult('addEmpresaMember')
      return s2sFetch<EmpresaMemberResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.addMember, { id: segment }),
        body: { userId },
      })
    },

    async removeEmpresaMember(
      empresaId: string,
      userId: string,
    ): Promise<Result<void>> {
      const segment = encodePathSegment(empresaId)
      const userSegment = encodePathSegment(userId)
      if (segment === null || userSegment === null) {
        return invalidIdResult('removeEmpresaMember')
      }
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.removeMember, {
          id: segment,
          userId: userSegment,
        }),
      })
    },

    async createSucursal(
      empresaId: string,
      input: CreateSucursalInput,
    ): Promise<Result<SucursalResult>> {
      const segment = encodePathSegment(empresaId)
      if (segment === null) return invalidIdResult('createSucursal')
      return s2sFetch<SucursalResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.createBranch, {
          id: segment,
        }),
        body: input,
      })
    },
  }
}

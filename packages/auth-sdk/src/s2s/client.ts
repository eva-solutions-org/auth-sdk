/**
 * Cliente S2S (service-to-service) para comunicación autenticada con el Auth Service
 * desde services backend usando firma HMAC-SHA-256 SigV4-style.
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
 *
 * Los paths salen de `INTERNAL_USER_ROUTES` y `WEBHOOK_ROUTES` (contrato compartido) vía `apiPath`.
 */

import {
  INTERNAL_USER_ROUTES,
  USERS_BATCH_MAX_IDS,
  WEBHOOK_ROUTES,
} from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { validateHttpsUrl } from '../config'
import { parseErrorResponse } from '../parse-error-response'
import { encodePathSegment } from '../path-segment'
import type { Result } from '../types'
import { signS2SHeaders } from './sign'
import type {
  S2SClientConfig,
  S2SGetUserResult,
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
} from './types'
import type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from '../webhooks/types'

const encoder = new TextEncoder()

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
 * Realiza un fetch autenticado S2S firmando el request con HMAC-SHA-256.
 * Retorna `Result<T>` con la propiedad `data` del body de respuesta.
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
    const bodyBytes: Uint8Array =
      body !== undefined
        ? encoder.encode(JSON.stringify(body))
        : new Uint8Array(0)

    const url = rawQuery
      ? `${config.baseUrl}${pathname}?${rawQuery}`
      : `${config.baseUrl}${pathname}`

    // Se firma el pathname y el query de la URL FINAL (incluido el prefijo de `baseUrl`,
    // p. ej. `https://host/auth`), que es lo que el verificador lee en `request.url`.
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Crea un cliente S2S autenticado para comunicarse con el Auth Service.
 *
 * @example
 * ```ts
 * const s2s = createS2SClient({
 *   clientId: 'mi-servicio',
 *   secretHex: process.env.EVA_S2S_SECRET,
 *   baseUrl: 'https://auth.miapp.com',
 * })
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
  }
}

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
 */

import { parseErrorResponse } from '../schemas'
import type { Result } from '../types'
import { signS2SRequest } from './sign'
import { USERS_BATCH_MAX_IDS } from './constants'
import type {
  S2SClientConfig,
  S2SCanonicalParts,
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
  createWebhookSubscription(input: CreateWebhookSubscriptionInput): Promise<Result<WebhookSubscriptionWithSecret>>
  listWebhookSubscriptions(): Promise<Result<{ subscriptions: WebhookSubscription[] }>>
  getWebhookSubscription(id: string): Promise<Result<WebhookSubscription>>
  updateWebhookSubscription(id: string, input: UpdateWebhookSubscriptionInput): Promise<Result<WebhookSubscription>>
  deleteWebhookSubscription(id: string): Promise<Result<void>>
  rotateWebhookSubscriptionSecret(id: string): Promise<Result<RotateWebhookSecretResult>>
  listWebhookDeliveries(query?: ListWebhookDeliveriesQuery): Promise<Result<{ deliveries: WebhookDelivery[] }>>
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Construye el query string a partir de un objeto de parámetros.
 * Omite valores undefined.
 */
function buildQueryString(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.join('&')
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
    const timestamp = String(Math.floor(Date.now() / 1000))
    const bodyBytes: Uint8Array =
      body !== undefined ? encoder.encode(JSON.stringify(body)) : new Uint8Array(0)

    const parts: S2SCanonicalParts = {
      method,
      path: pathname,
      rawQuery,
      timestamp,
      clientId: config.clientId,
      bodyBytes,
    }

    const signature = await signS2SRequest({ parts, secretHex: config.secretHex })

    const url = rawQuery
      ? `${config.baseUrl}${pathname}?${rawQuery}`
      : `${config.baseUrl}${pathname}`

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-eva-client-id': config.clientId,
      'x-eva-timestamp': timestamp,
      'x-eva-signature': signature,
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
 * return result.data.user
 * ```
 */
export function createS2SClient(config: S2SClientConfig): S2SClient {
  return {
    async getUser(userId: string): Promise<Result<S2SGetUserResult>> {
      return s2sFetch<S2SGetUserResult>({
        config,
        method: 'GET',
        pathname: `/internal/users/${userId}`,
      })
    },

    /**
     * Consulta múltiples usuarios por ID en una sola llamada.
     *
     * @param input - Input con la lista de IDs a consultar.
     * @param input.ids - Máximo `USERS_BATCH_MAX_IDS` (100) IDs por llamada.
     *   Si se superan, retorna error sin hacer fetch al API.
     */
    async batchUsers(input: S2SBatchUsersInput): Promise<Result<S2SBatchUsersResult>> {
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
        pathname: '/internal/users/batch',
        body: input,
      })
    },

    async createWebhookSubscription(
      input: CreateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscriptionWithSecret>> {
      return s2sFetch<WebhookSubscriptionWithSecret>({
        config,
        method: 'POST',
        pathname: '/internal/webhooks/subscriptions',
        body: input,
      })
    },

    async listWebhookSubscriptions(): Promise<Result<{ subscriptions: WebhookSubscription[] }>> {
      return s2sFetch<{ subscriptions: WebhookSubscription[] }>({
        config,
        method: 'GET',
        pathname: '/internal/webhooks/subscriptions',
      })
    },

    async getWebhookSubscription(id: string): Promise<Result<WebhookSubscription>> {
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'GET',
        pathname: `/internal/webhooks/subscriptions/${id}`,
      })
    },

    async updateWebhookSubscription(
      id: string,
      input: UpdateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscription>> {
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'PATCH',
        pathname: `/internal/webhooks/subscriptions/${id}`,
        body: input,
      })
    },

    async deleteWebhookSubscription(id: string): Promise<Result<void>> {
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: `/internal/webhooks/subscriptions/${id}`,
      })
    },

    async rotateWebhookSubscriptionSecret(id: string): Promise<Result<RotateWebhookSecretResult>> {
      return s2sFetch<RotateWebhookSecretResult>({
        config,
        method: 'POST',
        pathname: `/internal/webhooks/subscriptions/${id}/rotate-secret`,
      })
    },

    async listWebhookDeliveries(
      query?: ListWebhookDeliveriesQuery,
    ): Promise<Result<{ deliveries: WebhookDelivery[] }>> {
      if (query?.limit !== undefined && (query.limit < 1 || query.limit > 100)) {
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
      const rawQuery = query ? buildQueryString(query as Record<string, string | number | undefined>) : ''
      return s2sFetch<{ deliveries: WebhookDelivery[] }>({
        config,
        method: 'GET',
        pathname: '/internal/webhooks/deliveries',
        rawQuery,
      })
    },
  }
}

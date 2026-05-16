import { z } from 'zod'
import type { Result } from '../types'
import type { EvaSdkError } from '../types'
import { SDK_ERROR_REASONS } from '../error-codes'
import { parseErrorResponse } from '../schemas'

const ApiResponseSchema = z.object({
  data: z.unknown().optional(),
})

const FETCH_TIMEOUT = 30_000

const sdkError = (reason: EvaSdkError['reason'], message: string, status: number): EvaSdkError => ({
  kind: 'sdk',
  reason,
  message,
  status,
})

export const authFetch = async <T>(url: string, options?: RequestInit): Promise<Result<T>> => {
  try {
    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT)
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      credentials: 'include',
      signal,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const error = parseErrorResponse(res.status, body)
      return { ok: false, error }
    }

    const json: unknown = await res.json()
    const parsed = ApiResponseSchema.safeParse(json)
    if (!parsed.success) {
      return { ok: false, error: sdkError(SDK_ERROR_REASONS.malformed, 'Estructura de respuesta inválida', 502) }
    }
    return { ok: true, data: parsed.data.data as T }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, error: sdkError(SDK_ERROR_REASONS.network, 'Tiempo de espera agotado', 0) }
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: sdkError(SDK_ERROR_REASONS.network, 'Solicitud cancelada', 0) }
    }
    return { ok: false, error: sdkError(SDK_ERROR_REASONS.network, 'Error de red', 0) }
  }
}

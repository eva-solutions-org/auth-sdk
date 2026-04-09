import { z } from 'zod'
import type { Result } from '../types'

const ApiResponseSchema = z.object({
  data: z.unknown(),
})

const ErrorResponseSchema = z.object({
  error: z.string(),
})

const FETCH_TIMEOUT = 30_000

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
      const body: unknown = await res.json().catch(() => ({}))
      const errorParsed = ErrorResponseSchema.safeParse(body)
      const errorMessage = errorParsed.success ? errorParsed.data.error : res.statusText
      return { ok: false, error: errorMessage, status: res.status }
    }

    const json: unknown = await res.json()
    const parsed = ApiResponseSchema.safeParse(json)
    if (!parsed.success) {
      return { ok: false, error: 'Estructura de respuesta inválida', status: 502 }
    }
    return { ok: true, data: parsed.data.data as T }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, error: 'Tiempo de espera agotado', status: 0 }
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Solicitud cancelada', status: 0 }
    }
    return { ok: false, error: 'Error de red', status: 0 }
  }
}

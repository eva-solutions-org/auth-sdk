import { z } from 'zod'
import type { Result } from '../types'

const ApiResponseSchema = z.object({
  data: z.unknown(),
})

const ErrorResponseSchema = z.object({
  error: z.string(),
})

export const authFetch = async <T>(url: string, options?: RequestInit): Promise<Result<T>> => {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      credentials: 'include',
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
  } catch {
    return { ok: false, error: 'Error de red', status: 0 }
  }
}

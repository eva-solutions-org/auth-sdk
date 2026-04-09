import type { Result } from '../types'

export const authFetch = async <T>(url: string, options?: RequestInit): Promise<Result<T>> => {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      credentials: 'include',
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      return { ok: false, error: (body.error as string) || res.statusText, status: res.status }
    }

    const json = await res.json() as { data: T }
    return { ok: true, data: json.data }
  } catch {
    return { ok: false, error: 'Network error', status: 0 }
  }
}

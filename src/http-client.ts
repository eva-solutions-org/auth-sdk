import { HEADERS, getAuthServiceUrl } from './constants'
import { parseErrorResponse } from './errors'
import type { EvaUser, EvaSession, EvaEmpresa, Result, TokenPair, DeviceInfo } from './types'

type FetchOptions = {
  method?: string
  accessToken?: string
  refreshToken?: string
  body?: unknown
}

const extractTokens = (headers: Headers): TokenPair | undefined => {
  const accessToken = headers.get(HEADERS.NEW_ACCESS_TOKEN)
  const refreshToken = headers.get(HEADERS.NEW_REFRESH_TOKEN)
  if (!accessToken || !refreshToken) return undefined
  return { accessToken, refreshToken }
}

const authFetch = async <T>(path: string, options: FetchOptions = {}): Promise<Result<T & { tokens?: TokenPair }>> => {
  const { method = 'GET', accessToken, refreshToken, body } = options

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (accessToken) headers[HEADERS.AUTHORIZATION] = `Bearer ${accessToken}`
  if (refreshToken) headers[HEADERS.REFRESH_TOKEN] = refreshToken

  try {
    const res = await fetch(`${getAuthServiceUrl()}/${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!res.ok) {
      const err = await parseErrorResponse(res)
      return { ok: false, error: err.error, status: err.status }
    }

    const json = (await res.json()) as { data: T }
    const tokens = extractTokens(res.headers)

    return { ok: true, data: { ...json.data, ...(tokens ? { tokens } : {}) } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    return { ok: false, error: message, status: 0 }
  }
}

const getCode = (params: { phone: string }): Promise<Result<{ message: string }>> =>
  authFetch('login/get-code', { method: 'POST', body: { phone: params.phone } })

const login = (params: { phone: string; code: string } & DeviceInfo): Promise<Result<{ user: { id: string }; tokens: TokenPair }>> => {
  const { phone, code, deviceType, os, browser, userAgent } = params
  return authFetch('login', { method: 'POST', body: { phone, code, deviceType, os, browser, userAgent } })
}

const refresh = (params: { refreshToken: string }): Promise<Result<{ user: { id: string }; tokens: TokenPair }>> =>
  authFetch('login/refresh', { method: 'POST', refreshToken: params.refreshToken })

const logout = (params: { refreshToken: string }): Promise<Result<{ message: string }>> =>
  authFetch('login/logout', { method: 'POST', refreshToken: params.refreshToken })

const getUser = (params: { accessToken: string }): Promise<Result<EvaUser>> =>
  authFetch('user', { accessToken: params.accessToken })

const updateUser = (params: { accessToken: string; data: Record<string, unknown> }): Promise<Result<EvaUser>> =>
  authFetch('user', { method: 'PATCH', accessToken: params.accessToken, body: params.data })

const deleteUser = (params: { accessToken: string }): Promise<Result<{ message: string }>> =>
  authFetch('user', { method: 'DELETE', accessToken: params.accessToken })

const getUserEmpresas = (params: { accessToken: string }): Promise<Result<EvaEmpresa[]>> =>
  authFetch('user/empresas', { accessToken: params.accessToken })

const getSessions = (params: { accessToken: string }): Promise<Result<EvaSession[]>> =>
  authFetch('sessions', { accessToken: params.accessToken })

const deleteSession = (params: { accessToken: string; sessionId: string }): Promise<Result<{ message: string }>> =>
  authFetch(`sessions/${params.sessionId}`, { method: 'DELETE', accessToken: params.accessToken })

const deleteAllSessions = (params: { refreshToken: string }): Promise<Result<{ message: string; count: number }>> =>
  authFetch('sessions', { method: 'DELETE', refreshToken: params.refreshToken })

const health = (): Promise<Result<{ status: string }>> =>
  authFetch('health')

export function createHttpClient() {
  return {
    getCode,
    login,
    refresh,
    logout,
    getUser,
    updateUser,
    deleteUser,
    getUserEmpresas,
    getSessions,
    deleteSession,
    deleteAllSessions,
    health,
  }
}

export type EvaHttpClient = ReturnType<typeof createHttpClient>

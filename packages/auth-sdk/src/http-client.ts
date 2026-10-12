import { z } from 'zod'
import {
  AUTH_ROUTES,
  SESSION_ROUTES,
  USER_ROUTES,
} from '@eva_solutions/auth-contracts'
import { apiPath } from './api-path'
import { isEvaAuthConfigError } from './config'
import { HEADERS, getAuthServiceUrl } from './constants'
import { parseErrorResponse } from './parse-error-response'
import type {
  EvaUser,
  EvaSession,
  EvaEmpresa,
  Result,
  TokenPair,
  DeviceInfo,
} from './types'

const AuthServiceResponseSchema = z.object({
  data: z.unknown(),
})

const AUTH_SERVICE_TIMEOUT = 10_000

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

const authFetch = async <T>(
  path: string,
  options: FetchOptions = {},
): Promise<Result<T & { tokens?: TokenPair }>> => {
  const { method = 'GET', accessToken, refreshToken, body } = options

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (accessToken) headers[HEADERS.AUTHORIZATION] = `Bearer ${accessToken}`
  if (refreshToken) headers[HEADERS.REFRESH_TOKEN] = refreshToken

  try {
    const res = await fetch(`${getAuthServiceUrl()}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(AUTH_SERVICE_TIMEOUT),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      return { ok: false, error: parseErrorResponse(res.status, body) }
    }

    const json: unknown = await res.json()
    const parsed = AuthServiceResponseSchema.safeParse(json)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'malformed',
          message: 'Estructura de respuesta inválida',
          status: 502,
        },
      }
    }
    const data = parsed.data.data as T
    // Un array (`/sessions`, `/user/empresas`) se devuelve intacto: esparcirlo en un objeto lo
    // convertiria en `{ "0": …, "1": … }`. Esos endpoints se piden solo con access token, asi que
    // no hay tokens nuevos que adjuntar.
    if (Array.isArray(data))
      return { ok: true, data: data as T & { tokens?: TokenPair } }

    const tokens = extractTokens(res.headers)

    return { ok: true, data: { ...data, ...(tokens ? { tokens } : {}) } }
  } catch (err) {
    // Falta de configuración (authUrl): error del consumidor, no una falla de red.
    if (isEvaAuthConfigError(err)) throw err
    const message = err instanceof Error ? err.message : 'Error de red'
    return {
      ok: false,
      error: { kind: 'sdk', reason: 'network', message, status: 0 },
    }
  }
}

/**
 * Solicita un código OTP. En éxito devuelve `{ message, challengeId }`:
 * `challengeId` es opaco, el caller debe conservarlo (en memoria) y enviarlo a
 * `login`; cada `getCode` nuevo invalida el `challengeId` anterior.
 * El tipo es un cast: la respuesta del Auth Service no se parsea en runtime.
 */
const getCode = (params: {
  phone: string
}): Promise<Result<{ message: string; challengeId: string }>> =>
  authFetch(apiPath(AUTH_ROUTES.getCode), {
    method: 'POST',
    body: { phone: params.phone },
  })

/**
 * Verifica el código OTP. `challengeId` es obligatorio: debe ser el que
 * devolvió el `getCode` que originó el código; sin el desafío vigente el Auth
 * Service responde 401 sin consumir intentos.
 */
const login = (
  params: { phone: string; code: string; challengeId: string } & DeviceInfo,
): Promise<Result<{ user: { id: string }; tokens?: TokenPair }>> => {
  const { phone, code, challengeId, deviceType, os, browser, userAgent } =
    params
  return authFetch(apiPath(AUTH_ROUTES.login), {
    method: 'POST',
    body: { phone, code, challengeId, deviceType, os, browser, userAgent },
  })
}

const refresh = (params: {
  refreshToken: string
}): Promise<Result<{ user: { id: string }; tokens?: TokenPair }>> =>
  authFetch(apiPath(AUTH_ROUTES.refresh), {
    method: 'POST',
    refreshToken: params.refreshToken,
  })

const logout = (params: {
  refreshToken: string
}): Promise<Result<{ message: string }>> =>
  authFetch(apiPath(AUTH_ROUTES.logout), {
    method: 'POST',
    refreshToken: params.refreshToken,
  })

const getUser = (params: { accessToken: string }): Promise<Result<EvaUser>> =>
  authFetch(apiPath(USER_ROUTES.get), { accessToken: params.accessToken })

const updateUser = (params: {
  accessToken: string
  data: Record<string, unknown>
}): Promise<Result<EvaUser>> =>
  authFetch(apiPath(USER_ROUTES.update), {
    method: 'PATCH',
    accessToken: params.accessToken,
    body: params.data,
  })

const deleteUser = (params: {
  accessToken: string
}): Promise<Result<{ message: string }>> =>
  authFetch(apiPath(USER_ROUTES.deactivate), {
    method: 'DELETE',
    accessToken: params.accessToken,
  })

const getUserEmpresas = (params: {
  accessToken: string
}): Promise<Result<EvaEmpresa[]>> =>
  authFetch(apiPath(USER_ROUTES.listCompanies), {
    accessToken: params.accessToken,
  })

const getSessions = (params: {
  accessToken: string
}): Promise<Result<EvaSession[]>> =>
  authFetch(apiPath(SESSION_ROUTES.list), { accessToken: params.accessToken })

const deleteSession = (params: {
  accessToken: string
  sessionId: string
}): Promise<Result<{ message: string }>> => {
  if (!/^[\w-]+$/.test(params.sessionId)) {
    return Promise.resolve({
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'malformed',
        message: 'ID de sesión inválido',
        status: 400,
      },
    })
  }
  return authFetch(
    apiPath(SESSION_ROUTES.deleteOne, { id: params.sessionId }),
    {
      method: 'DELETE',
      accessToken: params.accessToken,
    },
  )
}

const deleteAllSessions = (params: {
  refreshToken: string
}): Promise<Result<{ message: string; count: number }>> =>
  authFetch(apiPath(SESSION_ROUTES.deleteAll), {
    method: 'DELETE',
    refreshToken: params.refreshToken,
  })

// Every other route is built with `apiPath` (`API_PREFIX + path`); health is an operational probe
// that the API serves at the root, outside the versioned prefix.
const health = (): Promise<Result<{ status: string }>> => authFetch('/health')

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

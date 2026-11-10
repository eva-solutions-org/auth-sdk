import { z } from 'zod'
import {
  AUTH_ROUTES,
  DIRECTORIO_ROUTES,
  SESSION_ROUTES,
  USER_ROUTES,
} from '@eva_solutions/auth-contracts'
import type {
  DirectorioQuery,
  DirectorioResponse,
} from '@eva_solutions/auth-contracts'
import { apiPath } from './api-path'
import { getProduct, isEvaAuthConfigError } from './config'
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
  /** Headers extra; no pisan `content-type`. */
  extraHeaders?: Record<string, string>
  /** La respuesta reemite solo el access token (`x-eva-new-access-token`); el refresh no rota. */
  reissuesAccessTokenOnly?: boolean
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
  const {
    method = 'GET',
    accessToken,
    refreshToken,
    body,
    extraHeaders,
  } = options

  const headers: Record<string, string> = {
    ...extraHeaders,
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
      const error = parseErrorResponse(res.status, body)
      const retryAfter = res.headers?.get('retry-after')?.trim()
      return {
        ok: false,
        error:
          retryAfter !== undefined && /^\d+$/.test(retryAfter)
            ? { ...error, retryAfterSeconds: Number(retryAfter) }
            : error,
      }
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

    if (options.reissuesAccessTokenOnly) {
      const accessToken = res.headers.get(HEADERS.NEW_ACCESS_TOKEN)
      return {
        ok: true,
        data: { ...data, ...(accessToken ? { accessToken } : {}) },
      }
    }

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
const getCode = (
  params: { phone: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ message: string; challengeId: string }>> =>
  authFetch(apiPath(AUTH_ROUTES.getCode), {
    method: 'POST',
    body: { phone: params.phone },
    ...(extraHeaders && { extraHeaders }),
  })

/**
 * Verifica el código OTP. `challengeId` es obligatorio: debe ser el que
 * devolvió el `getCode` que originó el código; sin el desafío vigente el Auth
 * Service responde 401 sin consumir intentos.
 *
 * El `producto` del login sale SIEMPRE de `configureEvaAuth({ product })`, nunca del llamador: el
 * access token queda emitido para ese producto. `empresaId` (opcional) deja esa empresa activa en
 * la sesión si la persona pertenece a ella.
 *
 * @throws Error de configuración (`EvaAuthConfigError`) si falta `configureEvaAuth({ product })`.
 */
const login = (
  params: {
    phone: string
    code: string
    challengeId: string
    empresaId?: string
  } & DeviceInfo,
  extraHeaders?: Record<string, string>,
): Promise<Result<{ user: { id: string }; tokens?: TokenPair }>> => {
  const {
    phone,
    code,
    challengeId,
    empresaId,
    deviceType,
    os,
    browser,
    userAgent,
  } = params
  return authFetch(apiPath(AUTH_ROUTES.login), {
    method: 'POST',
    body: {
      phone,
      code,
      challengeId,
      producto: getProduct(),
      ...(empresaId !== undefined && { empresaId }),
      deviceType,
      os,
      browser,
      userAgent,
    },
    ...(extraHeaders && { extraHeaders }),
  })
}

/**
 * Cambia la empresa activa de la sesión (`null` la deja sin empresa). Auth reemite SOLO el access
 * token (`x-eva-new-access-token`; el refresh no rota): llega en `accessToken`. Auth valida la
 * pertenencia; si la persona no pertenece, responde error.
 */
const setActiveEmpresa = (
  params: { accessToken: string; empresaId: string | null },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ empresaId: string | null; accessToken?: string }>> =>
  authFetch(apiPath(AUTH_ROUTES.setActiveEmpresa), {
    method: 'POST',
    accessToken: params.accessToken,
    body: { empresaId: params.empresaId },
    reissuesAccessTokenOnly: true,
    ...(extraHeaders && { extraHeaders }),
  })

const refresh = (
  params: { refreshToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ user: { id: string }; tokens?: TokenPair }>> =>
  authFetch(apiPath(AUTH_ROUTES.refresh), {
    method: 'POST',
    refreshToken: params.refreshToken,
    ...(extraHeaders && { extraHeaders }),
  })

const logout = (
  params: { refreshToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ message: string }>> =>
  authFetch(apiPath(AUTH_ROUTES.logout), {
    method: 'POST',
    refreshToken: params.refreshToken,
    ...(extraHeaders && { extraHeaders }),
  })

const getUser = (
  params: { accessToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<EvaUser>> =>
  authFetch(apiPath(USER_ROUTES.get), {
    accessToken: params.accessToken,
    ...(extraHeaders && { extraHeaders }),
  })

const updateUser = (
  params: { accessToken: string; data: Record<string, unknown> },
  extraHeaders?: Record<string, string>,
): Promise<Result<EvaUser>> =>
  authFetch(apiPath(USER_ROUTES.update), {
    method: 'PATCH',
    accessToken: params.accessToken,
    body: params.data,
    ...(extraHeaders && { extraHeaders }),
  })

const deleteUser = (
  params: { accessToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ message: string }>> =>
  authFetch(apiPath(USER_ROUTES.deactivate), {
    method: 'DELETE',
    accessToken: params.accessToken,
    ...(extraHeaders && { extraHeaders }),
  })

const getUserEmpresas = (
  params: { accessToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<EvaEmpresa[]>> =>
  authFetch(apiPath(USER_ROUTES.listCompanies), {
    accessToken: params.accessToken,
    ...(extraHeaders && { extraHeaders }),
  })

/**
 * Busca en el directorio de empresas (solo las activas que optaron por aparecer; solo campos de
 * perfil público; 50 por página). Basta el access token de usuario de CUALQUIER producto habilitado:
 * Auth limita los pedidos por usuario. La siguiente página se pide con el `nextCursor` recibido.
 */
const getDirectorio = (
  params: { accessToken: string } & DirectorioQuery,
  extraHeaders?: Record<string, string>,
): Promise<Result<DirectorioResponse['data']>> => {
  const { accessToken, ...filters } = params
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const qs = query.toString()
  return authFetch(
    `${apiPath(DIRECTORIO_ROUTES.search)}${qs === '' ? '' : `?${qs}`}`,
    { accessToken, ...(extraHeaders && { extraHeaders }) },
  )
}

const getSessions = (
  params: { accessToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<EvaSession[]>> =>
  authFetch(apiPath(SESSION_ROUTES.list), {
    accessToken: params.accessToken,
    ...(extraHeaders && { extraHeaders }),
  })

const deleteSession = (
  params: { accessToken: string; sessionId: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ message: string }>> => {
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
      ...(extraHeaders && { extraHeaders }),
    },
  )
}

const deleteAllSessions = (
  params: { refreshToken: string },
  extraHeaders?: Record<string, string>,
): Promise<Result<{ message: string; count: number }>> =>
  authFetch(apiPath(SESSION_ROUTES.deleteAll), {
    method: 'DELETE',
    refreshToken: params.refreshToken,
    ...(extraHeaders && { extraHeaders }),
  })

// Every other route is built with `apiPath` (`API_PREFIX + path`); health is an operational probe
// that the API serves at the root, outside the versioned prefix.
const health = (): Promise<Result<{ status: string }>> => authFetch('/health')

export function createHttpClient() {
  return {
    getCode,
    login,
    setActiveEmpresa,
    refresh,
    logout,
    getUser,
    updateUser,
    deleteUser,
    getUserEmpresas,
    getDirectorio,
    getSessions,
    deleteSession,
    deleteAllSessions,
    health,
  }
}

export type EvaHttpClient = ReturnType<typeof createHttpClient>

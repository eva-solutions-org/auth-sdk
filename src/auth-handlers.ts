/**
 * Factory de handlers de auth — fuente única de verdad para los 11 endpoints.
 * Compartido entre evaAuthRoutes() (Hono plano) y evaAuthOpenAPIRoutes() (OpenAPIHono).
 * Decisión M2: resolución de messages() por-request (closure evalúa global cada vez).
 */
import type { Context } from 'hono'
import { createHttpClient } from './http-client'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from './cookies'
import { deduplicateRefresh } from './refresh-dedup'
import { parseDeviceInfo } from './hono/device-info'
import {
  resolveErrorMessages,
  type EvaErrorMessages,
} from './error-messages'
import { getErrorMessages, getErrorWire, validateErrorMessagesInput } from './config'
import { GetCodeSchema, LoginSchema, UpdateUserSchema } from './schemas'
import type { EvaError, EvaSdkError } from './types'
import type { SdkErrorReason } from './error-codes'

export interface AuthHandlerOptions {
  errorMessages?: Partial<EvaErrorMessages>
}

export interface AuthHandlers {
  getCode: (c: Context) => Promise<Response>
  login: (c: Context) => Promise<Response>
  refresh: (c: Context) => Promise<Response>
  logout: (c: Context) => Promise<Response>
  getMe: (c: Context) => Promise<Response>
  updateMe: (c: Context) => Promise<Response>
  deleteMe: (c: Context) => Promise<Response>
  getEmpresas: (c: Context) => Promise<Response>
  getSessions: (c: Context) => Promise<Response>
  deleteSession: (c: Context) => Promise<Response>
  deleteAllSessions: (c: Context) => Promise<Response>
}

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503

const KNOWN_ERROR_STATUSES = new Set<number>([400, 401, 403, 404, 409, 429, 500, 502, 503])

const REASON_TO_CODE: Record<SdkErrorReason, string> = {
  auth_required: 'unauthorized',
  token_invalid: 'unauthorized',
  refresh_no_tokens: 'unauthorized',
  verify_failed: 'unauthorized',
  network: 'service_unavailable',
  malformed: 'bad_request',
}

function resolveCode(evaError: EvaError): string {
  if (evaError.kind === 'api') return evaError.code
  return REASON_TO_CODE[evaError.reason]
}

function errorResponse(c: Context, evaError: EvaError, status: number): Response {
  const safeStatus = KNOWN_ERROR_STATUSES.has(status) ? (status as ErrorStatus) : 500
  const wire = getErrorWire()
  if (wire === 'api') {
    return c.json({ error: { code: resolveCode(evaError), message: evaError.message } }, safeStatus)
  }
  return c.json({ error: evaError.message }, safeStatus)
}

function sdkError(reason: SdkErrorReason, message: string, status: number): EvaSdkError {
  return { kind: 'sdk', reason, message, status }
}

/**
 * Construye los 11 handlers de auth con las opciones provistas.
 * Validación temprana de errorMessages si se proveen (lanza si key inválida o valor no-string).
 *
 * Decisión M2 (ADR-012): messages() se resuelve por-request (closure evalúa
 * getErrorMessages() en cada llamada). Permite que configureEvaAuth() post-factory
 * tome efecto en el siguiente request. Tradeoff: ~3 spreads + 2 fn calls per request.
 */
export function buildAuthHandlers(opts: AuthHandlerOptions = {}): AuthHandlers {
  if (opts.errorMessages !== undefined) {
    validateErrorMessagesInput(opts.errorMessages)
  }

  const client = createHttpClient()

  // Resolución diferida por-request (M2)
  const messages = () => resolveErrorMessages(opts.errorMessages, getErrorMessages())

  return {
    // POST /get-code
    getCode: async (c: Context): Promise<Response> => {
      let raw: unknown
      try { raw = await c.req.json() } catch {
        return errorResponse(c, sdkError('malformed', messages().invalidJsonBody, 400), 400)
      }
      const parsed = GetCodeSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(c, sdkError('malformed', messages().invalidPhone, 400), 400)
      }
      const result = await client.getCode(parsed.data)
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // POST /login
    login: async (c: Context): Promise<Response> => {
      let raw: unknown
      try { raw = await c.req.json() } catch {
        return errorResponse(c, sdkError('malformed', messages().invalidJsonBody, 400), 400)
      }
      const parsed = LoginSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(c, sdkError('malformed', messages().loginFailed, 400), 400)
      }
      const deviceInfo = parseDeviceInfo(c.req.raw)
      const result = await client.login({ ...parsed.data, ...deviceInfo })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      if (result.data.tokens) {
        const cookieHeaders = setTokenCookies(result.data.tokens)
        for (const cookie of cookieHeaders) {
          c.header('Set-Cookie', cookie, { append: true })
        }
      }
      return c.json({ data: { user: { id: result.data.user.id } } })
    },

    // POST /refresh
    refresh: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { refreshToken } = readTokensFromCookies(cookieHeader)
      if (!refreshToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await deduplicateRefresh(refreshToken, () => client.refresh({ refreshToken }))
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      if (result.data.tokens) {
        const cookieHeaders = setTokenCookies(result.data.tokens)
        for (const cookie of cookieHeaders) {
          c.header('Set-Cookie', cookie, { append: true })
        }
      }
      return c.json({ data: { user: { id: result.data.user.id } } })
    },

    // POST /logout
    logout: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { refreshToken } = readTokensFromCookies(cookieHeader)
      if (!refreshToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.logout({ refreshToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      const clearHeaders = clearTokenCookies()
      for (const cookie of clearHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
      return c.json({ data: result.data })
    },

    // GET /me
    getMe: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.getUser({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // PATCH /me
    updateMe: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      let raw: unknown
      try { raw = await c.req.json() } catch {
        return errorResponse(c, sdkError('malformed', messages().invalidJsonBody, 400), 400)
      }
      const parsed = UpdateUserSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(c, sdkError('malformed', messages().invalidUpdateBody, 400), 400)
      }
      const result = await client.updateUser({ accessToken, data: parsed.data })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /me
    deleteMe: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.deleteUser({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      const clearHeaders = clearTokenCookies()
      for (const cookie of clearHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
      return c.json({ data: result.data })
    },

    // GET /empresas
    getEmpresas: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.getUserEmpresas({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // GET /sessions
    getSessions: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.getSessions({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /sessions/:id
    deleteSession: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const sessionId = c.req.param('id')
      if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
        return errorResponse(c, sdkError('malformed', messages().sessionInvalid, 400), 400)
      }
      const result = await client.deleteSession({ accessToken, sessionId })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /sessions
    deleteAllSessions: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { refreshToken } = readTokensFromCookies(cookieHeader)
      if (!refreshToken) return errorResponse(c, sdkError('auth_required', messages().tokenNotFound, 401), 401)
      const result = await client.deleteAllSessions({ refreshToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      const clearHeaders = clearTokenCookies()
      for (const cookie of clearHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
      return c.json({ data: result.data })
    },
  }
}

/**
 * Factory de handlers de auth — fuente única de verdad para los 12 endpoints.
 * Compartido entre evaAuthRoutes() (Hono plano) y evaAuthOpenAPIRoutes() (OpenAPIHono).
 * Decisión M2: resolución de messages() por-request (closure evalúa global cada vez).
 */
import type { Context, MiddlewareHandler } from 'hono'
import { createHttpClient } from './http-client'
import {
  readTokensFromCookies,
  setTokenCookies,
  setAccessTokenCookie,
  clearTokenCookies,
} from './cookies'
import { deduplicateRefresh } from './refresh-dedup'
import { parseDeviceInfo } from './hono/device-info'
import { resolveErrorMessages, type EvaErrorMessages } from './error-messages'
import {
  getErrorMessages,
  getErrorWire,
  validateErrorMessagesInput,
} from './config'
import {
  ActiveEmpresaSchema,
  GetCodeSchema,
  LoginSchema,
  UpdateUserSchema,
} from './schemas'
import type { EvaError, EvaSdkError } from './types'
import type { SdkErrorReason } from './error-codes'

export interface AuthHandlerOptions {
  errorMessages?: Partial<EvaErrorMessages>
  /**
   * Orígenes extra (`https://app.example.com`, sin path) desde los que se aceptan las mutaciones
   * con cookies, además del propio host de la request. Un `Origin` fuera de esa lista responde 403.
   * Acepta cualquier origen serializado `esquema://host[:puerto]` (también `tauri://localhost`,
   * `capacitor://localhost`) por coincidencia exacta. Lanza al construir si una entrada no lo es
   * (p. ej. `'*'` o `null`).
   */
  allowedOrigins?: readonly string[]
}

/**
 * Guardas para la variante OpenAPI de get-code/login: el validador de
 * @hono/zod-openapi responde el 400 antes que el handler, así que
 * no-store y el wire de error se replican aquí. middleware corre antes del validador
 * (JSON malformado); onInvalid es el hook del validador (body que no cumple el schema).
 */
export interface OpenAPIBodyGuard {
  middleware: MiddlewareHandler
  onInvalid: (result: { success: boolean }, c: Context) => Response | undefined
}

export interface AuthHandlers {
  /** Middleware CSRF: rechaza con 403 las mutaciones cuyo `Origin` no está permitido. */
  originGuard: MiddlewareHandler
  openApiGuards: { getCode: OpenAPIBodyGuard; login: OpenAPIBodyGuard }
  getCode: (c: Context) => Promise<Response>
  login: (c: Context) => Promise<Response>
  refresh: (c: Context) => Promise<Response>
  logout: (c: Context) => Promise<Response>
  getMe: (c: Context) => Promise<Response>
  updateMe: (c: Context) => Promise<Response>
  deleteMe: (c: Context) => Promise<Response>
  getEmpresas: (c: Context) => Promise<Response>
  setActiveEmpresa: (c: Context) => Promise<Response>
  getSessions: (c: Context) => Promise<Response>
  deleteSession: (c: Context) => Promise<Response>
  deleteAllSessions: (c: Context) => Promise<Response>
}

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503

const KNOWN_ERROR_STATUSES = new Set<number>([
  400, 401, 403, 404, 409, 429, 500, 502, 503,
])

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

function errorResponse(
  c: Context,
  evaError: EvaError,
  status: number,
): Response {
  const safeStatus = KNOWN_ERROR_STATUSES.has(status)
    ? (status as ErrorStatus)
    : 500
  const wire = getErrorWire()
  if (wire === 'api') {
    return c.json(
      { error: { code: resolveCode(evaError), message: evaError.message } },
      safeStatus,
    )
  }
  return c.json({ error: evaError.message }, safeStatus)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Origen serializado de un esquema que no es http(s) (`tauri://localhost`, `capacitor://localhost`):
 * `esquema://host[:puerto]` sin userinfo, path, query ni fragmento (una `/` final se tolera).
 */
const CUSTOM_SCHEME_ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([^\s/?#@\\]+)\/?$/i

/**
 * `new URL(...).origin` de un esquema no especial es `"null"`, así que http(s) se normaliza con el
 * parser y el resto se compara por su forma serializada en minúsculas (la que manda el navegador).
 */
function normalizeAllowedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>()
  for (const entry of origins) {
    let url: URL | undefined
    try {
      url = new URL(entry)
    } catch {
      // cae al throw de abajo
    }
    const custom =
      url !== undefined && !/^https?:$/.test(url.protocol)
        ? CUSTOM_SCHEME_ORIGIN.exec(entry)
        : null
    if (
      url === undefined ||
      (custom === null && !/^https?:$/.test(url.protocol))
    ) {
      throw new Error(
        `[eva-auth-sdk] allowedOrigins inválido: ${JSON.stringify(entry)} (se espera un origen serializado esquema://host[:puerto], p. ej. https://app.example.com o tauri://localhost)`,
      )
    }
    normalized.add(
      custom === null
        ? url.origin
        : `${(custom[1] as string).toLowerCase()}://${(custom[2] as string).toLowerCase()}`,
    )
  }
  return normalized
}

/**
 * Mismo origen = mismo host:puerto que la request; el esquema no cuenta porque tras un proxy que
 * termina TLS el servidor ve `http://` mientras el navegador manda `https://`.
 */
function isOriginAllowed(
  origin: string,
  requestUrl: string,
  allowed: ReadonlySet<string>,
): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false // `Origin: null` (iframes sandbox, redirects entre orígenes) y basura
  }
  return (
    allowed.has(parsed.origin) ||
    allowed.has(origin.toLowerCase()) ||
    parsed.host === new URL(requestUrl).host
  )
}

function sdkError(
  reason: SdkErrorReason,
  message: string,
  status: number,
): EvaSdkError {
  return { kind: 'sdk', reason, message, status }
}

/**
 * Construye los 12 handlers de auth con las opciones provistas.
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

  const allowedOrigins = normalizeAllowedOrigins(opts.allowedOrigins ?? [])

  const client = createHttpClient()

  // Resolución diferida por-request (M2)
  const messages = () =>
    resolveErrorMessages(opts.errorMessages, getErrorMessages())

  const bodyGuard = (invalidMessage: () => string): OpenAPIBodyGuard => ({
    middleware: async (c, next) => {
      c.header('Cache-Control', 'no-store')
      try {
        await c.req.json()
      } catch {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidJsonBody, 400),
          400,
        )
      }
      await next()
    },
    onInvalid: (result, c) => {
      if (result.success) return undefined
      c.header('Cache-Control', 'no-store')
      return errorResponse(c, sdkError('malformed', invalidMessage(), 400), 400)
    },
  })

  // Sin `Origin` (curl, servidores) se deja pasar: todo navegador lo manda en las mutaciones.
  const originGuard: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header('origin')
    if (
      SAFE_METHODS.has(c.req.method) ||
      origin === undefined ||
      isOriginAllowed(origin, c.req.url, allowedOrigins)
    ) {
      return next()
    }
    return errorResponse(
      c,
      {
        kind: 'api',
        code: 'forbidden',
        message: messages().originNotAllowed,
        status: 403,
      },
      403,
    )
  }

  return {
    originGuard,
    openApiGuards: {
      getCode: bodyGuard(() => messages().invalidPhone),
      login: bodyGuard(() => messages().loginFailed),
    },
    // POST /get-code
    getCode: async (c: Context): Promise<Response> => {
      // Respuestas con challengeId/cookies: nunca cacheables (paridad con el API).
      c.header('Cache-Control', 'no-store')
      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidJsonBody, 400),
          400,
        )
      }
      const parsed = GetCodeSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidPhone, 400),
          400,
        )
      }
      const result = await client.getCode(parsed.data)
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // POST /login
    login: async (c: Context): Promise<Response> => {
      // Respuestas con challengeId/cookies: nunca cacheables (paridad con el API).
      c.header('Cache-Control', 'no-store')
      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidJsonBody, 400),
          400,
        )
      }
      const parsed = LoginSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(
          c,
          sdkError('malformed', messages().loginFailed, 400),
          400,
        )
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
      if (!refreshToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      const result = await deduplicateRefresh(refreshToken, () =>
        client.refresh({ refreshToken }),
      )
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
      if (!refreshToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
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
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      const result = await client.getUser({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // PATCH /me
    updateMe: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidJsonBody, 400),
          400,
        )
      }
      const parsed = UpdateUserSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidUpdateBody, 400),
          400,
        )
      }
      const result = await client.updateUser({ accessToken, data: parsed.data })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /me
    deleteMe: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
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
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      const result = await client.getUserEmpresas({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // POST /empresa-activa
    setActiveEmpresa: async (c: Context): Promise<Response> => {
      // Lleva un access token nuevo en una cookie: nunca cacheable.
      c.header('Cache-Control', 'no-store')
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      let raw: unknown
      try {
        raw = await c.req.json()
      } catch {
        return errorResponse(
          c,
          sdkError('malformed', messages().invalidJsonBody, 400),
          400,
        )
      }
      const parsed = ActiveEmpresaSchema.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(
          c,
          sdkError(
            'malformed',
            'empresaId inválido: debe ser el id de una empresa o null',
            400,
          ),
          400,
        )
      }
      const result = await client.setActiveEmpresa({
        accessToken,
        empresaId: parsed.data.empresaId,
      })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      // Auth reemite SOLO el access token; sin él la sesión seguiría con la empresa vieja y no hay
      // nada que reescribir: es una respuesta inválida de Auth, no un éxito.
      if (!result.data.accessToken) {
        return errorResponse(
          c,
          sdkError(
            'malformed',
            'Respuesta de Auth sin access token reemitido',
            502,
          ),
          502,
        )
      }
      c.header('Set-Cookie', setAccessTokenCookie(result.data.accessToken), {
        append: true,
      })
      return c.json({ data: { empresaId: result.data.empresaId } })
    },

    // GET /sessions
    getSessions: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      const result = await client.getSessions({ accessToken })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /sessions/:id
    deleteSession: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { accessToken } = readTokensFromCookies(cookieHeader)
      if (!accessToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
      const sessionId = c.req.param('id')
      if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
        return errorResponse(
          c,
          sdkError('malformed', messages().sessionInvalid, 400),
          400,
        )
      }
      const result = await client.deleteSession({ accessToken, sessionId })
      if (!result.ok) return errorResponse(c, result.error, result.error.status)
      return c.json({ data: result.data })
    },

    // DELETE /sessions
    deleteAllSessions: async (c: Context): Promise<Response> => {
      const cookieHeader = c.req.header('cookie') || null
      const { refreshToken } = readTokensFromCookies(cookieHeader)
      if (!refreshToken)
        return errorResponse(
          c,
          sdkError('auth_required', messages().tokenNotFound, 401),
          401,
        )
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

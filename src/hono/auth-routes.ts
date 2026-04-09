import { Hono } from 'hono'
import { z } from 'zod'
import { createHttpClient } from '../http-client'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../cookies'
import { deduplicateRefresh } from '../refresh-dedup'
import { parseDeviceInfo } from './device-info'

const GetCodeSchema = z.object({
  phone: z.string().min(1),
})

const LoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
})

const UpdateUserSchema = z.record(z.string(), z.unknown()).refine(
  obj => Object.keys(obj).length > 0,
  'Cuerpo de actualización vacío',
)

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503

const KNOWN_ERROR_STATUSES = new Set<number>([400, 401, 403, 404, 409, 429, 500, 502, 503])

const errorResponse = (c: { json: (data: unknown, status: ErrorStatus) => Response }, error: string, status: number) => {
  const safeStatus = KNOWN_ERROR_STATUSES.has(status) ? (status as ErrorStatus) : 500
  return c.json({ error }, safeStatus)
}

const client = createHttpClient()

export function evaAuthRoutes() {
  const app = new Hono()

  // POST /get-code
  app.post('/get-code', async (c) => {
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return errorResponse(c, 'JSON inválido en el body', 400)
    }
    const parsed = GetCodeSchema.safeParse(raw)
    if (!parsed.success) {
      return errorResponse(c, 'Teléfono inválido', 400)
    }
    const result = await client.getCode(parsed.data)
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // POST /login — agrega device info server-side
  app.post('/login', async (c) => {
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return errorResponse(c, 'JSON inválido en el body', 400)
    }
    const parsed = LoginSchema.safeParse(raw)
    if (!parsed.success) {
      return errorResponse(c, 'Teléfono o código inválido', 400)
    }
    const deviceInfo = parseDeviceInfo(c.req.raw)
    const result = await client.login({ ...parsed.data, ...deviceInfo })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    if (result.data.tokens) {
      const cookieHeaders = setTokenCookies(result.data.tokens)
      for (const cookie of cookieHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
    }
    return c.json({ data: { user: { id: result.data.user.id } } })
  })

  // POST /refresh
  app.post('/refresh', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { refreshToken } = readTokensFromCookies(cookieHeader)
    if (!refreshToken) return errorResponse(c, 'Token de refresco no encontrado', 401)
    const result = await deduplicateRefresh(refreshToken, () => client.refresh({ refreshToken }))
    if (!result.ok) return errorResponse(c, result.error, result.status)
    if (result.data.tokens) {
      const cookieHeaders = setTokenCookies(result.data.tokens)
      for (const cookie of cookieHeaders) {
        c.header('Set-Cookie', cookie, { append: true })
      }
    }
    return c.json({ data: { user: { id: result.data.user.id } } })
  })

  // POST /logout
  app.post('/logout', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { refreshToken } = readTokensFromCookies(cookieHeader)
    if (!refreshToken) return errorResponse(c, 'Token de refresco no encontrado', 401)
    const result = await client.logout({ refreshToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    return c.json({ data: result.data })
  })

  // GET /me
  app.get('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    const result = await client.getUser({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // PATCH /me
  app.patch('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return errorResponse(c, 'JSON inválido en el body', 400)
    }
    const parsed = UpdateUserSchema.safeParse(raw)
    if (!parsed.success) {
      return errorResponse(c, 'Cuerpo de solicitud inválido', 400)
    }
    const result = await client.updateUser({ accessToken, data: parsed.data })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /me
  app.delete('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    const result = await client.deleteUser({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    return c.json({ data: result.data })
  })

  // GET /empresas
  app.get('/empresas', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    const result = await client.getUserEmpresas({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // GET /sessions
  app.get('/sessions', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    const result = await client.getSessions({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /sessions/:id
  app.delete('/sessions/:id', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'Token de acceso no encontrado', 401)
    const sessionId = c.req.param('id')
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
      return errorResponse(c, 'ID de sesión inválido', 400)
    }
    const result = await client.deleteSession({ accessToken, sessionId })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /sessions — cierra todas las sesiones
  app.delete('/sessions', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { refreshToken } = readTokensFromCookies(cookieHeader)
    if (!refreshToken) return errorResponse(c, 'Token de refresco no encontrado', 401)
    const result = await client.deleteAllSessions({ refreshToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    return c.json({ data: result.data })
  })

  return app
}

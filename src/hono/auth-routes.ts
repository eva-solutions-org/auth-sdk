import { Hono } from 'hono'
import { createHttpClient } from '../http-client'
import { readTokensFromCookies, setTokenCookies, clearTokenCookies } from '../cookies'
import { parseDeviceInfo } from './device-info'

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503

const errorResponse = (c: { json: (data: unknown, status: ErrorStatus) => Response }, error: string, status: number) =>
  c.json({ error }, status as ErrorStatus)

export function evaAuthRoutes() {
  const app = new Hono()
  const client = createHttpClient()

  // POST /get-code
  app.post('/get-code', async (c) => {
    const body = await c.req.json<{ phone: string }>()
    const result = await client.getCode(body)
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // POST /login — agrega device info server-side
  app.post('/login', async (c) => {
    const body = await c.req.json<{ phone: string; code: string }>()
    const deviceInfo = parseDeviceInfo(c.req.raw)
    const result = await client.login({ ...body, ...deviceInfo })
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
    if (!refreshToken) return errorResponse(c, 'No refresh token', 401)
    const result = await client.refresh({ refreshToken })
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
    if (!refreshToken) return errorResponse(c, 'No refresh token', 401)
    const result = await client.logout({ refreshToken })
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // GET /me
  app.get('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const result = await client.getUser({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // PATCH /me
  app.patch('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const data = await c.req.json<Record<string, unknown>>()
    const result = await client.updateUser({ accessToken, data })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /me
  app.delete('/me', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const result = await client.deleteUser({ accessToken })
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // GET /empresas
  app.get('/empresas', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const result = await client.getUserEmpresas({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // GET /sessions
  app.get('/sessions', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const result = await client.getSessions({ accessToken })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /sessions/:id
  app.delete('/sessions/:id', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { accessToken } = readTokensFromCookies(cookieHeader)
    if (!accessToken) return errorResponse(c, 'No access token', 401)
    const sessionId = c.req.param('id')
    const result = await client.deleteSession({ accessToken, sessionId })
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  // DELETE /sessions — cierra todas las sesiones
  app.delete('/sessions', async (c) => {
    const cookieHeader = c.req.header('cookie') || null
    const { refreshToken } = readTokensFromCookies(cookieHeader)
    if (!refreshToken) return errorResponse(c, 'No refresh token', 401)
    const result = await client.deleteAllSessions({ refreshToken })
    const clearHeaders = clearTokenCookies()
    for (const cookie of clearHeaders) {
      c.header('Set-Cookie', cookie, { append: true })
    }
    if (!result.ok) return errorResponse(c, result.error, result.status)
    return c.json({ data: result.data })
  })

  return app
}

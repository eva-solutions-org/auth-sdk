import { Hono } from 'hono'
import { buildAuthHandlers, type AuthHandlerOptions } from '../auth-handlers'

export type EvaAuthRoutesOptions = AuthHandlerOptions

export function evaAuthRoutes(opts: EvaAuthRoutesOptions = {}): Hono {
  const app = new Hono()
  const h = buildAuthHandlers(opts)

  app.post('/get-code', h.getCode)
  app.post('/login', h.login)
  app.post('/refresh', h.refresh)
  app.post('/logout', h.logout)
  app.get('/me', h.getMe)
  app.patch('/me', h.updateMe)
  app.delete('/me', h.deleteMe)
  app.get('/empresas', h.getEmpresas)
  app.get('/sessions', h.getSessions)
  app.delete('/sessions/:id', h.deleteSession)
  app.delete('/sessions', h.deleteAllSessions)

  return app
}

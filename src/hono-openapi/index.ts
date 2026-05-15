/**
 * Variante OpenAPIHono del SDK — entry point `@eva/auth-sdk/hono-openapi`.
 *
 * Decisión B3 (ADR-012): usa `createRoute` + `app.openapi(route, handler)`.
 * `defineOpenAPIRoute` es para el método `openapiRoutes` (array API) — se eligió
 * `createRoute` como API primaria por compatibilidad con el factory pattern.
 * Los handlers del factory son compatibles con `RouteHandler<R>` cuando se castea
 * via `as RouteHandler<typeof route>` (no `as never` — type assertion específica).
 * Decisión B1 (ADR-012): schemas importados desde src/schemas.ts (canónico — T-00 validó).
 * Decisión CE1 (ADR-012): requiere parent OpenAPIHono (no Hono plano) — ver warning.
 *
 * RISK-04 (T-034): ErrorResponseSchema siempre documenta el shape 'api'
 * `{ error: { code: string, message: string } }` independientemente del errorWire
 * configurado en runtime. En wire='sdk' el runtime devuelve el mismo shape — es correcto.
 * El errorWire controla el código de error (EvaApiError vs EvaSdkError), pero el shape
 * del wire HTTP es siempre `{ error: { code, message } }` en ambos casos.
 *
 * @example
 * ```ts
 * import { OpenAPIHono } from '@hono/zod-openapi'
 * import { evaAuthOpenAPIRoutes } from '@eva/auth-sdk/hono-openapi'
 *
 * const app = new OpenAPIHono()  // ← CRÍTICO: OpenAPIHono, no Hono
 * app.route('/auth', evaAuthOpenAPIRoutes())
 * app.doc('/doc', { openapi: '3.1.0', info: { title: 'API', version: '1.0' } })
 * ```
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import type { RouteHandler } from '@hono/zod-openapi'
import { buildAuthHandlers, type AuthHandlerOptions } from '../auth-handlers'
import {
  GetCodeSchema,
  LoginSchema,
  UpdateUserSchema,
  ErrorResponseSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
} from '../schemas'

export type EvaAuthOpenAPIRoutesOptions = AuthHandlerOptions

const tags = ['Auth']

// === Route definitions (createRoute — forma canónica de @hono/zod-openapi) ===

const getCodeRoute = createRoute({
  method: 'post',
  path: '/get-code',
  tags,
  summary: 'Solicitar código de verificación',
  request: {
    body: {
      content: { 'application/json': { schema: GetCodeSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Código enviado al teléfono',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    400: {
      description: 'Teléfono inválido o JSON malformado',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags,
  summary: 'Autenticarse con teléfono y código',
  request: {
    body: {
      content: { 'application/json': { schema: LoginSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Login exitoso — tokens seteados en cookies',
      content: { 'application/json': { schema: LoginResponseSchema } },
    },
    400: {
      description: 'Credenciales inválidas o JSON malformado',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
      description: 'No autorizado',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags,
  summary: 'Renovar access token vía refresh token en cookie',
  responses: {
    200: {
      description: 'Tokens renovados',
      content: { 'application/json': { schema: RefreshResponseSchema } },
    },
    401: {
      description: 'Refresh token ausente o inválido',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags,
  summary: 'Cerrar sesión y limpiar cookies',
  responses: {
    200: {
      description: 'Logout exitoso',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Refresh token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags,
  summary: 'Obtener datos del usuario autenticado',
  responses: {
    200: {
      description: 'Usuario',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags,
  summary: 'Actualizar datos del usuario autenticado',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateUserSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Usuario actualizado',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    400: {
      description: 'Body inválido',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteMeRoute = createRoute({
  method: 'delete',
  path: '/me',
  tags,
  summary: 'Eliminar cuenta del usuario autenticado',
  responses: {
    200: {
      description: 'Cuenta eliminada',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const getEmpresasRoute = createRoute({
  method: 'get',
  path: '/empresas',
  tags,
  summary: 'Listar empresas del usuario autenticado',
  responses: {
    200: {
      description: 'Lista de empresas',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const getSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags,
  summary: 'Listar sesiones activas del usuario',
  responses: {
    200: {
      description: 'Lista de sesiones',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/{id}',
  tags,
  summary: 'Cerrar una sesión específica por ID',
  responses: {
    200: {
      description: 'Sesión cerrada',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    400: {
      description: 'ID de sesión inválido',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    401: {
      description: 'Access token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

const deleteAllSessionsRoute = createRoute({
  method: 'delete',
  path: '/sessions',
  tags,
  summary: 'Cerrar todas las sesiones activas',
  responses: {
    200: {
      description: 'Todas las sesiones cerradas',
      content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
    },
    401: {
      description: 'Refresh token ausente',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
})

// === Factory ===

/**
 * Retorna una instancia `OpenAPIHono` con los 11 endpoints de auth declarados
 * con schemas Zod 4 para generación automática de documentación OpenAPI 3.1.
 *
 * ⚠ IMPORTANTE: montar en un parent `OpenAPIHono` (no `Hono` plano).
 * Si el parent es `new Hono()`, los paths NO aparecerán en el documento `/doc`.
 * Ver honojs/middleware#952 y docs/configuration.md sección "Variante OpenAPI".
 */
export function evaAuthOpenAPIRoutes(opts: EvaAuthOpenAPIRoutesOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono()
  const h = buildAuthHandlers(opts)

  // Los handlers del factory retornan Promise<Response> — compatible en runtime con
  // RouteHandler<R>, pero TS no puede reconciliar el union type RouteConfigToTypedResponse.
  // Se usa double assertion (as unknown as RouteHandler<R>) documentada en ADR-012:
  // es una type assertion específica (no as never — mantiene el tipo target concreto).
  // Justificación: el factory pattern compartido entre variante plana y OpenAPI requiere
  // handlers genéricos; la inference TS no atraviesa el indirection del factory.
  app.openapi(getCodeRoute, h.getCode as unknown as RouteHandler<typeof getCodeRoute>)
  app.openapi(loginRoute, h.login as unknown as RouteHandler<typeof loginRoute>)
  app.openapi(refreshRoute, h.refresh as unknown as RouteHandler<typeof refreshRoute>)
  app.openapi(logoutRoute, h.logout as unknown as RouteHandler<typeof logoutRoute>)
  app.openapi(getMeRoute, h.getMe as unknown as RouteHandler<typeof getMeRoute>)
  app.openapi(updateMeRoute, h.updateMe as unknown as RouteHandler<typeof updateMeRoute>)
  app.openapi(deleteMeRoute, h.deleteMe as unknown as RouteHandler<typeof deleteMeRoute>)
  app.openapi(getEmpresasRoute, h.getEmpresas as unknown as RouteHandler<typeof getEmpresasRoute>)
  app.openapi(getSessionsRoute, h.getSessions as unknown as RouteHandler<typeof getSessionsRoute>)
  app.openapi(deleteSessionRoute, h.deleteSession as unknown as RouteHandler<typeof deleteSessionRoute>)
  app.openapi(deleteAllSessionsRoute, h.deleteAllSessions as unknown as RouteHandler<typeof deleteAllSessionsRoute>)

  return app
}

// Re-exports de conveniencia
export { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi'

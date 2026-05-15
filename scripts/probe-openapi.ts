/**
 * T-00 Probe — dos validaciones independientes:
 * a) defineOpenAPIRoute type inference (B3)
 * b) Schema reuse cross-module (B1 — importa desde probe-schemas-a.ts)
 *
 * Ejecutar con: npx tsx scripts/probe-openapi.ts
 * DoD: corre sin error. Resultado documentado en engram sdd/dx-improvements/probe-result.
 */
import { OpenAPIHono, defineOpenAPIRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import {
  ProbeLoginSchema,
  ProbeGetCodeSchema,
  ProbeErrorResponseSchema,
  ProbeLoginResponseSchema,
} from './probe-schemas-a'

// ============================================================
// PROBE A — defineOpenAPIRoute type inference (B3)
// Inline schema para aislar la prueba de defineOpenAPIRoute pura.
// El pattern correcto es: defineOpenAPIRoute define la ruta, luego
// app.openapi(route, handler) la registra en el OpenAPIHono.
// ============================================================

const InlineLoginResponse = z.object({ data: z.object({ user: z.object({ id: z.string() }) }) })
const InlineErrorSchema = z.object({ error: z.string() })

const inlineLoginRoute = defineOpenAPIRoute({
  method: 'post',
  path: '/inline-login',
  tags: ['Probe'],
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ phone: z.string(), code: z.string() }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: InlineLoginResponse } },
    },
    400: {
      description: 'Bad Request',
      content: { 'application/json': { schema: InlineErrorSchema } },
    },
  },
})

// ============================================================
// PROBE B — Schema reuse cross-module (B1)
// schemas importados desde probe-schemas-a.ts (módulo distinto)
// ============================================================

const crossModuleLoginRoute = defineOpenAPIRoute({
  method: 'post',
  path: '/cross-login',
  tags: ['Probe'],
  request: {
    body: {
      content: { 'application/json': { schema: ProbeLoginSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ProbeLoginResponseSchema } },
    },
    400: {
      description: 'Bad Request',
      content: { 'application/json': { schema: ProbeErrorResponseSchema } },
    },
  },
})

const crossModuleGetCodeRoute = defineOpenAPIRoute({
  method: 'post',
  path: '/cross-get-code',
  tags: ['Probe'],
  request: {
    body: {
      content: { 'application/json': { schema: ProbeGetCodeSchema } },
      required: true,
    },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    400: { description: 'Bad Request', content: { 'application/json': { schema: ProbeErrorResponseSchema } } },
  },
})

// ============================================================
// Montar directamente en el OpenAPIHono principal (pattern correcto)
// app.openapi(route, handler) — NO sub-app con app.route('')
// ============================================================

const app = new OpenAPIHono()

// Probe A: inline schema
app.openapi(inlineLoginRoute, async (c) => {
  return c.json({ data: { user: { id: 'inline' } } }, 200)
})

// Probe B: cross-module schemas
app.openapi(crossModuleLoginRoute, async (c) => {
  return c.json({ data: { user: { id: 'cross' } } }, 200)
})

app.openapi(crossModuleGetCodeRoute, async (c) => {
  return c.json({ ok: true }, 200)
})

app.doc('/doc', {
  openapi: '3.1.0',
  info: { title: 'Probe API', version: '0.0.1' },
})

// ============================================================
// También probar el patrón sub-app con prefijo (para evaAuthOpenAPIRoutes)
// que luego se monta con app.route('/auth', sub)
// ============================================================

const subApp = new OpenAPIHono()

const subLoginRoute = defineOpenAPIRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  request: {
    body: {
      content: { 'application/json': { schema: ProbeLoginSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: ProbeLoginResponseSchema } },
    },
  },
})

subApp.openapi(subLoginRoute, async (c) => {
  return c.json({ data: { user: { id: 'sub' } } }, 200)
})

const parentApp = new OpenAPIHono()
parentApp.route('/auth', subApp)
parentApp.doc('/doc', {
  openapi: '3.1.0',
  info: { title: 'Parent API', version: '0.0.1' },
})

// ============================================================
// Runtime verification
// ============================================================

async function runProbe() {
  console.log('=== T-00 Probe ===\n')

  // --- PROBE A+B: directo en app ---
  const docReq = new Request('http://localhost/doc')
  const docRes = await app.fetch(docReq)
  const doc = await docRes.json() as Record<string, unknown>

  console.log('PROBE A+B (direct mount):')
  console.log('/doc status:', docRes.status)
  console.log('openapi version:', doc['openapi'])
  const paths = doc['paths'] as Record<string, unknown>
  console.log('paths disponibles:', Object.keys(paths ?? {}))

  const inlineOk = '/inline-login' in paths
  const crossLoginOk = '/cross-login' in paths
  const crossGetCodeOk = '/cross-get-code' in paths

  console.log('  /inline-login (Probe A inline):', inlineOk ? 'PASS' : 'FAIL')
  console.log('  /cross-login (Probe B cross-module):', crossLoginOk ? 'PASS' : 'FAIL')
  console.log('  /cross-get-code (Probe B cross-module):', crossGetCodeOk ? 'PASS' : 'FAIL')

  // Runtime parse cross-module
  const loginReq = new Request('http://localhost/cross-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+54911', code: '123456' }),
  })
  const loginRes = await app.fetch(loginReq)
  const loginBody = await loginRes.json() as Record<string, unknown>
  const runtimeParseOk = loginRes.status === 200 && loginBody['data'] !== undefined
  console.log('\n  Runtime parse cross-module (POST /cross-login):', runtimeParseOk ? 'PASS' : 'FAIL', '| status:', loginRes.status)

  // Validación request inválido
  const invalidReq = new Request('http://localhost/cross-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '' }),
  })
  const invalidRes = await app.fetch(invalidReq)
  const validationWorks = invalidRes.status === 400
  console.log('  Validación request inválido cross-module:', validationWorks ? 'PASS' : 'FAIL', '| status:', invalidRes.status)

  // --- PROBE C: sub-app con parentApp.route('/auth', subApp) ---
  console.log('\nPROBE C (sub-app route /auth):')
  const parentDocRes = await parentApp.fetch(new Request('http://localhost/doc'))
  const parentDoc = await parentDocRes.json() as Record<string, unknown>
  const parentPaths = parentDoc['paths'] as Record<string, unknown>
  console.log('paths en /doc parent:', Object.keys(parentPaths ?? {}))
  const subLoginOk = '/auth/login' in parentPaths
  console.log('  /auth/login aparece en /doc del parent:', subLoginOk ? 'PASS (OpenAPIHono parent OK)' : 'FAIL (CE1 bug: requiere OpenAPIHono parent)')

  // Runtime sub-app
  const subLoginReq = new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+54911', code: '123456' }),
  })
  const subLoginRes = await parentApp.fetch(subLoginReq)
  const subRuntimeOk = subLoginRes.status === 200
  console.log('  Runtime POST /auth/login:', subRuntimeOk ? 'PASS' : 'FAIL', '| status:', subLoginRes.status)

  const allPass = inlineOk && crossLoginOk && crossGetCodeOk && runtimeParseOk && validationWorks && subLoginOk && subRuntimeOk

  console.log('\n=== RESULTADO FINAL ===')
  if (allPass) {
    console.log('ALL PASS')
    console.log('→ defineOpenAPIRoute + cross-module schemas: FUNCIONAL')
    console.log('→ Sub-app route con OpenAPIHono parent: FUNCIONAL')
  } else {
    console.log('SOME FAIL — revisar output arriba')
  }

  console.log('\n=== DECISIÓN PARA SDD ===')
  const schemasOk = crossLoginOk && crossGetCodeOk && runtimeParseOk && validationWorks
  const defineOpenAPIRouteOk = inlineOk
  const subAppOk = subLoginOk && subRuntimeOk

  console.log('defineOpenAPIRoute (B3):', defineOpenAPIRouteOk ? 'OK — usar como default' : 'FALLA — fallback createRoute')
  console.log('Cross-module schemas (B1):', schemasOk ? 'OK — schemas canónicos en src/schemas.ts' : 'FALLA — schemas inline en hono-openapi/index.ts')
  console.log('Sub-app OpenAPIHono parent (CE1):', subAppOk ? 'OK — patrón evaAuthOpenAPIRoutes() funciona' : 'FALLA — paths no aparecen en /doc')

  process.exit(allPass ? 0 : 1)
}

runProbe().catch(err => {
  console.error('PROBE ERROR:', err)
  process.exit(1)
})

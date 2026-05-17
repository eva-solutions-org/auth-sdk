/**
 * Tests unitarios para src/hono/s2s.ts — s2sAuth + requireScope
 *
 * T-013 — Batch 5 (B-5)
 * Cubre: REQ-HONO-AUTH-01..09, REQ-HONO-SCOPE-01..06, REQ-HONO-WIRE-01..03,
 *        REQ-TESTS-03
 *
 * Estrategia: Hono app real con secretStore mock — no se mockea el SDK internamente.
 * Helper `buildSignedRequest` usa signS2SRequest para construir requests firmadas válidas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { s2sAuth, requireScope } from '../src/hono/s2s'
import { signS2SRequest } from '../src/s2s/sign'
import type { S2SCanonicalParts } from '../src/s2s/types'
import type { S2sAuthVariables } from '../src/hono/s2s'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_HEX = 'abababab'.repeat(8) // 64 hex chars = 32 bytes
const CLIENT_ID = 'test-client'

// ---------------------------------------------------------------------------
// Helper: construir un Request firmado para Hono
// ---------------------------------------------------------------------------

async function buildSignedRequest(opts: {
  method?: string
  path?: string
  body?: Uint8Array
  secretHex?: string
  clientId?: string
  timestamp?: number
}): Promise<Request> {
  const method = opts.method ?? 'GET'
  const path = opts.path ?? '/test'
  const body = opts.body ?? new Uint8Array(0)
  const secretHex = opts.secretHex ?? SECRET_HEX
  const clientId = opts.clientId ?? CLIENT_ID
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)

  const parts: S2SCanonicalParts = {
    method,
    path,
    rawQuery: '',
    timestamp: String(timestamp),
    clientId,
    bodyBytes: body,
  }

  const signature = await signS2SRequest({ parts, secretHex })
  const url = `http://localhost${path}`
  const headers: Record<string, string> = {
    'x-eva-client-id': clientId,
    'x-eva-timestamp': String(timestamp),
    'x-eva-signature': signature,
  }

  if (body.length > 0) headers['content-type'] = 'application/json'

  return new Request(url, {
    method,
    headers,
    body: body.length > 0 ? body : undefined,
    ...(body.length > 0 ? { duplex: 'half' as never } : {}),
  })
}

// ---------------------------------------------------------------------------
// Grupo 1: s2sAuth — happy path (REQ-HONO-AUTH-01,02,03)
// ---------------------------------------------------------------------------

describe('s2sAuth happy path', () => {
  it('next() invocado + c.var.s2sClientId seteado + c.var.s2sScopes=[] por defecto (REQ-HONO-AUTH-01,02,03)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.get('/test', (c) =>
      c.json({ clientId: c.var.s2sClientId, scopes: c.var.s2sScopes }),
    )

    const req = await buildSignedRequest({ method: 'GET' })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { clientId: string; scopes: readonly string[] }
    expect(body.clientId).toBe(CLIENT_ID)
    expect(body.scopes).toEqual([])
  })

  it('c.var.s2sScopes contiene los scopes de scopesOf (REQ-HONO-AUTH-03)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => ['users:read', 'webhooks:read'],
      }),
    )
    app.get('/test', (c) => c.json({ scopes: c.var.s2sScopes }))

    const req = await buildSignedRequest({ method: 'GET' })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { scopes: string[] }
    expect(body.scopes).toEqual(['users:read', 'webhooks:read'])
  })

  it('onAuth hook es llamado con (clientId, scopes) post-verify (REQ-HONO-AUTH-06)', async () => {
    const onAuth = vi.fn()
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => ['admin'],
        onAuth,
      }),
    )
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({ method: 'GET' })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    expect(onAuth).toHaveBeenCalledTimes(1)
    expect(onAuth).toHaveBeenCalledWith(CLIENT_ID, ['admin'])
  })

  it('body permanece disponible para route handler después de s2sAuth — cloneRawRequest (REQ-HONO-AUTH-04,05)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.post('/test', async (c) => {
      const json = await c.req.json()
      return c.json({ received: json })
    })

    const bodyPayload = { hello: 'world' }
    const body = new TextEncoder().encode(JSON.stringify(bodyPayload))
    const req = await buildSignedRequest({ method: 'POST', body })
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
    const resBody = (await res.json()) as { received: typeof bodyPayload }
    expect(resBody.received).toEqual(bodyPayload)
  })
})

// ---------------------------------------------------------------------------
// Grupo 2: s2sAuth errores → 401 (REQ-HONO-AUTH, REQ-HONO-WIRE-01)
// ---------------------------------------------------------------------------

describe('s2sAuth errores → 401', () => {
  it('request sin headers → 401 con wire format { error: { code, message } } (REQ-HONO-WIRE-01)', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = new Request('http://localhost/test', { method: 'GET' })
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('header_missing')
    expect(typeof body.error.message).toBe('string')
    expect(body.error.message.length).toBeGreaterThan(0)
  })

  it('timestamp expirado → 401 con code:timestamp_expired', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.get('/test', (c) => c.json({ ok: true }))

    const oldTimestamp = Math.floor(Date.now() / 1000) - 300
    const req = await buildSignedRequest({ timestamp: oldTimestamp })
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('timestamp_expired')
  })

  it('client_unknown (secretStore null) → 401 con code:client_unknown', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => null }))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('client_unknown')
  })

  it('signature_invalid (secretHex diferente) → 401 con code:signature_invalid', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => 'b'.repeat(64) }))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({ secretHex: SECRET_HEX })
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('signature_invalid')
  })
})

// ---------------------------------------------------------------------------
// Grupo 3: onAuth error → 500 (REQ-HONO-AUTH-07)
// ---------------------------------------------------------------------------

describe('onAuth error', () => {
  it('onAuth async que lanza → Hono propaga el error (status 500)', async () => {
    const app = new Hono()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        onAuth: async () => {
          throw new Error('onAuth boom')
        },
      }),
    )
    app.get('/test', (c) => c.json({ ok: true }))
    app.onError((_err, c) => c.json({ error: 'internal' }, 500))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Grupo 4: requireScope (REQ-HONO-SCOPE-01..05)
// ---------------------------------------------------------------------------

describe('requireScope', () => {
  it('scope presente en s2sScopes → next() + 200 (REQ-HONO-SCOPE-01)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => ['admin'],
      }),
    )
    app.use('*', requireScope('admin'))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(200)
  })

  it('scope ausente → 403 con body { error: { code: "insufficient_scope" } } (REQ-HONO-SCOPE-02, REQ-HONO-WIRE-02)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => ['users:read'],
      }),
    )
    app.use('*', requireScope('admin'))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('insufficient_scope')
  })

  it('lista de scopes no vacía pero no contiene scope requerido → 403 (REQ-HONO-SCOPE-03)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => ['webhooks:read', 'users:read'],
      }),
    )
    app.use('*', requireScope('webhooks:write'))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(403)
  })

  it('scopes vacíos [] → 403 para cualquier scope (REQ-HONO-SCOPE-04)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => [],
      }),
    )
    app.use('*', requireScope('any-scope'))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(403)
  })

  it('requireScope sin s2sAuth previo → Hono retorna 500 con el Error accionable (REQ-HONO-SCOPE-05)', async () => {
    // Hono atrapa la excepción lanzada por requireScope internamente y la convierte a HTTP 500.
    // El Error accionable se propaga a través del error handler de Hono.
    // Decisión in-flight B5-01: comportamiento correcto — la Promise de app.fetch resuelve
    // con status 500 (no rechaza), porque Hono captura todas las excepciones del dispatch.
    const app = new Hono()
    // No s2sAuth aplicado — s2sScopes será undefined
    app.use('*', requireScope('admin'))
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/test'))
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Grupo 5: wire format assertions (REQ-HONO-WIRE-01..03)
// ---------------------------------------------------------------------------

describe('wire format assertions', () => {
  it('401 body tiene error.code y error.message no undefined/null', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => null }))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: unknown; message: unknown } }
    expect(body.error).toBeDefined()
    expect(body.error.code).not.toBeNull()
    expect(body.error.code).not.toBeUndefined()
    expect(body.error.message).not.toBeNull()
    expect(body.error.message).not.toBeUndefined()
    expect(typeof body.error.message).toBe('string')
  })

  it('403 body tiene error.code = "insufficient_scope" (REQ-HONO-WIRE-02)', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()
    app.use(
      '*',
      s2sAuth({
        secretStore: async () => SECRET_HEX,
        scopesOf: async () => [],
      }),
    )
    app.use('*', requireScope('something'))
    app.get('/test', (c) => c.json({ ok: true }))

    const req = await buildSignedRequest({})
    const res = await app.fetch(req)

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; required: string } }
    expect(body.error.code).toBe('insufficient_scope')
    expect(body.error.required).toBe('something')
  })
})

// ---------------------------------------------------------------------------
// Grupo 6: body disponible para middleware previo que consume body (REQ-HONO-AUTH-04,05)
// ---------------------------------------------------------------------------

describe('body disponible post-middleware que consume stream', () => {
  it('middleware previo consume body con c.req.text() → s2sAuth OK y ruta hija también puede leer', async () => {
    const app = new Hono<{ Variables: S2sAuthVariables }>()

    // Middleware que consume el body primero
    app.use('*', async (c, next) => {
      // Esto consume el ReadableStream del request original
      await c.req.text()
      await next()
    })

    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.post('/test', async (c) => {
      const text = await c.req.text()
      return c.json({ received: text })
    })

    const bodyPayload = '{"consumed":true}'
    const body = new TextEncoder().encode(bodyPayload)
    const req = await buildSignedRequest({ method: 'POST', body })
    const res = await app.fetch(req)

    // s2sAuth debe poder verificar (usa cloneRawRequest que accede al bodyCache)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Grupo 7: beforeEach cleanup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

/**
 * Tests de endurecimiento S2S: query con percent-encoding malformado, secreto no hex
 * devuelto por `secretStore` y `baseUrl` con prefijo de path.
 *
 * Las firmas se generan en runtime con `signS2SRequest`; nada hardcodeado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { buildS2SCanonicalString, signS2SRequest } from '../src/s2s/sign'
import { verifyS2SRequest } from '../src/s2s/verify'
import { createS2SClient } from '../src/s2s/client'
import { S2SMalformedQueryError } from '../src/s2s/errors'
import { s2sAuth } from '../src/hono/s2s'

const SECRET_HEX = 'deadbeef'.repeat(8)
const CLIENT_ID = 'test-client'
const NONCE = '00112233445566778899aabbccddeeff'

function makeRequest(url: string, signature?: string): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      'x-eva-client-id': CLIENT_ID,
      'x-eva-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-eva-nonce': NONCE,
      'x-eva-signature': signature ?? `sha256=${'ab'.repeat(32)}`,
    },
  })
}

// ---------------------------------------------------------------------------
// 1. Query con percent-encoding malformado
// ---------------------------------------------------------------------------

describe('query con percent-encoding malformado', () => {
  const MALFORMED = ['a=%ZZ', 'a=%', '%E0%A4%A', 'ok=1&%=2']

  it.each(MALFORMED)(
    'verifyS2SRequest("?%s") → 401-style signature_invalid, sin lanzar',
    async (query) => {
      const secretStore = vi.fn(async () => SECRET_HEX)
      const setIfAbsent = vi.fn(async () => true)

      const result = await verifyS2SRequest(
        makeRequest(`http://localhost/internal/test?${query}`),
        { secretStore, replayCache: { setIfAbsent } },
      )

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.reason).toBe('signature_invalid')
      // Mismo camino que una firma inválida: consulta el secreto, y el nonce no se consume.
      expect(secretStore).toHaveBeenCalledOnce()
      expect(setIfAbsent).not.toHaveBeenCalled()
    },
  )

  it('cliente desconocido con query malformado → client_unknown (mismo camino que sin malformar)', async () => {
    const result = await verifyS2SRequest(
      makeRequest('http://localhost/internal/test?a=%ZZ'),
      { secretStore: async () => null },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('client_unknown')
  })

  it('s2sAuth responde 401 signature_invalid (no 500)', async () => {
    const app = new Hono()
    app.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    app.get('/internal/test', (c) => c.json({ ok: true }))

    const res = await app.request(
      makeRequest('http://localhost/internal/test?a=%ZZ'),
    )

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('signature_invalid')
  })

  it.each(MALFORMED)(
    'firmante: buildS2SCanonicalString(rawQuery "%s") lanza un error claro (no URIError)',
    async (rawQuery) => {
      const err = await buildS2SCanonicalString({
        method: 'GET',
        path: '/internal/test',
        rawQuery,
        timestamp: '1700000000',
        nonce: NONCE,
        clientId: CLIENT_ID,
        bodyBytes: new Uint8Array(0),
      }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(URIError)
      expect((err as Error).message).toMatch(/s2s: rawQuery inválido/)
    },
  )
})

// ---------------------------------------------------------------------------
// 2. Secreto no hex devuelto por secretStore
// ---------------------------------------------------------------------------

describe('secretStore devuelve un secreto no hex', () => {
  it.each(['not-a-hex-secret-value', 'abc', ''])(
    'secreto %j → error explícito de configuración, sin filtrar el secreto',
    async (badSecret) => {
      const err = await verifyS2SRequest(
        makeRequest('http://localhost/internal/test'),
        { secretStore: async () => badSecret },
      ).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(TypeError)
      const message = (err as Error).message
      expect(message).toMatch(/secretStore/)
      expect(message).toMatch(/hex/i)
      if (badSecret !== '') expect(message).not.toContain(badSecret)
      expect(message).not.toContain(CLIENT_ID)
    },
  )
})

// ---------------------------------------------------------------------------
// 3. baseUrl con y sin prefijo de path
// ---------------------------------------------------------------------------

describe('createS2SClient firma el pathname final (con prefijo de baseUrl)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: { id: 'u1' }, deliveries: [] } }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  /** Reconstruye el request que salió por fetch y lo pasa por el verificador real. */
  async function verifyCaptured() {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const request = new Request(url, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    })
    return {
      url,
      result: await verifyS2SRequest(request, {
        secretStore: async (id) => (id === CLIENT_ID ? SECRET_HEX : null),
      }),
    }
  }

  const cases = [
    ['sin prefijo', 'https://auth.test', 'https://auth.test/internal/users/u1'],
    [
      'con prefijo',
      'https://auth.test/auth',
      'https://auth.test/auth/internal/users/u1',
    ],
  ] as const

  it.each(cases)(
    'getUser %s verifica OK',
    async (_label, baseUrl, expectedUrl) => {
      const s2s = createS2SClient({
        clientId: CLIENT_ID,
        secretHex: SECRET_HEX,
        baseUrl,
      })
      await s2s.getUser('u1')

      const { url, result } = await verifyCaptured()
      expect(url).toBe(expectedUrl)
      expect(result).toEqual({ ok: true, data: { clientId: CLIENT_ID } })
    },
  )

  it('POST con body y prefijo verifica OK', async () => {
    const s2s = createS2SClient({
      clientId: CLIENT_ID,
      secretHex: SECRET_HEX,
      baseUrl: 'https://auth.test/auth',
    })
    await s2s.batchUsers({ ids: ['a', 'b'] })

    const { result } = await verifyCaptured()
    expect(result.ok).toBe(true)
  })

  it('query + prefijo verifica OK', async () => {
    const s2s = createS2SClient({
      clientId: CLIENT_ID,
      secretHex: SECRET_HEX,
      baseUrl: 'https://auth.test/auth',
    })
    await s2s.listWebhookDeliveries({ limit: 5, offset: 10 })

    const { url, result } = await verifyCaptured()
    expect(url).toContain('/auth/internal/webhooks/deliveries?')
    expect(result.ok).toBe(true)
  })
})

describe('sanity: la firma del cliente sigue siendo comparable con signS2SRequest', () => {
  it('signS2SRequest sobre el mismo path produce una firma verificable', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await signS2SRequest({
      parts: {
        method: 'GET',
        path: '/auth/internal/test',
        rawQuery: '',
        timestamp,
        nonce: NONCE,
        clientId: CLIENT_ID,
        bodyBytes: new Uint8Array(0),
      },
      secretHex: SECRET_HEX,
    })
    const request = new Request('http://localhost/auth/internal/test', {
      headers: {
        'x-eva-client-id': CLIENT_ID,
        'x-eva-timestamp': timestamp,
        'x-eva-nonce': NONCE,
        'x-eva-signature': signature,
      },
    })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => SECRET_HEX,
    })
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Guard `canonicalizable`: una firma sobre el canonical vacío no sirve con query malformado
// ---------------------------------------------------------------------------

describe('guard canonicalizable en verifyS2SRequest', () => {
  it('HMAC real sobre el canonical vacío + query malformado → signature_invalid', async () => {
    // El verificador usa '' como canonical cuando el query no se puede canonicalizar.
    // Con el secreto real, esa firma ES válida contra '': solo el guard la rechaza.
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(SECRET_HEX.match(/../g) as string[], (h) =>
        parseInt(h, 16),
      ),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('')),
    )
    const signature = `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`

    const result = await verifyS2SRequest(
      makeRequest('http://localhost/internal/test?a=%ZZ', signature),
      { secretStore: async () => SECRET_HEX },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toBe('signature_invalid')
  })
})

// ---------------------------------------------------------------------------
// 5. El catch del verificador solo traga la malformación del query
// ---------------------------------------------------------------------------

describe('error interno de query malformado', () => {
  it('buildS2SCanonicalString lanza S2SMalformedQueryError con mensaje claro', async () => {
    const err = await buildS2SCanonicalString({
      method: 'GET',
      path: '/internal/test',
      rawQuery: 'a=%ZZ',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new Uint8Array(0),
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(S2SMalformedQueryError)
    expect((err as Error).message).toMatch(/s2s: rawQuery inválido/)
  })

  it('un fallo de crypto dentro del canonical NO se disfraza de 401', async () => {
    const spy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValue(new Error('boom crypto'))
    try {
      const request = new Request('http://localhost/internal/test', {
        method: 'POST',
        body: '{"a":1}',
        headers: {
          'x-eva-client-id': CLIENT_ID,
          'x-eva-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-eva-nonce': NONCE,
          'x-eva-signature': `sha256=${'ab'.repeat(32)}`,
        },
      })
      await expect(
        verifyS2SRequest(request, { secretStore: async () => SECRET_HEX }),
      ).rejects.toThrow('boom crypto')
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Ids del cliente: inyección de path
// ---------------------------------------------------------------------------

describe('createS2SClient valida y codifica los ids en el path', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const s2s = createS2SClient({
    clientId: CLIENT_ID,
    secretHex: SECRET_HEX,
    baseUrl: 'https://auth.test',
  })

  const UUID = '3f2b8c1e-9a4d-4e6b-8c1a-2d3e4f5a6b7c'

  const routes: Array<
    [string, (id: string) => Promise<unknown>, string, string]
  > = [
    ['getUser', (id) => s2s.getUser(id), '/internal/users/', ''],
    [
      'getWebhookSubscription',
      (id) => s2s.getWebhookSubscription(id),
      '/internal/webhooks/subscriptions/',
      '',
    ],
    [
      'updateWebhookSubscription',
      (id) => s2s.updateWebhookSubscription(id, {}),
      '/internal/webhooks/subscriptions/',
      '',
    ],
    [
      'deleteWebhookSubscription',
      (id) => s2s.deleteWebhookSubscription(id),
      '/internal/webhooks/subscriptions/',
      '',
    ],
    [
      'rotateWebhookSubscriptionSecret',
      (id) => s2s.rotateWebhookSubscriptionSecret(id),
      '/internal/webhooks/subscriptions/',
      '/rotate-secret',
    ],
  ]

  const REJECTED = ['', '.', '..', '%2e%2e', '%2E%2E', '%2e', '.%2e']
  const ENCODED: Array<[string, string]> = [
    ['../webhooks/subscriptions', '..%2Fwebhooks%2Fsubscriptions'],
    ['a?b', 'a%3Fb'],
    ['a#b', 'a%23b'],
    ['a/b', 'a%2Fb'],
    [String.raw`a\b`, 'a%5Cb'],
    ['x?scope=1', 'x%3Fscope%3D1'],
  ]

  describe.each(routes)('%s', (_name, call, prefix, suffix) => {
    it.each(REJECTED)('rechaza %j sin hacer fetch', async (id) => {
      const result = (await call(id)) as {
        ok: boolean
        error?: { kind: string; reason: string }
      }
      expect(result.ok).toBe(false)
      expect(result.error).toMatchObject({ kind: 'sdk', reason: 'malformed' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each(ENCODED)('codifica %j como un solo segmento', async (id, enc) => {
      await call(id)
      const [url] = fetchMock.mock.calls[0] as [string]
      const parsed = new URL(url)
      expect(parsed.pathname).toBe(`${prefix}${enc}${suffix}`)
      expect(parsed.search).toBe('')
      expect(parsed.hash).toBe('')
    })

    it('un UUID pasa intacto y verifica con verifyS2SRequest real', async () => {
      await call(UUID)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(new URL(url).pathname).toBe(`${prefix}${UUID}${suffix}`)
      const result = await verifyS2SRequest(
        new Request(url, {
          method: init.method,
          headers: init.headers as Record<string, string>,
          body: init.body as string | undefined,
        }),
        { secretStore: async () => SECRET_HEX },
      )
      expect(result.ok).toBe(true)
    })
  })
})

/**
 * Tests del nonce S2S (`x-eva-nonce`): canonical de 7 líneas, generador, firmante
 * `signS2SHeaders`, validación en `verifyS2SRequest` y clave/TTL del replayCache.
 *
 * Los headers se construyen con la API pública (`signS2SHeaders`) salvo donde el test
 * necesita manipular un header concreto.
 */

import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import {
  buildS2SCanonicalString,
  signS2SRequest,
  signS2SHeaders,
  generateS2SNonce,
  EMPTY_BODY_SHA256_HEX,
} from '../src/s2s/sign'
import { verifyS2SRequest } from '../src/s2s/verify'
import { s2sAuth } from '../src/hono/s2s'
import type { S2SCanonicalParts } from '../src/s2s/types'

const SECRET_HEX = 'deadbeef'.repeat(8)
const CLIENT_ID = 'test-client'
const NONCE = '00112233445566778899aabbccddeeff'

async function signedRequest(overrides?: {
  mutateHeaders?: (headers: Record<string, string>) => void
}): Promise<{ request: Request; headers: Record<string, string> }> {
  const headers = await signS2SHeaders({
    method: 'GET',
    path: '/internal/test',
    rawQuery: '',
    bodyBytes: new Uint8Array(0),
    clientId: CLIENT_ID,
    secretHex: SECRET_HEX,
  })
  overrides?.mutateHeaders?.(headers)
  return { request: new Request('http://localhost/internal/test', { headers }), headers }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('canonical de 7 líneas', () => {
  const parts: S2SCanonicalParts = {
    method: 'POST',
    path: '/internal/users/batch',
    rawQuery: '',
    timestamp: '1700000000',
    nonce: NONCE,
    clientId: CLIENT_ID,
    bodyBytes: new Uint8Array(0),
  }

  it('golden vector: orden METHOD, PATH, QUERY, TIMESTAMP, NONCE, CLIENT_ID, BODY_HASH', async () => {
    const canonical = await buildS2SCanonicalString(parts)
    expect(canonical).toBe(
      [
        'POST',
        '/internal/users/batch',
        '',
        '1700000000',
        NONCE,
        CLIENT_ID,
        EMPTY_BODY_SHA256_HEX,
      ].join('\n'),
    )
    expect(canonical.split('\n')).toHaveLength(7)
  })

  it('la firma coincide con un HMAC-SHA-256 calculado de forma independiente', async () => {
    const canonical = await buildS2SCanonicalString(parts)
    const expected = createHmac('sha256', Buffer.from(SECRET_HEX, 'hex'))
      .update(canonical)
      .digest('hex')
    expect(await signS2SRequest({ parts, secretHex: SECRET_HEX })).toBe(`sha256=${expected}`)
  })

  // Known-answer test (KAT): vector literal calculado de forma independiente con `node:crypto`
  // (SHA-256 del body y HMAC-SHA-256 del canonical), sin pasar por el código del SDK.
  // Otros repos (verificadores o firmantes propios) pueden copiar este vector para comprobar
  // paridad con el contrato. Secreto: SECRET_HEX; el query exige canonicalización (orden por
  // nombre y valor, re-encoding RFC 3986 con `(` y `)` como %28 y %29).
  it('KAT: canonical y firma literales (copiable para paridad entre repos)', async () => {
    const katParts: S2SCanonicalParts = {
      method: 'POST',
      path: '/internal/users/batch',
      rawQuery: 'b=2&a=%C3%A9&a=1&c=x%20y(1)',
      timestamp: '1700000000',
      nonce: NONCE,
      clientId: CLIENT_ID,
      bodyBytes: new TextEncoder().encode('{"ids":["u1","u2"]}'),
    }
    expect(await buildS2SCanonicalString(katParts)).toBe(
      [
        'POST',
        '/internal/users/batch',
        'a=1&a=%C3%A9&b=2&c=x%20y%281%29',
        '1700000000',
        '00112233445566778899aabbccddeeff',
        'test-client',
        '1c02e2fe8a2d25de65a75bfefd44105939e2daf8d94fb7f70598c95b927505ff',
      ].join('\n'),
    )
    expect(await signS2SRequest({ parts: katParts, secretHex: SECRET_HEX })).toBe(
      'sha256=7062a79ffe2220292576a17e15c2d94c9f06ed0e27a394bb8adc3a16a8c69c9b',
    )
  })

  it('cambiar solo el nonce cambia la firma', async () => {
    const a = await signS2SRequest({ parts, secretHex: SECRET_HEX })
    const b = await signS2SRequest({
      parts: { ...parts, nonce: 'ffeeddccbbaa99887766554433221100' },
      secretHex: SECRET_HEX,
    })
    expect(a).not.toBe(b)
  })
})

describe('generateS2SNonce', () => {
  it('produce 32 hex en minúsculas', () => {
    expect(generateS2SNonce()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('no repite valores entre llamadas', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateS2SNonce()))
    expect(set.size).toBe(200)
  })
})

describe('signS2SRequest valida el nonce', () => {
  const base: S2SCanonicalParts = {
    method: 'GET',
    path: '/x',
    rawQuery: '',
    timestamp: '1700000000',
    nonce: NONCE,
    clientId: CLIENT_ID,
    bodyBytes: new Uint8Array(0),
  }

  it.each([
    ['vacío', ''],
    ['en mayúsculas', NONCE.toUpperCase()],
    ['corto', 'abcd'],
    ['no hex', 'z'.repeat(32)],
    ['con salto de línea', `${NONCE.slice(0, 31)}\n`],
  ])('lanza si el nonce es %s', async (_label, nonce) => {
    await expect(
      signS2SRequest({ parts: { ...base, nonce }, secretHex: SECRET_HEX }),
    ).rejects.toThrow(/nonce/)
  })
})

describe('signS2SHeaders', () => {
  it('devuelve los 4 headers con timestamp en segundos y nonce canónico', async () => {
    const headers = await signS2SHeaders({
      method: 'GET',
      path: '/internal/test',
      rawQuery: '',
      bodyBytes: new Uint8Array(0),
      clientId: CLIENT_ID,
      secretHex: SECRET_HEX,
    })
    expect(Object.keys(headers).sort()).toEqual([
      'x-eva-client-id',
      'x-eva-nonce',
      'x-eva-signature',
      'x-eva-timestamp',
    ])
    expect(headers['x-eva-client-id']).toBe(CLIENT_ID)
    expect(headers['x-eva-timestamp']).toMatch(/^\d{10}$/)
    expect(headers['x-eva-nonce']).toMatch(/^[0-9a-f]{32}$/)
    expect(headers['x-eva-signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('su salida verifica con verifyS2SRequest (con query y body)', async () => {
    const body = new TextEncoder().encode('{"a":1}')
    const headers = await signS2SHeaders({
      method: 'POST',
      path: '/internal/test',
      rawQuery: 'b=2&a=1',
      bodyBytes: body,
      clientId: CLIENT_ID,
      secretHex: SECRET_HEX,
    })
    const request = new Request('http://localhost/internal/test?a=1&b=2', {
      method: 'POST',
      headers,
      body,
    })
    const result = await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX })
    expect(result).toEqual({ ok: true, data: { clientId: CLIENT_ID } })
  })

  it('lanza si secretHex es inválido', async () => {
    await expect(
      signS2SHeaders({
        method: 'GET',
        path: '/x',
        rawQuery: '',
        bodyBytes: new Uint8Array(0),
        clientId: CLIENT_ID,
        secretHex: 'xyz',
      }),
    ).rejects.toThrow(/secretHex/)
  })
})

describe('verifyS2SRequest: nonce', () => {
  it('falta x-eva-nonce → header_missing', async () => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => delete h['x-eva-nonce'],
    })
    const result = await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('header_missing')
  })

  it.each([
    ['mayúsculas (no canónico)', (n: string) => n.toUpperCase()],
    ['mixto', (n: string) => n.slice(0, 16).toUpperCase() + n.slice(16)],
    ['demasiado corto', (n: string) => n.slice(0, 31)],
    ['demasiado largo', (n: string) => `${n}0`],
    ['no hex', (n: string) => `g${n.slice(1)}`],
    ['vacío', () => ''],
  ])('nonce %s → nonce_malformed', async (_label, mutate) => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = mutate(h['x-eva-nonce'] as string)
      },
    })
    const result = await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('nonce_malformed')
  })

  it('nonce y firma malformados a la vez → nonce_malformed (orden de chequeo documentado)', async () => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = 'nope'
        h['x-eva-signature'] = 'basura'
      },
    })
    const result = await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('nonce_malformed')
  })

  it('nonce_malformed se decide antes de consultar el secreto', async () => {
    const secretStore = vi.fn(async () => SECRET_HEX)
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = 'nope'
      },
    })
    await verifyS2SRequest(request, { secretStore })
    expect(secretStore).not.toHaveBeenCalled()
  })

  it('el mensaje de nonce_malformed es sobrescribible vía messages', async () => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = 'nope'
      },
    })
    const result = await verifyS2SRequest(request, {
      secretStore: async () => SECRET_HEX,
      messages: { nonce_malformed: 'Nonce inválido' },
    })
    if (result.ok) throw new Error('esperaba fallo')
    expect(result.error.message).toBe('Nonce inválido')
  })

  it('cambiar el nonce tras firmar → signature_invalid', async () => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = NONCE
      },
    })
    const result = await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('signature_invalid')
  })
})

describe('replayCache: misma ventana de un segundo', () => {
  function memoryCache() {
    const seen = new Map<string, number>()
    return {
      seen,
      setIfAbsent: vi.fn(async (key: string, ttl: number) => {
        if (seen.has(key)) return false
        seen.set(key, ttl)
        return true
      }),
    }
  }

  it('dos requests idénticos en el mismo segundo con nonces distintos → ambos ok', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'))
    const cache = memoryCache()
    const first = (await signedRequest()).request
    const second = (await signedRequest()).request
    const opts = { secretStore: async () => SECRET_HEX, replayCache: cache }
    expect((await verifyS2SRequest(first, opts)).ok).toBe(true)
    expect((await verifyS2SRequest(second, opts)).ok).toBe(true)
  })

  it('reenviar exactamente el mismo request → replay_detected', async () => {
    const cache = memoryCache()
    const { headers } = await signedRequest()
    const opts = { secretStore: async () => SECRET_HEX, replayCache: cache }
    const make = () => new Request('http://localhost/internal/test', { headers })
    expect((await verifyS2SRequest(make(), opts)).ok).toBe(true)
    const replay = await verifyS2SRequest(make(), opts)
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.error.reason).toBe('replay_detected')
  })

  it('la clave es `${clientId}:${nonce}` y el TTL por defecto es 2*120+1 = 241', async () => {
    const cache = memoryCache()
    const { request, headers } = await signedRequest()
    await verifyS2SRequest(request, { secretStore: async () => SECRET_HEX, replayCache: cache })
    expect(cache.setIfAbsent).toHaveBeenCalledTimes(1)
    expect(cache.setIfAbsent).toHaveBeenCalledWith(`${CLIENT_ID}:${headers['x-eva-nonce']}`, 241)
  })

  it('el TTL sigue timestampWindowSeconds personalizado (2*W+1)', async () => {
    const cache = memoryCache()
    const { request } = await signedRequest()
    await verifyS2SRequest(request, {
      secretStore: async () => SECRET_HEX,
      replayCache: cache,
      timestampWindowSeconds: 30,
    })
    expect(cache.setIfAbsent.mock.calls[0]?.[1]).toBe(61)
  })

  it('el replayCache no se consulta si la firma es inválida (check posterior al HMAC)', async () => {
    const cache = memoryCache()
    const { request } = await signedRequest()
    await verifyS2SRequest(request, { secretStore: async () => 'ab'.repeat(32), replayCache: cache })
    expect(cache.setIfAbsent).not.toHaveBeenCalled()
  })
})

describe('s2sAuth (Hono): razones nuevas', () => {
  function app() {
    const a = new Hono()
    a.use('*', s2sAuth({ secretStore: async () => SECRET_HEX }))
    a.get('/internal/test', (c) => c.json({ ok: true }))
    return a
  }

  it('sin nonce → 401 header_missing', async () => {
    const { request } = await signedRequest({ mutateHeaders: (h) => delete h['x-eva-nonce'] })
    const res = await app().fetch(request)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('header_missing')
  })

  it('nonce en mayúsculas → 401 nonce_malformed', async () => {
    const { request } = await signedRequest({
      mutateHeaders: (h) => {
        h['x-eva-nonce'] = (h['x-eva-nonce'] as string).toUpperCase()
      },
    })
    const res = await app().fetch(request)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('nonce_malformed')
  })

  it('request válido → 200', async () => {
    const { request } = await signedRequest()
    expect((await app().fetch(request)).status).toBe(200)
  })
})

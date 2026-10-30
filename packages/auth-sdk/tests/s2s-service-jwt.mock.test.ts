/**
 * verifyServiceJwt + serviceJwtAuth: JWT de servicio ES256 que el Auth Service envía a otro
 * servicio. Usa jose real con un par de claves ES256 generado por test (sin mocks de jose).
 *
 * Clave de seguridad: un access token de usuario (mismo JWKS, mismo issuer) NUNCA debe pasar.
 */
import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'
import {
  verifyServiceJwt,
  type ServiceJwtVerifyOptions,
} from '../src/s2s/service-jwt'
import { serviceJwtAuth, type ServiceJwtAuthVariables } from '../src/hono/s2s'
import { verifyAccessToken } from '../src/jwt'

vi.mock('../src/config', async (importActual) => ({
  ...(await importActual<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
}))

// verifyAccessToken (contraprueba: un JWT de servicio no es un access token) usa getJwksKeyFn.
const { jwksHolder } = vi.hoisted(() => ({
  jwksHolder: { current: undefined as unknown },
}))
vi.mock('../src/jwks', () => ({
  getJwksKeyFn: () => jwksHolder.current,
}))

const AUDIENCE = 'whatsapp-api'
const SCOPE = 'messages:send'
const BODY = JSON.stringify({ to: '+51999999999', text: 'hola' })

let privateKey: CryptoKey
let otherPrivateKey: CryptoKey
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const pair = await generateKeyPair('ES256')
  privateKey = pair.privateKey
  otherPrivateKey = (await generateKeyPair('ES256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' }
  jwks = createLocalJWKSet({ keys: [jwk] })
  jwksHolder.current = jwks
})

const now = () => Math.floor(Date.now() / 1000)
const sha256b64url = (body: string) =>
  createHash('sha256').update(body).digest('base64url')

type SignInput = {
  header?: Record<string, unknown>
  claims?: JWTPayload
  key?: CryptoKey
  body?: string
}

/** Firma un JWT de servicio válido; cada campo se puede pisar o quitar (`undefined`). */
async function signToken({
  header = {},
  claims = {},
  key,
  body = BODY,
}: SignInput = {}): Promise<string> {
  const iat = now()
  const payload: Record<string, unknown> = {
    iss: 'auth-service',
    aud: AUDIENCE,
    iat,
    exp: iat + 30,
    jti: crypto.randomUUID(),
    scope: SCOPE,
    bsha: sha256b64url(body),
    ...claims,
  }
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k]
  }
  const protectedHeader: Record<string, unknown> = {
    alg: 'ES256',
    typ: 'svc+jwt',
    kid: 'k1',
    ...header,
  }
  for (const k of Object.keys(protectedHeader)) {
    if (protectedHeader[k] === undefined) delete protectedHeader[k]
  }
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader(protectedHeader as { alg: string })
    .sign(key ?? privateKey)
}

const requestWith = (token: string | null, body: string = BODY) =>
  new Request('http://wa.test/v1/internal/messages/send', {
    method: 'POST',
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body,
  })

let seen: Set<string>
const replayCache = {
  setIfAbsent: vi.fn(async (key: string, _ttl: number) => {
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }),
}

const opts = (
  over: Partial<ServiceJwtVerifyOptions> = {},
): ServiceJwtVerifyOptions => ({
  audience: AUDIENCE,
  requiredScope: SCOPE,
  replayCache,
  jwks,
  ...over,
})

beforeEach(() => {
  seen = new Set()
  replayCache.setIfAbsent.mockClear()
})

describe('verifyServiceJwt — token válido', () => {
  it('acepta_un_token_bien_formado_y_devuelve_jti_y_scopes', async () => {
    const token = await signToken({
      claims: { jti: 'jti-1', scope: `other:scope ${SCOPE}` },
    })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result).toEqual({
      ok: true,
      data: { jti: 'jti-1', scopes: ['other:scope', SCOPE] },
    })
  })

  it('registra_el_jti_en_el_replayCache_con_ttl_de_la_vida_restante_mas_tolerancia', async () => {
    const token = await signToken({ claims: { jti: 'jti-ttl' } })

    await verifyServiceJwt(requestWith(token), opts())

    expect(replayCache.setIfAbsent).toHaveBeenCalledTimes(1)
    const [key, ttl] = replayCache.setIfAbsent.mock.calls[0]!
    expect(key).toBe('svcjwt:jti-ttl')
    // exp = iat + 30, tolerancia 5, +1: entre 36 y 36 (reloj entero) con margen de 1 s por redondeo
    expect(ttl).toBeGreaterThanOrEqual(35)
    expect(ttl).toBeLessThanOrEqual(36)
  })

  it('acepta_body_vacio_con_el_hash_de_cero_bytes', async () => {
    const token = await signToken({ body: '' })

    const result = await verifyServiceJwt(
      new Request('http://wa.test/x', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }),
      opts(),
    )

    // SHA-256 de cero bytes en base64url (vector conocido).
    expect(sha256b64url('')).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU')
    expect(result.ok).toBe(true)
  })
})

describe('verifyServiceJwt — un access token de usuario no pasa (clave de seguridad)', () => {
  // Forma real de un access token de usuario del Auth Service: mismo issuer y clave, aud de usuario,
  // sin typ de servicio, con sessionId, sin jti/scope/bsha.
  const userAccessToken = () =>
    signToken({
      header: { typ: undefined },
      claims: {
        aud: 'proyecto-global',
        sub: 'user-1',
        sessionId: 'sess-1',
        jti: undefined,
        scope: undefined,
        bsha: undefined,
      },
    })

  it('rechaza_un_access_token_de_usuario_firmado_por_el_mismo_Auth', async () => {
    const result = await verifyServiceJwt(
      requestWith(await userAccessToken()),
      opts(),
    )

    expect(result).toEqual({
      ok: false,
      error: { reason: 'claims_invalid', message: 'Authentication failed' },
    })
    expect(replayCache.setIfAbsent).not.toHaveBeenCalled()
  })

  it('rechaza_aunque_el_receptor_acepte_por_error_cualquier_audiencia_sin_typ_de_servicio', async () => {
    // aud correcta y scope/jti/bsha presentes, pero sin typ: el typ solo ya lo descarta.
    const token = await signToken({ header: { typ: undefined } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('rechaza_typ_JWT_de_un_access_token', async () => {
    const token = await signToken({ header: { typ: 'JWT' } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('rechaza_typ_de_servicio_con_audiencia_de_usuario', async () => {
    const token = await signToken({ claims: { aud: 'proyecto-global' } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('no_se_puede_configurar_la_audiencia_de_usuario_como_audiencia_del_servicio', async () => {
    const token = await signToken({ claims: { aud: 'proyecto-global' } })

    await expect(
      verifyServiceJwt(
        requestWith(token),
        opts({ audience: 'proyecto-global' }),
      ),
    ).rejects.toThrow(TypeError)
    await expect(
      verifyServiceJwt(requestWith(token), opts({ audience: '' })),
    ).rejects.toThrow(TypeError)
  })

  it('contraprueba_un_JWT_de_servicio_no_es_un_access_token_para_verifyAccessToken', async () => {
    const token = await signToken({ claims: { sub: 'x', sessionId: 'y' } })

    const result = await verifyAccessToken(token)

    expect(result.ok).toBe(false)
  })
})

describe('verifyServiceJwt — rechazos', () => {
  it.each([
    ['sin_authorization', null],
    ['esquema_distinto_de_bearer', 'Basic abc.def.ghi'],
    ['bearer_sin_forma_de_jwt', 'Bearer not-a-jwt'],
  ])('token_missing_%s', async (_name, header) => {
    const request = new Request('http://wa.test/x', {
      method: 'POST',
      headers: header === null ? {} : { Authorization: header },
      body: BODY,
    })

    const result = await verifyServiceJwt(request, opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('token_missing')
  })

  it('token_malformed_con_tres_segmentos_que_no_son_un_jws', async () => {
    const result = await verifyServiceJwt(requestWith('aaa.bbb.ccc'), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('token_malformed')
  })

  it('signature_invalid_con_otra_clave', async () => {
    const token = await signToken({ key: otherPrivateKey })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('signature_invalid')
  })

  it('signature_invalid_con_algoritmo_distinto_de_ES256', async () => {
    const hs = new SignJWT({
      iss: 'auth-service',
      aud: AUDIENCE,
      iat: now(),
      exp: now() + 30,
      jti: 'j',
      scope: SCOPE,
      bsha: sha256b64url(BODY),
    }).setProtectedHeader({ alg: 'HS256', typ: 'svc+jwt', kid: 'k1' })
    const token = await hs.sign(new TextEncoder().encode('x'.repeat(32)))

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('signature_invalid')
  })

  it('signature_invalid_con_una_clave_valida_del_JWKS_de_otro_algoritmo_ES384', async () => {
    const pair = await generateKeyPair('ES384')
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: 'k384',
      alg: 'ES384',
    }
    const token = await signToken({
      header: { alg: 'ES384', kid: 'k384' },
      key: pair.privateKey,
    })

    const result = await verifyServiceJwt(
      requestWith(token),
      opts({ jwks: createLocalJWKSet({ keys: [jwk] }) }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('signature_invalid')
  })

  it('token_expired_pasada_la_tolerancia', async () => {
    const token = await signToken({
      claims: { iat: now() - 100, exp: now() - 50 },
    })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('token_expired')
  })

  it('acepta_un_token_vencido_dentro_de_la_tolerancia_de_reloj', async () => {
    const token = await signToken({
      claims: { iat: now() - 20, exp: now() - 2 },
    })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(true)
  })

  it('claims_invalid_con_otro_issuer', async () => {
    const token = await signToken({ claims: { iss: 'otro-servicio' } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('claims_invalid_con_audiencia_de_otro_servicio', async () => {
    const token = await signToken({ claims: { aud: 'otro-servicio' } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('claims_invalid_sin_exp_o_sin_iat', async () => {
    for (const claims of [{ exp: undefined }, { iat: undefined }]) {
      const token = await signToken({ claims })

      const result = await verifyServiceJwt(requestWith(token), opts())

      expect(result.ok, JSON.stringify(Object.keys(claims))).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
    }
  })

  it('claims_invalid_cuando_la_vida_supera_el_maximo', async () => {
    const token = await signToken({
      claims: { iat: now(), exp: now() + 61 },
    })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it('maxLifetimeSeconds_configurable', async () => {
    const token = await signToken({ claims: { iat: now(), exp: now() + 90 } })

    const strict = await verifyServiceJwt(requestWith(token), opts())
    const relaxed = await verifyServiceJwt(
      requestWith(token),
      opts({ maxLifetimeSeconds: 120 }),
    )

    expect(strict.ok).toBe(false)
    expect(relaxed.ok).toBe(true)
  })

  it('claims_invalid_con_iat_en_el_futuro_mas_alla_de_la_tolerancia', async () => {
    const token = await signToken({
      claims: { iat: now() + 3600, exp: now() + 3630 },
    })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('claims_invalid')
  })

  it.each([
    ['ausente', undefined],
    ['vacio', ''],
    ['no_string', 42],
    ['demasiado_largo', 'j'.repeat(129)],
  ])('jti_missing_cuando_es_%s', async (_name, jti) => {
    const token = await signToken({ claims: { jti: jti as string } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('jti_missing')
    expect(replayCache.setIfAbsent).not.toHaveBeenCalled()
  })

  it.each([
    ['ausente', undefined],
    ['otro_scope', 'messages:read'],
    ['prefijo_del_scope', 'messages:sen'],
    ['no_string', ['messages:send']],
  ])('scope_insufficient_cuando_scope_es_%s', async (_name, scope) => {
    const token = await signToken({ claims: { scope: scope as string } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('scope_insufficient')
  })

  it('body_hash_mismatch_cuando_el_body_fue_alterado', async () => {
    const token = await signToken()

    const result = await verifyServiceJwt(
      requestWith(token, JSON.stringify({ to: '+51000000000', text: 'hola' })),
      opts(),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('body_hash_mismatch')
    expect(replayCache.setIfAbsent).not.toHaveBeenCalled()
  })

  it('body_hash_mismatch_cuando_falta_bsha', async () => {
    const token = await signToken({ claims: { bsha: undefined } })

    const result = await verifyServiceJwt(requestWith(token), opts())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('body_hash_mismatch')
  })

  it('replay_detected_al_reenviar_el_mismo_token', async () => {
    const token = await signToken({ claims: { jti: 'jti-replay' } })

    const first = await verifyServiceJwt(requestWith(token), opts())
    const second = await verifyServiceJwt(requestWith(token), opts())

    expect(first.ok).toBe(true)
    expect(second).toEqual({
      ok: false,
      error: { reason: 'replay_detected', message: 'Token already used' },
    })
  })

  it('messages_permite_sobrescribir_el_texto_del_rechazo', async () => {
    const result = await verifyServiceJwt(
      requestWith(null),
      opts({ messages: { token_missing: 'Falta el token' } }),
    )

    expect(result).toEqual({
      ok: false,
      error: { reason: 'token_missing', message: 'Falta el token' },
    })
  })

  it('un_fallo_del_jwks_no_es_un_rechazo_se_propaga', async () => {
    const token = await signToken()
    const brokenJwks: JWTVerifyGetKey = async () => {
      throw new TypeError('fetch failed')
    }

    await expect(
      verifyServiceJwt(requestWith(token), opts({ jwks: brokenJwks })),
    ).rejects.toThrow('fetch failed')
  })
})

describe('serviceJwtAuth (Hono)', () => {
  const buildApp = (over: Partial<ServiceJwtVerifyOptions> = {}) => {
    const app = new Hono<{ Variables: ServiceJwtAuthVariables }>()
    app.use('/send', serviceJwtAuth(opts(over)))
    app.post('/send', async (c) =>
      c.json({
        jti: c.var.serviceJwtId,
        scopes: c.var.serviceJwtScopes,
        body: await c.req.text(),
      }),
    )
    return app
  }
  const post = (
    app: Hono<{ Variables: ServiceJwtAuthVariables }>,
    token: string | null,
  ) =>
    app.request('http://wa.test/send', {
      method: 'POST',
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
      body: BODY,
    })

  it('token_valido_deja_pasar_y_el_handler_aun_puede_leer_el_body', async () => {
    const token = await signToken({ claims: { jti: 'jti-hono' } })

    const res = await post(buildApp(), token)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      jti: 'jti-hono',
      scopes: [SCOPE],
      body: BODY,
    })
  })

  it('sin_token_responde_401_con_el_motivo', async () => {
    const res = await post(buildApp(), null)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: 'token_missing', message: 'Bearer token is missing' },
    })
  })

  it('access_token_de_usuario_responde_401', async () => {
    const userToken = await signToken({
      header: { typ: undefined },
      claims: {
        aud: 'proyecto-global',
        sub: 'u',
        sessionId: 's',
        scope: undefined,
      },
    })

    const res = await post(buildApp(), userToken)

    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('claims_invalid')
  })

  it('scope_insuficiente_responde_403_insufficient_scope', async () => {
    const token = await signToken({ claims: { scope: 'messages:read' } })

    const res = await post(buildApp(), token)

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('insufficient_scope')
  })

  it('replay_responde_401_replay_detected', async () => {
    const token = await signToken({ claims: { jti: 'jti-hono-replay' } })
    const app = buildApp()

    await post(app, token)
    const res = await post(app, token)

    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('replay_detected')
  })
})

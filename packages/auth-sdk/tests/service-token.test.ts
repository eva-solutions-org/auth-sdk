/**
 * verifyServiceToken + serviceTokenAuth against REAL ES256 tokens and a local JWKS that holds both
 * the user key and the service key, like the real endpoint. The key-type separation (by `kid`
 * prefix) is what keeps a user token from passing as a service token and the other way around.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { verifyServiceToken } from '../src/s2s/service-token'
import {
  requireScope,
  serviceTokenAuth,
  type ServiceTokenAuthVariables,
} from '../src/hono/s2s'
import {
  SERVICE_SUB,
  USER_KID,
  createTestKeys,
  serviceToken,
  userToken,
  type TestKeys,
} from './helpers/tokens'

vi.mock('../src/config', async (importActual) => ({
  ...(await importActual<typeof import('../src/config')>()),
  getAuthUrl: () => 'http://auth.test',
}))

let keys: TestKeys

beforeAll(async () => {
  keys = await createTestKeys()
})

const verify = (
  token: string,
  over: Partial<Parameters<typeof verifyServiceToken>[1]> = {},
) =>
  verifyServiceToken(token, {
    audience: 'whatsapp-api',
    requiredScope: 'messages:send:text',
    jwks: keys.jwks,
    ...over,
  } as Parameters<typeof verifyServiceToken>[1])

const reasonOf = async (promise: ReturnType<typeof verify>) => {
  const result = await promise
  expect(result.ok).toBe(false)
  return result.ok ? undefined : result.error.reason
}

describe('verifyServiceToken: valid token', () => {
  it('returns sub as the identity, client_id as the slug and the scopes', async () => {
    const result = await verify(
      await serviceToken(keys, {
        claims: { scope: 'messages:send:text messages:send:media' },
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        serviceClientId: SERVICE_SUB,
        serviceClientSlug: 'gym-backend',
        scopes: ['messages:send:text', 'messages:send:media'],
      },
    })
  })

  it('accepts_any_of_the_listed_scopes_with_anyScope', async () => {
    const token = await serviceToken(keys)

    const ok = await verifyServiceToken(token, {
      audience: 'whatsapp-api',
      anyScope: ['messages:send:media', 'messages:send:text'],
      jwks: keys.jwks,
    })
    const denied = await verifyServiceToken(token, {
      audience: 'whatsapp-api',
      anyScope: ['messages:send:media', 'admin'],
      jwks: keys.jwks,
    })

    expect(ok.ok).toBe(true)
    expect(denied).toMatchObject({
      ok: false,
      error: { reason: 'scope_insufficient' },
    })
  })
})

describe('verifyServiceToken: user and service keys stay apart', () => {
  it('rejects_a_token_signed_with_the_user_key_under_a_svc_kid', async () => {
    const token = await serviceToken(keys, { key: keys.userKey })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })

  it('rejects_a_token_signed_with_the_service_key_under_a_usr_kid', async () => {
    const token = await serviceToken(keys, { header: { kid: USER_KID } })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })

  it('rejects_a_valid_user_access_token', async () => {
    const token = await userToken(keys, { claims: { aud: 'whatsapp-api' } })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })

  it('rejects_a_service_key_token_with_the_user_typ', async () => {
    const token = await serviceToken(keys, { header: { typ: 'at+jwt' } })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_a_token_without_kid', async () => {
    const token = await serviceToken(keys, { header: { kid: undefined } })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })

  it('rejects_a_token_signed_by_a_stranger_under_the_svc_kid', async () => {
    const token = await serviceToken(keys, { key: keys.strangerKey })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })

  it('rejects_an_unknown_svc_kid', async () => {
    const token = await serviceToken(keys, { header: { kid: 'svc-unknown' } })
    expect(await reasonOf(verify(token))).toBe('signature_invalid')
  })
})

describe('verifyServiceToken: claims', () => {
  it('rejects_a_token_for_another_service_audience', async () => {
    const token = await serviceToken(keys, { claims: { aud: 'auth-api' } })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_a_token_with_several_audiences_even_if_one_matches', async () => {
    const token = await serviceToken(keys, {
      claims: { aud: ['whatsapp-api', 'auth-api'] },
    })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_the_wrong_typ_and_a_missing_typ', async () => {
    expect(
      await reasonOf(
        verify(await serviceToken(keys, { header: { typ: 'JWT' } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await serviceToken(keys, { header: { typ: undefined } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_another_issuer', async () => {
    const token = await serviceToken(keys, { claims: { iss: 'someone' } })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_a_token_without_sub_or_without_client_id', async () => {
    expect(
      await reasonOf(
        verify(await serviceToken(keys, { claims: { sub: undefined } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await serviceToken(keys, { claims: { client_id: undefined } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_a_token_without_exp', async () => {
    const token = await serviceToken(keys, { claims: { exp: undefined } })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_an_expired_token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    const token = await serviceToken(keys, {
      claims: { iat: past - 300, exp: past },
    })
    expect(await reasonOf(verify(token))).toBe('token_expired')
  })

  it('rejects_a_lifetime_longer_than_the_service_token_maximum', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const token = await serviceToken(keys, {
      claims: { iat, exp: iat + 3600 },
    })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('accepts_the_60s_token_Auth_mints_for_the_OTP', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const token = await serviceToken(keys, { claims: { iat, exp: iat + 60 } })
    expect((await verify(token)).ok).toBe(true)
  })

  it('rejects_a_token_that_does_not_cover_the_scope', async () => {
    const token = await serviceToken(keys, {
      claims: { scope: 'messages:send:media' },
    })
    expect(await reasonOf(verify(token))).toBe('scope_insufficient')
  })

  it('rejects_a_malformed_token', async () => {
    expect(await reasonOf(verify('not-a-jwt'))).toBe('token_malformed')
  })
})

describe('verifyServiceToken: misuse is a TypeError, not a rejection', () => {
  const token = 'a.b.c'

  it('throws_for_a_product_slug_as_audience', async () => {
    await expect(
      verify(token, { audience: 'whatsapp-panel' as never }),
    ).rejects.toThrow(TypeError)
  })

  it('throws_unless_exactly_one_of_requiredScope_and_anyScope_is_given', async () => {
    await expect(
      verifyServiceToken(token, {
        audience: 'whatsapp-api',
        jwks: keys.jwks,
      } as never),
    ).rejects.toThrow(TypeError)
    await expect(
      verifyServiceToken(token, {
        audience: 'whatsapp-api',
        requiredScope: 'admin',
        anyScope: ['admin'],
        jwks: keys.jwks,
      } as never),
    ).rejects.toThrow(TypeError)
    await expect(
      verifyServiceToken(token, {
        audience: 'whatsapp-api',
        anyScope: [],
        jwks: keys.jwks,
      }),
    ).rejects.toThrow(TypeError)
  })

  it('throws_for_a_scope_that_is_not_of_the_audience', async () => {
    await expect(
      verify(token, { audience: 'auth-api', requiredScope: 'admin' }),
    ).rejects.toThrow(TypeError)
    await expect(
      verify(token, { requiredScope: 'users:read' }),
    ).rejects.toThrow(TypeError)
  })
})

describe('serviceTokenAuth (Hono)', () => {
  const makeApp = () => {
    const app = new Hono<{ Variables: ServiceTokenAuthVariables }>()
    app.use(
      '*',
      serviceTokenAuth({
        audience: 'whatsapp-api',
        requiredScope: 'messages:send:text',
        jwks: keys.jwks,
      }),
    )
    app.post('/send', (c) =>
      c.json({
        id: c.var.serviceClientId,
        slug: c.var.serviceClientSlug,
        scopes: c.var.serviceScopes,
      }),
    )
    return app
  }
  const call = (bearer?: string) =>
    makeApp().request('/send', {
      method: 'POST',
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      body: '{"to":"x"}',
    })

  it('sets the identity variables and lets the handler read the body', async () => {
    const res = await call(await serviceToken(keys))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: SERVICE_SUB,
      slug: 'gym-backend',
      scopes: ['messages:send:text'],
    })
  })

  it('answers 401 token_missing without a Bearer', async () => {
    const res = await call()

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'token_missing' } })
  })

  it('answers 401 for a user access token', async () => {
    const res = await call(
      await userToken(keys, { claims: { aud: 'whatsapp-api' } }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: { code: 'signature_invalid' },
    })
  })

  it('answers 403 insufficient_scope for a valid token without the scope', async () => {
    const res = await call(
      await serviceToken(keys, { claims: { scope: 'messages:send:media' } }),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'insufficient_scope' },
    })
  })

  it('does not treat an Authorization scheme other than Bearer as a token', async () => {
    const res = await makeApp().request('/send', {
      method: 'POST',
      headers: { authorization: `Basic ${await serviceToken(keys)}` },
    })

    expect(res.status).toBe(401)
  })
})

describe('serviceTokenAuth: Bearer scheme and construction', () => {
  const app = () => {
    const a = new Hono<{ Variables: ServiceTokenAuthVariables }>()
    a.use(
      '*',
      serviceTokenAuth({
        audience: 'whatsapp-api',
        requiredScope: 'messages:send:text',
        jwks: keys.jwks,
      }),
    )
    a.get('/x', (c) => c.json({ ok: true }))
    return a
  }

  it.each(['Bearer', 'bearer', 'BEARER'])(
    'accepts the scheme spelled %s (RFC 9110)',
    async (scheme) => {
      const res = await app().request('/x', {
        headers: { authorization: `${scheme} ${await serviceToken(keys)}` },
      })
      expect(res.status).toBe(200)
    },
  )

  it('validates its options when built, not per request', () => {
    expect(() =>
      serviceTokenAuth({
        audience: 'whatsapp-panel' as never,
        requiredScope: 'x',
      }),
    ).toThrow(TypeError)
    expect(() =>
      serviceTokenAuth({ audience: 'auth-api', requiredScope: 'admin' }),
    ).toThrow(TypeError)
    expect(() =>
      serviceTokenAuth({ audience: 'whatsapp-api' } as never),
    ).toThrow(TypeError)
  })
})

describe('Bearer + per-route requireScope chain', () => {
  const build = () => {
    const a = new Hono<{ Variables: ServiceTokenAuthVariables }>()
    a.use(
      '*',
      serviceTokenAuth({
        audience: 'whatsapp-api',
        scopeCheck: 'deferred',
        jwks: keys.jwks,
      }),
    )
    a.post('/text', requireScope('messages:send:text'), (c) =>
      c.json({ ok: 'text' }),
    )
    a.post('/media', requireScope('messages:send:media'), (c) =>
      c.json({ ok: 'media' }),
    )
    return a
  }
  const post = async (path: string, scope: string) =>
    build().request(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await serviceToken(keys, { claims: { scope } })}`,
      },
    })

  it('lets the route whose permission the token carries through', async () => {
    const res = await post('/text', 'messages:send:text')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: 'text' })
  })

  it('answers 403 insufficient_scope on the route whose permission it lacks', async () => {
    const res = await post('/media', 'messages:send:text')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'insufficient_scope' },
    })
  })

  it('still answers 401 without a valid token', async () => {
    const res = await build().request('/text', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

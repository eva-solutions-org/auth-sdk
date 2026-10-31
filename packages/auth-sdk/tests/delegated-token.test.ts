/**
 * verifyDelegatedToken + delegatedTokenAuth against REAL ES256 tokens and a local JWKS that holds
 * the user key and the service key, like the real endpoint. Three token types share the JWKS (user
 * `at+jwt`/`usr-`, service `svc-at+jwt`/`svc-`, delegated `dlg-at+jwt`/`svc-`): what keeps them
 * apart is `typ` plus the `kid` prefix, and no verifier takes the type of another.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { configureEvaAuth } from '../src/config'
import { verifyAccessToken } from '../src/jwt'
import { verifyDelegatedToken } from '../src/s2s/delegated-token'
import { verifyServiceToken } from '../src/s2s/service-token'
import {
  delegatedTokenAuth,
  type DelegatedTokenAuthVariables,
} from '../src/hono/s2s'
import {
  PRODUCT,
  SERVICE_KID,
  SERVICE_SUB,
  USER_KID,
  createTestKeys,
  delegatedToken,
  serviceToken,
  sign,
  userToken,
  type TestKeys,
} from './helpers/tokens'

const { jwksHolder } = vi.hoisted(() => ({
  jwksHolder: { current: undefined as unknown },
}))
vi.mock('../src/jwks', () => ({
  getJwksKeyFn: () => jwksHolder.current,
}))

let keys: TestKeys

beforeAll(async () => {
  keys = await createTestKeys()
  jwksHolder.current = keys.jwks
  configureEvaAuth({ product: PRODUCT })
})

const verify = (
  token: string,
  over: Partial<Parameters<typeof verifyDelegatedToken>[1]> = {},
) =>
  verifyDelegatedToken(token, {
    audience: 'whatsapp-api',
    requiredScope: 'messages:send:text',
    jwks: keys.jwks,
    ...over,
  } as Parameters<typeof verifyDelegatedToken>[1])

const reasonOf = async (promise: ReturnType<typeof verify>) => {
  const result = await promise
  expect(result.ok).toBe(false)
  return result.ok ? undefined : result.error.reason
}

describe('verifyDelegatedToken: valid token', () => {
  it('returns the user, company, product, session, actor chain and scopes', async () => {
    const result = await verify(await delegatedToken(keys))

    expect(result).toMatchObject({
      ok: true,
      data: {
        userId: 'user-1',
        empresaId: 'emp-1',
        producto: PRODUCT,
        sessionId: 'sess-1',
        clientId: 'ventas-backend',
        scopes: ['messages:send:text'],
        actorChain: [
          { serviceClientId: SERVICE_SUB, serviceClientSlug: 'ventas-backend' },
        ],
      },
    })
  })

  it('lists_the_actors_from_the_last_one_to_the_first', async () => {
    const result = await verify(
      await delegatedToken(keys, {
        claims: {
          client_id: 'c',
          act: {
            sub: 'id-c',
            client_id: 'c',
            act: {
              sub: 'id-b',
              client_id: 'b',
              act: { sub: 'id-a', client_id: 'a' },
            },
          },
        },
      }),
    )

    expect(
      result.ok && result.data.actorChain.map((a) => a.serviceClientSlug),
    ).toEqual(['c', 'b', 'a'])
  })

  it('accepts_anyScope', async () => {
    const token = await delegatedToken(keys)
    expect(
      (
        await verifyDelegatedToken(token, {
          audience: 'whatsapp-api',
          anyScope: ['messages:send:media', 'messages:send:text'],
          jwks: keys.jwks,
        })
      ).ok,
    ).toBe(true)
  })
})

describe('verifyDelegatedToken: claims', () => {
  it('rejects_a_delegated_token_without_company', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { empresa: undefined } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { empresa: '' } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_a_token_without_product_or_without_session', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { producto: undefined } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { sid: undefined } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_an_aud_array_even_if_it_contains_this_service', async () => {
    const token = await delegatedToken(keys, {
      claims: { aud: ['whatsapp-api', 'otra-api'] },
    })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
    const single = await delegatedToken(keys, {
      claims: { aud: ['whatsapp-api'] },
    })
    expect(await reasonOf(verify(single))).toBe('claims_invalid')
  })

  it('rejects_a_token_for_another_audience', async () => {
    const token = await delegatedToken(keys, { claims: { aud: 'auth-api' } })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_a_token_without_actor_or_with_an_incomplete_one', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { act: undefined } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { act: { sub: 'x' } } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { act: 'ventas' } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_an_actor_chain_deeper_than_the_maximum', async () => {
    const deep = {
      sub: 'd',
      client_id: 'd',
      act: {
        sub: 'c',
        client_id: 'c',
        act: { sub: 'b', client_id: 'b', act: { sub: 'a', client_id: 'a' } },
      },
    }
    expect(
      await reasonOf(
        verify(
          await delegatedToken(keys, {
            claims: { client_id: 'd', act: deep },
          }),
        ),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_a_token_without_jti', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { jti: undefined } })),
      ),
    ).toBe('claims_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { jti: '' } })),
      ),
    ).toBe('claims_invalid')
  })

  it('rejects_a_client_id_that_differs_from_the_act_client_id', async () => {
    const token = await delegatedToken(keys, {
      claims: {
        client_id: 'someone-else',
        act: { sub: SERVICE_SUB, client_id: 'ventas-backend' },
      },
    })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_a_lifetime_longer_than_120_seconds', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const token = await delegatedToken(keys, {
      claims: { iat, exp: iat + 300 },
    })
    expect(await reasonOf(verify(token))).toBe('claims_invalid')
  })

  it('rejects_an_expired_token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    const token = await delegatedToken(keys, {
      claims: { iat: past - 120, exp: past },
    })
    expect(await reasonOf(verify(token))).toBe('token_expired')
  })

  it('rejects_a_token_that_does_not_cover_the_scope', async () => {
    const token = await delegatedToken(keys, {
      claims: { scope: 'messages:send:media' },
    })
    expect(await reasonOf(verify(token))).toBe('scope_insufficient')
  })

  it('rejects_another_issuer_and_a_malformed_token', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { claims: { iss: 'someone' } })),
      ),
    ).toBe('claims_invalid')
    expect(await reasonOf(verify('not-a-jwt'))).toBe('token_malformed')
  })
})

describe('verifyDelegatedToken: misuse is a TypeError, not a rejection', () => {
  const token = 'a.b.c'

  it('throws_for_auth_api_as_audience', async () => {
    await expect(
      verify(token, { audience: 'auth-api' as never }),
    ).rejects.toThrow(TypeError)
  })

  it('throws_for_a_product_slug_as_audience', async () => {
    await expect(verify(token, { audience: PRODUCT as never })).rejects.toThrow(
      TypeError,
    )
  })

  it('throws_for_admin_as_the_required_scope', async () => {
    await expect(
      verify(token, { requiredScope: 'admin' as never }),
    ).rejects.toThrow(TypeError)
  })

  it('throws_unless_exactly_one_scope_rule_is_given', async () => {
    await expect(
      verifyDelegatedToken(token, {
        audience: 'whatsapp-api',
        jwks: keys.jwks,
      } as never),
    ).rejects.toThrow(TypeError)
    await expect(
      verifyDelegatedToken(token, {
        audience: 'whatsapp-api',
        anyScope: [],
        jwks: keys.jwks,
      }),
    ).rejects.toThrow(TypeError)
  })
})

/**
 * Every verifier takes exactly one (typ, key type) pair. A token for each verifier is built with
 * claims valid for THAT verifier and only the header `typ` and the `kid`/key vary, so a rejection
 * is attributable to the type separation and not to a missing claim.
 */
describe('the three token types are kept apart by typ and kid', () => {
  const TYPS = ['at+jwt', 'svc-at+jwt', 'dlg-at+jwt'] as const
  const KIDS = [
    { name: 'usr-', kid: USER_KID, key: () => keys.userKey },
    { name: 'svc-', kid: SERVICE_KID, key: () => keys.serviceKey },
  ] as const

  const VERIFIERS = {
    'at+jwt': {
      native: { typ: 'at+jwt', kid: 'usr-' },
      claims: () => ({
        iss: 'auth-service',
        aud: PRODUCT,
        sub: 'user-1',
        sessionId: 'sess-1',
        client_id: PRODUCT,
        empresa: 'emp-1',
      }),
      run: async (token: string) => (await verifyAccessToken(token)).ok,
    },
    'svc-at+jwt': {
      native: { typ: 'svc-at+jwt', kid: 'svc-' },
      claims: () => ({
        iss: 'auth-service',
        aud: 'whatsapp-api',
        sub: SERVICE_SUB,
        client_id: 'gym-backend',
        scope: 'messages:send:text',
      }),
      run: async (token: string) =>
        (
          await verifyServiceToken(token, {
            audience: 'whatsapp-api',
            requiredScope: 'messages:send:text',
            jwks: keys.jwks,
          })
        ).ok,
    },
    'dlg-at+jwt': {
      native: { typ: 'dlg-at+jwt', kid: 'svc-' },
      claims: () => ({
        iss: 'auth-service',
        aud: 'whatsapp-api',
        sub: 'user-1',
        client_id: 'ventas-backend',
        act: { sub: SERVICE_SUB, client_id: 'ventas-backend' },
        empresa: 'emp-1',
        producto: PRODUCT,
        sid: 'sess-1',
        scope: 'messages:send:text',
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
      run: async (token: string) => (await verify(token)).ok,
    },
  } as const

  for (const [verifierTyp, verifier] of Object.entries(VERIFIERS)) {
    describe(`verifier of ${verifierTyp}`, () => {
      for (const typ of TYPS) {
        for (const { name, kid, key } of KIDS) {
          const accepted =
            typ === verifier.native.typ && name === verifier.native.kid
          it(`${accepted ? 'accepts' : 'rejects'} typ ${typ} signed under a ${name} kid`, async () => {
            const token = await sign({
              key: key(),
              header: { typ, kid },
              claims: { ...verifier.claims(), jti: crypto.randomUUID() },
            })

            expect(await verifier.run(token)).toBe(accepted)
          })
        }
      }
    })
  }

  it('a_real_user_token_and_a_real_service_token_are_not_delegated_tokens', async () => {
    expect(
      await reasonOf(
        verify(await userToken(keys, { claims: { aud: 'whatsapp-api' } })),
      ),
    ).toBe('signature_invalid')
    expect(await reasonOf(verify(await serviceToken(keys)))).toBe(
      'claims_invalid',
    )
  })

  it('a_real_delegated_token_is_neither_a_user_nor_a_service_token', async () => {
    const delegated = await delegatedToken(keys)
    expect(
      (
        await verifyServiceToken(delegated, {
          audience: 'whatsapp-api',
          requiredScope: 'messages:send:text',
          jwks: keys.jwks,
        })
      ).ok,
    ).toBe(false)
    expect((await verifyAccessToken(delegated)).ok).toBe(false)
  })

  it('rejects_a_delegated_header_signed_by_a_stranger_and_one_without_kid', async () => {
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { key: keys.strangerKey })),
      ),
    ).toBe('signature_invalid')
    expect(
      await reasonOf(
        verify(await delegatedToken(keys, { header: { kid: undefined } })),
      ),
    ).toBe('signature_invalid')
  })
})

describe('delegatedTokenAuth (Hono)', () => {
  const makeApp = () => {
    const app = new Hono<{ Variables: DelegatedTokenAuthVariables }>()
    app.use(
      '*',
      delegatedTokenAuth({
        audience: 'whatsapp-api',
        requiredScope: 'messages:send:text',
        jwks: keys.jwks,
      }),
    )
    app.post('/send', (c) =>
      c.json({
        userId: c.var.userId,
        empresaId: c.var.empresaId,
        producto: c.var.producto,
        sessionId: c.var.sessionId,
        actorChain: c.var.actorChain,
        scopes: c.var.scopes,
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

  it('sets_userId_empresaId_producto_sessionId_actorChain_and_scopes', async () => {
    const res = await call(await delegatedToken(keys))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      userId: 'user-1',
      empresaId: 'emp-1',
      producto: PRODUCT,
      sessionId: 'sess-1',
      actorChain: [
        { serviceClientId: SERVICE_SUB, serviceClientSlug: 'ventas-backend' },
      ],
      scopes: ['messages:send:text'],
    })
  })

  it('answers_401_token_missing_without_a_bearer', async () => {
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'token_missing' } })
  })

  it('answers_401_for_a_service_token_and_for_a_user_token', async () => {
    const asService = await call(await serviceToken(keys))
    expect(asService.status).toBe(401)
    const asUser = await call(
      await userToken(keys, { claims: { aud: 'whatsapp-api' } }),
    )
    expect(asUser.status).toBe(401)
  })

  it('answers_401_for_a_delegated_token_without_company', async () => {
    const res = await call(
      await delegatedToken(keys, { claims: { empresa: undefined } }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: { code: 'claims_invalid' },
    })
  })

  it('answers_403_insufficient_scope_for_a_valid_token_without_the_scope', async () => {
    const res = await call(
      await delegatedToken(keys, { claims: { scope: 'messages:send:media' } }),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'insufficient_scope' },
    })
  })

  it('fails_when_built_with_auth_api_or_an_undelegable_scope', () => {
    expect(() =>
      delegatedTokenAuth({
        audience: 'auth-api' as never,
        requiredScope: 'x' as never,
      }),
    ).toThrow(TypeError)
    expect(() =>
      delegatedTokenAuth({
        audience: 'whatsapp-api',
        requiredScope: 'admin' as never,
      }),
    ).toThrow(TypeError)
  })
})

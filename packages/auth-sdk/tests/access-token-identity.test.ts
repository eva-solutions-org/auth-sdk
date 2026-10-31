/**
 * verifyAccessToken against REAL ES256 tokens and a real local JWKS (no jose mock): the user token
 * is bound to its product (`aud`), its type (`typ: at+jwt`) and its key type (`kid` `usr-`).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TOKEN_ISSUER } from '@eva_solutions/auth-contracts'
import { configureEvaAuth } from '../src/config'
import { JWT_CONFIG } from '../src/constants'
import { verifyAccessToken } from '../src/jwt'
import {
  PRODUCT,
  SERVICE_KID,
  USER_KID,
  createTestKeys,
  serviceToken,
  sign,
  userToken,
  type TestKeys,
} from './helpers/tokens'

const { jwksHolder } = vi.hoisted(() => ({
  jwksHolder: { current: undefined as unknown },
}))
vi.mock('../src/jwks', () => ({
  // Resolver of the whole JWKS; the user/service split is the SDK's job, not the JWKS mock's.
  getJwksKeyFn: () => jwksHolder.current,
}))

let keys: TestKeys

beforeAll(async () => {
  keys = await createTestKeys()
  jwksHolder.current = keys.jwks
  configureEvaAuth({ product: PRODUCT })
})

describe('verifyAccessToken: valid token', () => {
  it('returns id, sessionId, clientId and the active company', async () => {
    const result = await verifyAccessToken(await userToken(keys))

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'user-1',
        sessionId: 'sess-1',
        clientId: PRODUCT,
        empresaId: 'emp-1',
      },
    })
  })

  it('omits empresaId when the session has no active company', async () => {
    const result = await verifyAccessToken(
      await userToken(keys, { claims: { empresa: undefined } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      id: 'user-1',
      sessionId: 'sess-1',
      clientId: PRODUCT,
    })
    expect('empresaId' in result.data).toBe(false)
  })
})

describe('verifyAccessToken: rejections', () => {
  const rejects = async (token: string) => {
    const result = await verifyAccessToken(token)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatchObject({ reason: 'token_invalid', status: 401 })
  }

  it('rejects_a_token_whose_aud_is_another_product', async () => {
    await rejects(await userToken(keys, { claims: { aud: 'gym-panel' } }))
  })

  it('rejects_a_service_audience_used_as_aud', async () => {
    await rejects(await userToken(keys, { claims: { aud: 'whatsapp-api' } }))
  })

  it('rejects_a_token_with_the_wrong_typ', async () => {
    await rejects(await userToken(keys, { header: { typ: 'JWT' } }))
    await rejects(await userToken(keys, { header: { typ: 'svc-at+jwt' } }))
  })

  it('rejects_a_token_without_typ', async () => {
    await rejects(await userToken(keys, { header: { typ: undefined } }))
  })

  it('rejects_a_token_without_kid', async () => {
    await rejects(await userToken(keys, { header: { kid: undefined } }))
  })

  it('rejects_a_token_signed_with_the_service_key_that_claims_a_usr_kid', async () => {
    await rejects(await userToken(keys, { key: keys.serviceKey }))
  })

  it('rejects_a_token_signed_with_the_service_key_under_its_svc_kid', async () => {
    await rejects(
      await userToken(keys, {
        key: keys.serviceKey,
        header: { kid: SERVICE_KID },
      }),
    )
  })

  it('rejects_a_service_token_presented_as_a_user_token', async () => {
    await rejects(
      await serviceToken(keys, { claims: { aud: PRODUCT, sessionId: 's' } }),
    )
  })

  it('rejects_a_token_signed_by_a_stranger_under_a_known_kid', async () => {
    await rejects(await userToken(keys, { key: keys.strangerKey }))
  })

  it('rejects_a_token_without_client_id', async () => {
    await rejects(await userToken(keys, { claims: { client_id: undefined } }))
  })

  it('rejects_an_aud_array_even_if_it_contains_the_product', async () => {
    await rejects(
      await userToken(keys, { claims: { aud: [PRODUCT, 'whatsapp-api'] } }),
    )
  })

  it('rejects_a_client_id_that_is_not_the_product', async () => {
    await rejects(await userToken(keys, { claims: { client_id: 'gym-panel' } }))
  })

  it('rejects_a_token_without_exp', async () => {
    await rejects(await userToken(keys, { claims: { exp: undefined } }))
  })

  it('rejects_an_empresa_claim_that_is_not_a_string', async () => {
    await rejects(await userToken(keys, { claims: { empresa: 42 } }))
  })

  it('rejects_an_expired_token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    await rejects(
      await userToken(keys, { claims: { iat: past - 300, exp: past } }),
    )
  })

  it('rejects_another_issuer', async () => {
    await rejects(await userToken(keys, { claims: { iss: 'someone-else' } }))
  })
})

describe('JWT_CONFIG', () => {
  it('uses the issuer of the contract (a literal in the SDK to keep react small)', () => {
    expect(JWT_CONFIG.ISSUER).toBe(TOKEN_ISSUER)
  })
})

describe('verifyAccessToken: configuration', () => {
  it('propagates a config error (not a 401) when the product was never configured', async () => {
    vi.resetModules()
    const config = await import('../src/config')
    config.configureEvaAuth({ authUrl: 'https://auth.test' })
    const { verifyAccessToken: freshVerify } = await import('../src/jwt')

    await expect(
      freshVerify(await sign({ key: keys.userKey, header: { kid: USER_KID } })),
    ).rejects.toMatchObject({ name: 'EvaAuthConfigError' })
  })
})

/**
 * Real ES256 keys and tokens for the identity tests. Two key pairs on purpose, like the Auth
 * service: a USER key (`usr-` kid) and a SERVICE key (`svc-` kid) published in the same JWKS.
 */
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from 'jose'

export const USER_KID = 'usr-test-thumbprint'
export const SERVICE_KID = 'svc-test-thumbprint'
export const PRODUCT = 'whatsapp-panel'
export const SERVICE_SUB = '550e8400-e29b-41d4-a716-446655440000'

export type TestKeys = {
  userKey: CryptoKey
  serviceKey: CryptoKey
  /** Key unknown to the JWKS (a forger). */
  strangerKey: CryptoKey
  /** JWKS with BOTH public keys, like the real endpoint. */
  jwks: JWTVerifyGetKey
}

export async function createTestKeys(): Promise<TestKeys> {
  const user = await generateKeyPair('ES256')
  const service = await generateKeyPair('ES256')
  const stranger = await generateKeyPair('ES256')
  const publicJwk = async (key: CryptoKey, kid: string) => ({
    ...(await exportJWK(key)),
    kid,
    alg: 'ES256',
    use: 'sig',
  })
  return {
    userKey: user.privateKey,
    serviceKey: service.privateKey,
    strangerKey: stranger.privateKey,
    jwks: createLocalJWKSet({
      keys: [
        await publicJwk(user.publicKey, USER_KID),
        await publicJwk(service.publicKey, SERVICE_KID),
      ],
    }),
  }
}

const now = () => Math.floor(Date.now() / 1000)

export type SignInput = {
  header?: Record<string, unknown>
  claims?: Record<string, unknown>
  key: CryptoKey
}

/** Signs a token; every header and claim can be overridden, or removed with `undefined`. */
export async function sign({
  header = {},
  claims = {},
  key,
}: SignInput): Promise<string> {
  const protectedHeader: Record<string, unknown> = {
    alg: 'ES256',
    ...header,
  }
  for (const k of Object.keys(protectedHeader)) {
    if (protectedHeader[k] === undefined) delete protectedHeader[k]
  }
  const iat = now()
  const payload: Record<string, unknown> = { iat, exp: iat + 300, ...claims }
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k]
  }
  return new SignJWT(payload as never)
    .setProtectedHeader(protectedHeader as never)
    .sign(key)
}

/** A valid user access token for `PRODUCT`. */
export function userToken(keys: TestKeys, over: Partial<SignInput> = {}) {
  return sign({
    key: keys.userKey,
    header: { typ: 'at+jwt', kid: USER_KID, ...over.header },
    claims: {
      iss: 'auth-service',
      aud: PRODUCT,
      sub: 'user-1',
      sessionId: 'sess-1',
      client_id: PRODUCT,
      empresa: 'emp-1',
      jti: crypto.randomUUID(),
      ...over.claims,
    },
    ...(over.key && { key: over.key }),
  })
}

/** A valid service token for `whatsapp-api` with `messages:send:text`. */
export function serviceToken(keys: TestKeys, over: Partial<SignInput> = {}) {
  return sign({
    key: keys.serviceKey,
    header: { typ: 'svc-at+jwt', kid: SERVICE_KID, ...over.header },
    claims: {
      iss: 'auth-service',
      aud: 'whatsapp-api',
      sub: SERVICE_SUB,
      client_id: 'gym-backend',
      scope: 'messages:send:text',
      jti: crypto.randomUUID(),
      ...over.claims,
    },
    ...(over.key && { key: over.key }),
  })
}

/**
 * A valid delegated token (token exchange) for `whatsapp-api`: `typ: dlg-at+jwt`, signed with the
 * SERVICE key (`svc-` kid), one actor, company, product and session of origin, 120 s of life.
 */
export function delegatedToken(keys: TestKeys, over: Partial<SignInput> = {}) {
  const iat = now()
  return sign({
    key: keys.serviceKey,
    header: { typ: 'dlg-at+jwt', kid: SERVICE_KID, ...over.header },
    claims: {
      iss: 'auth-service',
      aud: 'whatsapp-api',
      sub: 'user-1',
      client_id: 'ventas-backend',
      act: { sub: SERVICE_SUB, client_id: 'ventas-backend' },
      empresa: 'emp-1',
      producto: PRODUCT,
      sid: 'sess-1',
      scope: 'messages:send:text',
      iat,
      exp: iat + 120,
      jti: crypto.randomUUID(),
      ...over.claims,
    },
    ...(over.key && { key: over.key }),
  })
}

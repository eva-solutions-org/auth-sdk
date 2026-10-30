import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contract from '../src/index'

const SRC_DIR = join(import.meta.dirname, '..', 'src')

// Distinct schemas carrying `.meta({ example })` in S1: phone, code, challengeId (request),
// deviceType, os, browser, userAgent, challengeId (response). S2 adds the update body coordinates
// (locationLat, locationLon). Raise it as slices add schemas so the loops below cannot pass
// vacuously.
const MIN_SCHEMAS_WITH_EXAMPLE = 10

// Exact example strings the API already uses today (`features/auth/domain/schemas.ts`):
// placeholders only, no real phone, id, hostname or URL (REQ-CONTRACT-07).
const ALLOWED_EXAMPLES = new Set([
  '5491155551234',
  'A1B2C3',
  '9f86d081884c7d659a2feaa0c55ad015',
  'mobile',
  'Android 14',
  'Chrome 120',
  'Mozilla/5.0 ...',
  '-34.6037',
  '-58.3816',
])

const REAL_LOOKING = [
  /https?:\/\//i,
  /\b[\w-]+\.(?:com|net|org|io|dev|app|workers\.dev|internal|local)\b/i,
  /@[\w-]+\.[a-z]{2,}/i,
]

/** Walks exported schemas (objects and arrays, recursively) and returns every distinct schema that has an `example` in its metadata. */
const schemasWithExample = (): z.ZodType[] => {
  const found = new Set<z.ZodType>()
  const visit = (schema: unknown): void => {
    if (!(schema instanceof z.ZodType)) return
    if (z.globalRegistry.get(schema)?.example !== undefined) found.add(schema)
    if (schema instanceof z.ZodObject) {
      for (const child of Object.values(schema.shape)) visit(child)
    } else if (schema instanceof z.ZodArray) {
      visit(schema.element)
    }
  }
  for (const value of Object.values(contract as Record<string, unknown>)) {
    visit(value)
  }
  return [...found]
}

describe('contract examples', () => {
  it('challenge_id_descriptions_name_no_route', () => {
    const getCodeChallenge = contract.getCodeResponseSchema.shape.data.shape
      .challengeId as z.ZodType
    const loginChallenge = contract.loginRequestSchema.shape
      .challengeId as z.ZodType
    const descriptions = [getCodeChallenge, loginChallenge].map(
      (schema) => z.globalRegistry.get(schema)?.description as string,
    )

    expect(descriptions).toEqual([
      'Identificador opaco del desafío; enviarlo en el login junto con el código. Vence con el código y se invalida con cada get-code nuevo.',
      'challengeId devuelto por la solicitud de código (get-code)',
    ])
    for (const description of descriptions) {
      expect(description).not.toMatch(/\bPOST\b|\/login|\/api\//)
    }
  })

  it('no_dot_openapi_in_sources', () => {
    const offenders = readdirSync(SRC_DIR, {
      withFileTypes: true,
      recursive: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => readFileSync(file, 'utf8').includes('.openapi('))

    expect(offenders).toEqual([])
  })

  it('every_meta_example_parses', () => {
    const withExample = schemasWithExample()

    expect(withExample.length).toBeGreaterThanOrEqual(MIN_SCHEMAS_WITH_EXAMPLE)
    for (const schema of withExample) {
      const example = z.globalRegistry.get(schema)?.example
      expect(schema.safeParse(example).success, JSON.stringify(example)).toBe(
        true,
      )
    }
  })

  it('examples_use_placeholders_only', () => {
    const examples = schemasWithExample().map(
      (schema) => z.globalRegistry.get(schema)?.example,
    )

    expect(examples.length).toBeGreaterThanOrEqual(MIN_SCHEMAS_WITH_EXAMPLE)
    for (const example of examples) {
      expect(typeof example).toBe('string')
      expect(ALLOWED_EXAMPLES.has(example as string), String(example)).toBe(
        true,
      )
      for (const pattern of REAL_LOOKING) {
        expect(pattern.test(example as string), String(example)).toBe(false)
      }
    }
  })
})

describe('contract body schemas', () => {
  it('body_schemas_are_plain_objects_without_refine', () => {
    for (const schema of [
      contract.getCodeRequestSchema,
      contract.loginRequestSchema,
      contract.updateUserRequestSchema,
      contract.usersBatchRequestSchema,
      contract.createSubscriptionRequestSchema,
      contract.updateSubscriptionRequestSchema,
      contract.deliveriesQuerySchema,
      contract.republishPendingQuerySchema,
      contract.maintenanceCleanupQuerySchema,
      contract.createServiceClientRequestSchema,
      contract.updateServiceClientRequestSchema,
    ]) {
      expect(schema).toBeInstanceOf(z.ZodObject)
      expect(schema._zod.def.checks ?? []).toEqual([])
    }

    const sources = readdirSync(SRC_DIR, {
      withFileTypes: true,
      recursive: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    for (const source of sources) {
      expect(source).not.toMatch(/\.(?:refine|superRefine)\(/)
    }
  })
})

const validLogin = {
  phone: '5491155551234',
  code: 'A1B2C3',
  challengeId: '9f86d081884c7d659a2feaa0c55ad015',
  deviceType: 'mobile',
  os: 'Android 14',
  browser: 'Chrome 120',
  userAgent: 'Mozilla/5.0 ...',
}

describe('auth schemas accept and reject (REQ-CONTRACT-10)', () => {
  it('login_get_code_refresh_logout_accept_reject', () => {
    // get-code
    expect(
      contract.getCodeRequestSchema.safeParse({ phone: '5491155551234' })
        .success,
    ).toBe(true)
    expect(
      contract.getCodeRequestSchema.safeParse({ phone: '12ab' }).success,
    ).toBe(false)
    expect(
      contract.getCodeRequestSchema.safeParse({
        phone: '5491155551234',
        extra: 1,
      }).success,
    ).toBe(false)
    expect(
      contract.getCodeResponseSchema.safeParse({
        data: {
          message: 'ok',
          challengeId: '9f86d081884c7d659a2feaa0c55ad015',
        },
      }).success,
    ).toBe(true)
    expect(
      contract.getCodeResponseSchema.safeParse({
        data: { message: 'ok', challengeId: 'NOT-HEX' },
      }).success,
    ).toBe(false)

    // login: 32-hex challengeId accepted, non-hex / uppercase rejected, extra key rejected
    expect(contract.loginRequestSchema.safeParse(validLogin).success).toBe(true)
    expect(
      contract.loginRequestSchema.safeParse({
        ...validLogin,
        challengeId: 'zz86d081884c7d659a2feaa0c55ad015',
      }).success,
    ).toBe(false)
    expect(
      contract.loginRequestSchema.safeParse({
        ...validLogin,
        challengeId: '9F86D081884C7D659A2FEAA0C55AD015',
      }).success,
    ).toBe(false)
    expect(
      contract.loginRequestSchema.safeParse({ ...validLogin, extra: 1 })
        .success,
    ).toBe(false)

    // login normalizes: phone loses the international prefix, code is upper-cased
    const parsed = contract.loginRequestSchema.parse({
      ...validLogin,
      phone: '005491155551234',
      code: 'a1b2c3',
    })
    expect(parsed.phone).toBe('5491155551234')
    expect(parsed.code).toBe('A1B2C3')

    // refresh and login answer with the same response; logout with a message
    expect(
      contract.loginResponseSchema.safeParse({ data: { user: { id: 'u1' } } })
        .success,
    ).toBe(true)
    expect(contract.loginResponseSchema.safeParse({ data: {} }).success).toBe(
      false,
    )
    expect(
      contract.messageResponseSchema.safeParse({ data: { message: 'ok' } })
        .success,
    ).toBe(true)
    expect(
      contract.messageWithCountResponseSchema.safeParse({
        data: { message: 'ok', count: 2 },
      }).success,
    ).toBe(true)
    expect(
      contract.messageWithCountResponseSchema.safeParse({
        data: { message: 'ok' },
      }).success,
    ).toBe(false)
  })

  it('error_response_schema_matches_the_wire', () => {
    expect(
      contract.errorResponseSchema.safeParse({
        error: { code: 'not_found', message: 'x' },
      }).success,
    ).toBe(true)
    expect(
      contract.errorResponseSchema.safeParse({ error: 'legacy string' })
        .success,
    ).toBe(false)
    expect(z.globalRegistry.get(contract.errorResponseSchema)?.id).toBe(
      'ErrorBody',
    )
  })
})

const validProfile = {
  id: 'u1',
  phone: '5491155551234',
  name: 'Ana',
  lastName: null,
  email: null,
  dni: null,
  stateActivity: 'activo',
  statePrivacy: 'publico',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('users, sessions and internal users schemas accept and reject (REQ-CONTRACT-11)', () => {
  it('users_batch_cap_constant_100_schema_enforces_it_and_no_drizzle', () => {
    expect(contract.USERS_BATCH_MAX_IDS).toBe(100)

    // The schema carries the cap as the hard upper bound (the API env can only lower it).
    const idsAt = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)
    expect(
      contract.usersBatchRequestSchema.safeParse({ ids: idsAt(100) }).success,
    ).toBe(true)
    expect(
      contract.usersBatchRequestSchema.safeParse({ ids: idsAt(101) }).success,
    ).toBe(false)
    expect(
      z.toJSONSchema(contract.usersBatchRequestSchema, { io: 'input' })
        .properties?.ids,
    ).toMatchObject({ maxItems: 100 })

    const usersSource = readFileSync(join(SRC_DIR, 'users.ts'), 'utf8')
    expect(usersSource).not.toMatch(/drizzle/i)
  })

  it('profile_and_batch_response_accept_reject', () => {
    expect(
      contract.profileResponseSchema.safeParse({ data: validProfile }).success,
    ).toBe(true)
    expect(
      contract.profileResponseSchema.safeParse({
        data: { ...validProfile, stateActivity: 'sleeping' },
      }).success,
    ).toBe(false)
    expect(
      contract.profileResponseSchema.safeParse({
        data: { ...validProfile, statePrivacy: 'secret-club' },
      }).success,
    ).toBe(false)
    expect(
      contract.profileResponseSchema.safeParse({
        data: { ...validProfile, name: undefined },
      }).success,
    ).toBe(false)

    expect(
      contract.usersBatchResponseSchema.safeParse({
        data: { users: [validProfile] },
      }).success,
    ).toBe(true)
    expect(
      contract.usersBatchResponseSchema.safeParse({ data: { users: [{}] } })
        .success,
    ).toBe(false)
  })

  it('batch_request_is_strict_and_takes_string_ids', () => {
    expect(
      contract.usersBatchRequestSchema.safeParse({ ids: ['a', 'b'] }).success,
    ).toBe(true)
    expect(
      contract.usersBatchRequestSchema.safeParse({ ids: [1] }).success,
    ).toBe(false)
    expect(
      contract.usersBatchRequestSchema.safeParse({ ids: [], extra: 1 }).success,
    ).toBe(false)
  })

  it('companies_and_sessions_list_accept_reject', () => {
    const company = {
      id: 'c1',
      ruc: '20123456789',
      razonSocial: 'ACME SAC',
      slug: 'acme',
      direccion: null,
      celular: null,
      email: null,
      img: null,
    }
    expect(
      contract.companyListResponseSchema.safeParse({ data: [company] }).success,
    ).toBe(true)
    expect(
      contract.companyListResponseSchema.safeParse({
        data: [{ ...company, ruc: 20123456789 }],
      }).success,
    ).toBe(false)

    const session = {
      sessionId: SESSION_ID,
      deviceType: 'mobile',
      os: 'Android 14',
      browser: 'Chrome 120',
      ipAddress: '203.0.113.7',
      createdAt: '2026-01-01T00:00:00.000Z',
      current: true,
    }
    expect(
      contract.sessionListResponseSchema.safeParse({ data: [session] }).success,
    ).toBe(true)
    expect(
      contract.sessionListResponseSchema.safeParse({
        data: [{ ...session, sessionId: 'not-a-uuid' }],
      }).success,
    ).toBe(false)
    expect(
      contract.sessionListResponseSchema.safeParse({
        data: [{ ...session, current: 'yes' }],
      }).success,
    ).toBe(false)
  })

  it('update_user_request_is_the_strict_base_without_refine', () => {
    // The base accepts an empty body: "at least one field" and "lat/lon together" are API refines.
    expect(contract.updateUserRequestSchema.safeParse({}).success).toBe(true)
    expect(
      contract.updateUserRequestSchema.safeParse({
        name: null,
        lastName: 'Perez',
      }).success,
    ).toBe(true)
    expect(
      contract.updateUserRequestSchema.safeParse({ extra: 1 }).success,
    ).toBe(false)
    expect(
      contract.updateUserRequestSchema.safeParse({ name: '' }).success,
    ).toBe(false)
    expect(
      contract.updateUserRequestSchema.safeParse({ locationLat: '91' }).success,
    ).toBe(false)
    expect(
      contract.updateUserRequestSchema.safeParse({ locationLon: '181' })
        .success,
    ).toBe(false)

    const normalized = contract.updateUserRequestSchema.parse({
      email: '  Ana@Example.COM ',
      dni: ' ab123 ',
    })
    expect(normalized.email).toBe('ana@example.com')
    expect(normalized.dni).toBe('AB123')
  })
})

const SUBSCRIPTION = {
  id: 'sub-1',
  clientId: 'client-1',
  url: 'https://hooks.example.test/in',
  eventCodes: ['user.created'],
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const DELIVERY = {
  id: 'del-1',
  subscriptionId: 'sub-1',
  eventId: 'evt-1',
  status: 'success',
  attempts: 1,
  lastAttemptAt: null,
  nextRetryAt: null,
  responseStatus: 200,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const UUID = '550e8400-e29b-41d4-a716-446655440000'

const SERVICE_CLIENT = {
  id: UUID,
  slug: 'whatsapp-api',
  name: 'Whatsapp API',
  enabled: true,
  scopes: ['users:read'],
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('webhook and service client schemas accept and reject (REQ-CONTRACT-12)', () => {
  it('webhook_and_service_client_schemas_accept_reject', () => {
    // webhook subscription bodies: strict, url required to be a URL, at least one event code
    expect(
      contract.createSubscriptionRequestSchema.parse({
        url: 'https://hooks.example.test/in',
        eventCodes: ['user.created'],
      }).enabled,
    ).toBe(true)
    for (const body of [
      { url: 'not a url', eventCodes: ['user.created'] },
      { url: 'https://hooks.example.test/in', eventCodes: [] },
      { url: 'https://hooks.example.test/in', eventCodes: ['a'], extra: 1 },
      { eventCodes: ['a'] },
    ]) {
      expect(
        contract.createSubscriptionRequestSchema.safeParse(body).success,
      ).toBe(false)
    }
    expect(contract.updateSubscriptionRequestSchema.safeParse({}).success).toBe(
      true,
    )
    expect(
      contract.updateSubscriptionRequestSchema.safeParse({ eventCodes: [] })
        .success,
    ).toBe(false)
    expect(
      contract.updateSubscriptionRequestSchema.safeParse({ extra: 1 }).success,
    ).toBe(false)

    // webhook url: http(s) only, no whitespace or control characters, and no credentials in the authority (an `@` past the authority is fine)
    const HOOK = 'https://hooks.example.test/in'
    const EVENTS = ['user.created']
    for (const url of [
      HOOK,
      'https://hooks.example.test:8443/in?next=a@b#frag@x',
      'https://hooks.example.test/user@home',
      'https://hooks.example.test/?r=http://x@y',
      'http://hooks.example.test/in',
      'HTTPS://hooks.example.test/in',
      'HTTP://hooks.example.test/in',
    ]) {
      expect(
        contract.createSubscriptionRequestSchema.safeParse({
          url,
          eventCodes: EVENTS,
        }).success,
        url,
      ).toBe(true)
      expect(
        contract.updateSubscriptionRequestSchema.safeParse({ url }).success,
        url,
      ).toBe(true)
    }
    for (const url of [
      ' https://hooks.example.test/in',
      'https://hooks.example.test/in ',
      'https://hooks.example.test/a b',
      'https://hooks.example.test/a	b',
      'javascript:alert(1)',
      'mailto:a@b.com',
      'ftp://hooks.example.test/in',
      'data:text/plain,x',
      '\x01https://hooks.example.test/in',
      'https://hooks.example.test/a\x01b',
      'https://hooks.example.test/a\x7Fb',
      '\x7Fhttps://hooks.example.test/in',
      'https:hooks.example.test/in',
      `https://hooks.example.test/${'a'.repeat(2048)}`,
    ]) {
      expect(
        contract.createSubscriptionRequestSchema.safeParse({
          url,
          eventCodes: EVENTS,
        }).success,
        url,
      ).toBe(false)
      expect(
        contract.updateSubscriptionRequestSchema.safeParse({ url }).success,
        url,
      ).toBe(false)
    }

    // webhook eventCodes: only members of the closed catalog (duplicates are the API's refine)
    for (const code of Object.values(contract.EVENT_CODES)) {
      expect(
        contract.createSubscriptionRequestSchema.safeParse({
          url: HOOK,
          eventCodes: [code],
        }).success,
        code,
      ).toBe(true)
    }
    for (const eventCodes of [
      ['user.unknown'],
      ['USER_CREATED'],
      ['user.created', 'nope'],
      [''],
      [1],
    ]) {
      expect(
        contract.createSubscriptionRequestSchema.safeParse({
          url: HOOK,
          eventCodes,
        }).success,
        JSON.stringify(eventCodes),
      ).toBe(false)
      expect(
        contract.updateSubscriptionRequestSchema.safeParse({ eventCodes })
          .success,
        JSON.stringify(eventCodes),
      ).toBe(false)
    }
    expect(
      contract.createSubscriptionRequestSchema.safeParse({
        url: HOOK,
        eventCodes: ['user.created', 'user.created'],
      }).success,
      'duplicates pass the contract on purpose: the API refines them',
    ).toBe(true)
    // the list is bounded: 32 entries pass, 33 do not
    const eventCodesAt = (n: number) =>
      Array.from({ length: n }, () => 'user.created' as const)
    expect(
      contract.createSubscriptionRequestSchema.safeParse({
        url: HOOK,
        eventCodes: eventCodesAt(32),
      }).success,
    ).toBe(true)
    expect(
      contract.createSubscriptionRequestSchema.safeParse({
        url: HOOK,
        eventCodes: eventCodesAt(33),
      }).success,
    ).toBe(false)
    expect(
      contract.updateSubscriptionRequestSchema.safeParse({
        eventCodes: eventCodesAt(33),
      }).success,
    ).toBe(false)

    // deliveries query: coerced numbers, defaults 50/0, status enum, uuid filters
    expect(contract.deliveriesQuerySchema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    })
    expect(
      contract.deliveriesQuerySchema.parse({ limit: '100', offset: '5' }),
    ).toEqual({ limit: 100, offset: 5 })
    for (const query of [
      { limit: '101' },
      { limit: '0' },
      { offset: '-1' },
      { status: 'done' },
      { event_id: 'nope' },
      { subscription_id: 'nope' },
      { extra: '1' },
    ]) {
      expect(contract.deliveriesQuerySchema.safeParse(query).success).toBe(
        false,
      )
    }
    expect(
      contract.deliveriesQuerySchema.safeParse({
        status: 'expired',
        event_id: UUID,
        subscription_id: UUID.toUpperCase(),
      }).success,
    ).toBe(true)

    // republish-pending query: coerced numbers, defaults 10 minutes / 100 per call, strict
    expect(contract.republishPendingQuerySchema.parse({})).toEqual({
      older_than_minutes: 10,
      limit: 100,
    })
    expect(
      contract.republishPendingQuerySchema.parse({
        older_than_minutes: '10080',
        limit: '1',
      }),
    ).toEqual({ older_than_minutes: 10080, limit: 1 })
    for (const query of [
      { limit: '101' },
      { limit: '0' },
      { older_than_minutes: '0' },
      { older_than_minutes: '10081' },
      { older_than_minutes: '1.5' },
      { extra: '1' },
    ]) {
      expect(
        contract.republishPendingQuerySchema.safeParse(query).success,
      ).toBe(false)
    }
    expect(
      contract.republishPendingResponseSchema.safeParse({
        data: { republished: 3, hasMore: false },
      }).success,
    ).toBe(true)
    for (const body of [
      { data: { republished: 1.5, hasMore: false } },
      { data: { republished: 3 } },
      { republished: 3, hasMore: false },
    ]) {
      expect(
        contract.republishPendingResponseSchema.safeParse(body).success,
      ).toBe(false)
    }

    // maintenance cleanup: coerced limit, default and maximum 100, strict
    expect(contract.maintenanceCleanupQuerySchema.parse({})).toEqual({
      limit: 100,
    })
    expect(
      contract.maintenanceCleanupQuerySchema.parse({ limit: '1' }),
    ).toEqual({ limit: 1 })
    for (const query of [
      { limit: '101' },
      { limit: '0' },
      { limit: '1.5' },
      { older_than_minutes: '10' },
    ]) {
      expect(
        contract.maintenanceCleanupQuerySchema.safeParse(query).success,
        JSON.stringify(query),
      ).toBe(false)
    }
    expect(
      contract.maintenanceCleanupResponseSchema.safeParse({
        data: { usersPurged: 2, eventsDeleted: 5, hasMore: false },
      }).success,
    ).toBe(true)
    for (const body of [
      { data: { usersPurged: 1.5, eventsDeleted: 5, hasMore: false } },
      { data: { usersPurged: 2, eventsDeleted: 5 } },
      { data: { usersPurged: 2, hasMore: false } },
      { usersPurged: 2, eventsDeleted: 5, hasMore: false },
    ]) {
      expect(
        contract.maintenanceCleanupResponseSchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false)
    }

    // webhook responses
    expect(
      contract.subscriptionWithSecretResponseSchema.safeParse({
        data: { subscription: SUBSCRIPTION, signingKey: 'k' },
      }).success,
    ).toBe(true)
    expect(
      contract.subscriptionWithSecretResponseSchema.safeParse({
        data: { subscription: SUBSCRIPTION },
      }).success,
    ).toBe(false)
    expect(
      contract.subscriptionResponseSchema.safeParse({ data: SUBSCRIPTION })
        .success,
    ).toBe(true)
    expect(
      contract.subscriptionListResponseSchema.safeParse({
        data: { subscriptions: [SUBSCRIPTION] },
      }).success,
    ).toBe(true)
    expect(
      contract.subscriptionListResponseSchema.safeParse({
        data: { subscriptions: [{ ...SUBSCRIPTION, enabled: 'yes' }] },
      }).success,
    ).toBe(false)
    expect(
      contract.rotateSubscriptionSecretResponseSchema.safeParse({
        data: { id: 'sub-1', signingKey: 'k', updatedAt: 'x' },
      }).success,
    ).toBe(true)
    expect(
      contract.deliveryListResponseSchema.safeParse({
        data: { deliveries: [DELIVERY] },
      }).success,
    ).toBe(true)
    expect(
      contract.deliveryListResponseSchema.safeParse({
        data: { deliveries: [{ ...DELIVERY, status: 'lost' }] },
      }).success,
    ).toBe(false)
    expect(
      contract.deliveryListResponseSchema.safeParse({
        data: { deliveries: [{ ...DELIVERY, attempts: '1' }] },
      }).success,
    ).toBe(false)

    // service client slug and bodies
    for (const slug of ['abc', 'whatsapp-api', 'a'.concat('b'.repeat(63))]) {
      expect(contract.serviceClientSlugSchema.safeParse(slug).success).toBe(
        true,
      )
    }
    for (const slug of [
      'ab',
      'Abc',
      '1abc',
      'a_b',
      'a'.concat('b'.repeat(64)),
    ]) {
      expect(contract.serviceClientSlugSchema.safeParse(slug).success).toBe(
        false,
      )
    }
    const created = contract.createServiceClientRequestSchema.parse({
      slug: 'whatsapp-api',
      scopes: ['webhooks:read', 'users:read', 'webhooks:read'],
    })
    // repeated scopes are deduplicated keeping the first order, they are not rejected
    expect(created.scopes).toEqual(['webhooks:read', 'users:read'])
    expect(
      contract.createServiceClientRequestSchema.parse({ slug: 'whatsapp-api' })
        .scopes,
    ).toEqual([])
    // request arrays are bounded: 16 entries pass (repeats included), 17 do not
    const scopesAt = (n: number) =>
      Array.from({ length: n }, () => 'users:read' as const)
    expect(
      contract.createServiceClientRequestSchema.safeParse({
        slug: 'whatsapp-api',
        scopes: scopesAt(16),
      }).success,
    ).toBe(true)
    expect(
      contract.createServiceClientRequestSchema.safeParse({
        slug: 'whatsapp-api',
        scopes: scopesAt(17),
      }).success,
    ).toBe(false)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({
        scopes: scopesAt(17),
      }).success,
    ).toBe(false)
    for (const body of [
      { slug: 'whatsapp-api', scopes: ['admin:all'] },
      { slug: 'whatsapp-api', name: '' },
      { slug: 'whatsapp-api', extra: 1 },
      {},
    ]) {
      expect(
        contract.createServiceClientRequestSchema.safeParse(body).success,
      ).toBe(false)
    }
    // the update body is the strict BASE: an empty body parses (the "one field at least" rule is an API refine)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({}).success,
    ).toBe(true)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({ enabled: false })
        .success,
    ).toBe(true)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({ scopes: ['x'] })
        .success,
    ).toBe(false)
    expect(
      contract.updateServiceClientRequestSchema.safeParse({ extra: 1 }).success,
    ).toBe(false)

    // service client responses (inline response schemas of the admin routers)
    expect(
      contract.serviceClientPublicSchema.safeParse(SERVICE_CLIENT).success,
    ).toBe(true)
    expect(
      contract.serviceClientPublicSchema.safeParse({
        ...SERVICE_CLIENT,
        id: 'not-a-uuid',
      }).success,
    ).toBe(false)
    expect(
      contract.createServiceClientResponseSchema.safeParse({
        data: {
          id: UUID,
          slug: 'whatsapp-api',
          name: 'n',
          scopes: [],
          enabled: true,
          secret: 's',
          warning: 'w',
        },
      }).success,
    ).toBe(true)
    expect(
      contract.createServiceClientResponseSchema.safeParse({
        data: {
          id: UUID,
          slug: 'whatsapp-api',
          name: 'n',
          scopes: [],
          enabled: false,
          secret: 's',
          warning: 'w',
        },
      }).success,
    ).toBe(false)
    expect(
      contract.listServiceClientsResponseSchema.safeParse({
        data: { clientes: [SERVICE_CLIENT] },
      }).success,
    ).toBe(true)
    expect(
      contract.getServiceClientResponseSchema.safeParse({
        data: { cliente: SERVICE_CLIENT },
      }).success,
    ).toBe(true)
    expect(
      contract.updateServiceClientResponseSchema.safeParse({
        data: { cliente: SERVICE_CLIENT, warning: 'w' },
      }).success,
    ).toBe(true)
    expect(
      contract.updateServiceClientResponseSchema.safeParse({
        data: { cliente: SERVICE_CLIENT },
      }).success,
    ).toBe(true)
    expect(
      contract.rotateServiceClientSecretResponseSchema.safeParse({
        data: { slug: 'whatsapp-api', secret: 's', warning: 'w' },
      }).success,
    ).toBe(true)
    expect(
      contract.rotateServiceClientSecretResponseSchema.safeParse({
        data: { slug: 'whatsapp-api', secret: 's' },
      }).success,
    ).toBe(false)
    expect(
      contract.restoreUserResponseSchema.safeParse({
        data: {
          userId: UUID,
          stateAccount: 'no_verificado',
          previouslyDeletedAt: null,
          restoredAt: '2026-01-01T00:00:00.000Z',
        },
      }).success,
    ).toBe(true)
    expect(
      contract.restoreUserResponseSchema.safeParse({
        data: {
          userId: UUID,
          stateAccount: 'verificado',
          previouslyDeletedAt: null,
          restoredAt: 'x',
        },
      }).success,
    ).toBe(false)
  })

  it('component_ids_equal_the_published_openapi_ids', () => {
    const idOf = (schema: z.ZodType) => z.globalRegistry.get(schema)?.id

    expect(idOf(contract.serviceClientPublicSchema)).toBe('ServiceClientPublic')
    expect(idOf(contract.createServiceClientResponseSchema)).toBe(
      'AdminCreateResponse',
    )
    expect(idOf(contract.listServiceClientsResponseSchema)).toBe(
      'AdminListResponse',
    )
    expect(idOf(contract.getServiceClientResponseSchema)).toBe(
      'AdminDetailResponse',
    )
    expect(idOf(contract.updateServiceClientResponseSchema)).toBe(
      'AdminUpdateResponse',
    )
    expect(idOf(contract.rotateServiceClientSecretResponseSchema)).toBe(
      'AdminRotateSecretResponse',
    )
    expect(idOf(contract.restoreUserResponseSchema)).toBe(
      'AdminRestaurarUsuarioResponse',
    )
  })

  it('no_regex_exposed_in_the_openapi_has_flags', () => {
    // JSON Schema `pattern` has no flags: a flagged regex is published by the API generator with
    // the flag as literal text (`...$/i`) and any validator built from the spec rejects every real
    // value. `z.toJSONSchema` drops the flags silently, so the regex objects are inspected directly:
    // the walk follows every object reachable from each exported schema and collects each RegExp.
    const regexes = new Set<RegExp>()
    const seen = new Set<unknown>()
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null || seen.has(node)) return
      seen.add(node)
      if (node instanceof Map || node instanceof Set) {
        node.forEach(walk)
        return
      }
      // `_zod` is not enumerable on checks and schemas, so own property names are walked.
      for (const key of Object.getOwnPropertyNames(node)) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key)
        if (!descriptor || !('value' in descriptor)) continue
        const value: unknown = descriptor.value
        // Only the regexes of a format check (`def.pattern` next to `def.check`) end up in the
        // OpenAPI. zod's own `_zod.pattern` on non-string types (e.g. boolean) never does.
        if (value instanceof RegExp && key === 'pattern' && 'check' in node) {
          regexes.add(value)
        } else {
          walk(value)
        }
      }
    }
    for (const value of Object.values(contract)) {
      if (value instanceof z.ZodType) walk(value)
    }

    // Vacuity guard: the webhook url, the UUID filters and the plain-field regexes are all reached.
    expect(regexes.size).toBeGreaterThanOrEqual(5)
    for (const regex of regexes) {
      expect(regex.flags, regex.source).toBe('')
    }
  })

  it('webhook_url_contract_does_not_judge_userinfo_the_api_does', () => {
    const create = (url: string) =>
      contract.createSubscriptionRequestSchema.safeParse({
        url,
        eventCodes: ['user.created'],
      }).success
    // The contract only rejects whitespace and non-URLs; the "no credentials" rule is the API's.
    expect(create('https://user:pass@hooks.example.test/in')).toBe(true)
    // The scheme without `//` is not a valid http(s) URL for the contract (zod's http guard).
    expect(create('HTTPS:u@hooks.example.test/in')).toBe(false)
    expect(create('HTTPS://hooks.example.test/in')).toBe(true)
    // Whitespace is still rejected before `.url()` trims it.
    expect(create(' https://hooks.example.test/in')).toBe(false)
    expect(create('https://hooks.example.test/a b')).toBe(false)
  })

  it('s3_schemas_have_no_drizzle_and_the_secret_format_stays_in_the_api', () => {
    for (const file of ['webhooks.ts', 'service-clients.ts']) {
      expect(readFileSync(join(SRC_DIR, file), 'utf8')).not.toMatch(/drizzle/i)
    }
    expect('secretFormatSchema' in contract).toBe(false)
  })
})

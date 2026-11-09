/**
 * exchangeToken on the service token provider: the RFC 8693 request, its own Bearer (audience
 * `auth-api`, scope `tokens:exchange`), the per-isolate cache and its key, error answers as Results.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createServiceTokenProvider,
  type ServiceTokenProvider,
} from '../src/s2s/token-provider'
import { verifyS2SRequest } from '../src/s2s/verify'

const SECRET_HEX = 'deadbeef'.repeat(8)
const CLIENT_ID = 'ventas-backend'
const EXCHANGE_URL = 'https://auth.test/api/v1/internal/token-exchange'
const TOKEN_URL = 'https://auth.test/api/v1/internal/token'

type Call = { url: string; init: RequestInit }
let calls: Call[]
let exchangeSeq: number
let exchangeAnswer: (n: number, init: RequestInit) => unknown

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
})

const exchangeOk = (n: number, expiresIn = 120, scope = 'messages:send:text') =>
  json(200, {
    access_token: `dlg-${n}`,
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope,
  })

let bearerSeq: number

beforeEach(() => {
  calls = []
  exchangeSeq = 0
  bearerSeq = 0
  exchangeAnswer = (n) => exchangeOk(n)
  global.fetch = vi.fn(async (url: URL | string, init: RequestInit) => {
    const href = String(url)
    calls.push({ url: href, init })
    if (href === TOKEN_URL) {
      return json(200, {
        access_token: `bearer-${++bearerSeq}`,
        token_type: 'Bearer',
        expires_in: 300,
        scope: 'tokens:exchange',
      })
    }
    return exchangeAnswer(++exchangeSeq, init)
  }) as unknown as typeof fetch
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (seconds: number) =>
  vi.setSystemTime(Date.now() + seconds * 1000)

const exchanges = () => calls.filter((c) => c.url === EXCHANGE_URL)

// Waits until the exchange request has been sent `n` times. The fingerprint and the HMAC signing
// before the fetch are real async crypto (thread pool): a fixed number of event loop turns is not
// enough under load (it failed in CI). It waits on the REAL clock with a deadline and never
// touches the fake one (`vi.waitFor` would advance it).
const exchangeCalled = async (n: number) => {
  const deadline = performance.now() + 5_000
  while (exchanges().length < n) {
    if (performance.now() > deadline)
      throw new Error(`exchange not requested ${n} times`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

const makeProvider = (over: { audience?: string } = {}): ServiceTokenProvider =>
  createServiceTokenProvider({
    authUrl: 'https://auth.test',
    clientId: CLIENT_ID,
    secretHex: SECRET_HEX,
    audience: 'whatsapp-api',
    ...over,
  })

const input = (
  over: Partial<Parameters<ServiceTokenProvider['exchangeToken']>[0]> = {},
) => ({
  subjectToken: 'user.access.token',
  audience: 'whatsapp-api',
  ...over,
})

describe('the request', () => {
  it('posts_the_rfc8693_body_with_the_bearer_of_the_auth_api_token', async () => {
    const provider = makeProvider()

    const result = await provider.exchangeToken(
      input({ scope: 'messages:send:text' }),
    )

    expect(result).toEqual({
      ok: true,
      data: { accessToken: 'dlg-1', scope: 'messages:send:text' },
    })
    const [exchange] = exchanges()
    expect(exchange!.init.method).toBe('POST')
    expect(
      (exchange!.init.headers as Record<string, string>).authorization,
    ).toBe('Bearer bearer-1')
    expect(JSON.parse(exchange!.init.body as string)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'user.access.token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: 'whatsapp-api',
      scope: 'messages:send:text',
    })
  })

  it('omits_scope_when_none_is_asked', async () => {
    await makeProvider().exchangeToken(input())

    expect(JSON.parse(exchanges()[0]!.init.body as string)).not.toHaveProperty(
      'scope',
    )
  })

  it('gets_its_bearer_for_auth_api_tokens_exchange_whatever_the_provider_audience', async () => {
    const provider = makeProvider({ audience: 'whatsapp-api' })

    await provider.exchangeToken(input())

    const tokenCall = calls.find((c) => c.url === TOKEN_URL)!
    expect(JSON.parse(tokenCall.init.body as string)).toEqual({
      audience: 'auth-api',
      scope: 'tokens:exchange',
    })
    // The pedido de token is HMAC signed with the client credentials.
    const verified = await verifyS2SRequest(
      new Request(TOKEN_URL, {
        method: 'POST',
        headers: tokenCall.init.headers as Record<string, string>,
        body: tokenCall.init.body as string,
      }),
      { secretStore: async () => SECRET_HEX },
    )
    expect(verified).toEqual({ ok: true, data: { clientId: CLIENT_ID } })
  })

  it('reuses_the_bearer_across_exchanges', async () => {
    const provider = makeProvider()

    await provider.exchangeToken(input({ subjectToken: 'a.b.c' }))
    await provider.exchangeToken(input({ subjectToken: 'd.e.f' }))

    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
    expect(exchanges()).toHaveLength(2)
  })

  it('retries_once_with_a_fresh_bearer_after_a_401', async () => {
    exchangeAnswer = (n) =>
      n === 1 ? json(401, { error: 'invalid_client' }) : exchangeOk(n)

    const result = await makeProvider().exchangeToken(input())

    expect(result.ok).toBe(true)
    expect(exchanges()).toHaveLength(2)
    expect(
      (exchanges()[1]!.init.headers as Record<string, string>).authorization,
    ).toBe('Bearer bearer-2')
  })
})

describe('local validation, without a request', () => {
  it.each([
    ['auth-api', undefined],
    ['whatsapp-panel', undefined],
    ['whatsapp-api', 'admin'],
    ['whatsapp-api', 'users:read'],
  ])('rejects_audience_%s_with_scope_%s', async (audience, scope) => {
    const result = await makeProvider().exchangeToken(
      input({ audience, ...(scope && { scope }) }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'sdk', reason: 'malformed' },
    })
    expect(calls).toHaveLength(0)
  })

  it('rejects_an_empty_subject_token', async () => {
    const result = await makeProvider().exchangeToken(
      input({ subjectToken: '' }),
    )

    expect(result).toMatchObject({ ok: false, error: { reason: 'malformed' } })
    expect(calls).toHaveLength(0)
  })
})

describe('the cache', () => {
  it('the_same_key_reuses_the_delegated_token', async () => {
    const provider = makeProvider()

    const first = await provider.exchangeToken(input())
    advance(10)
    const second = await provider.exchangeToken(input())

    expect(first).toEqual(second)
    expect(exchanges()).toHaveLength(1)
  })

  it('the_order_of_the_asked_scopes_does_not_change_the_key', async () => {
    const provider = makeProvider()

    await provider.exchangeToken(
      input({ scope: 'messages:send:text messages:send:media' }),
    )
    await provider.exchangeToken(
      input({ scope: 'messages:send:media messages:send:text' }),
    )

    expect(exchanges()).toHaveLength(1)
  })

  it('another_audience_or_another_scope_is_another_key', async () => {
    const provider = makeProvider()

    await provider.exchangeToken(input({ scope: 'messages:send:text' }))
    await provider.exchangeToken(input({ scope: 'messages:send:media' }))
    await provider.exchangeToken(input())

    expect(exchanges()).toHaveLength(3)
  })

  it('a_re_exchange_from_another_input_token_jti_does_not_reuse_the_entry', async () => {
    // Same user, session, company, audience and scope; only the `jti` of the incoming delegated
    // token differs. Reusing would hand a token obtained with an input that met `requiere_scope_origen`
    // to a caller whose input did not.
    const provider = makeProvider({ audience: 'whatsapp-api' })
    const claims = { sub: 'user-1', sid: 'sess-1', empresa: 'emp-1' }
    const dlg = (jti: string) =>
      `h.${btoa(JSON.stringify({ ...claims, jti })).replace(/=+$/, '')}.s`

    await provider.exchangeToken(input({ subjectToken: dlg('jti-with-scope') }))
    await provider.exchangeToken(
      input({ subjectToken: dlg('jti-without-scope') }),
    )
    // The very same input token does reuse.
    await provider.exchangeToken(input({ subjectToken: dlg('jti-with-scope') }))

    expect(exchanges()).toHaveLength(2)
  })

  it('a_token_that_only_claims_the_same_session_and_user_does_not_read_the_entry', async () => {
    // The cache key must not rest on claims nobody verified here: a forged token that repeats the
    // claims of a victim cannot read the victim's delegated token.
    const provider = makeProvider()
    const victim = `h.${btoa(JSON.stringify({ sub: 'victim', sid: 's1', empresa: 'e1' }))}.sig-victim`
    const forged = `h.${btoa(JSON.stringify({ sub: 'victim', sid: 's1', empresa: 'e1' }))}.sig-forged`

    await provider.exchangeToken(input({ subjectToken: victim }))
    await provider.exchangeToken(input({ subjectToken: forged }))

    expect(exchanges()).toHaveLength(2)
  })

  it('reuses_until_30_seconds_before_the_expiry_and_not_after', async () => {
    const provider = makeProvider()
    await provider.exchangeToken(input())

    advance(89) // 120 s token, 30 s margin: valid until 90 s
    await provider.exchangeToken(input())
    expect(exchanges()).toHaveLength(1)

    advance(2)
    const renewed = await provider.exchangeToken(input())
    expect(exchanges()).toHaveLength(2)
    expect(renewed).toMatchObject({ ok: true, data: { accessToken: 'dlg-2' } })
  })

  it('never_reuses_a_token_that_lives_30_seconds_or_less', async () => {
    exchangeAnswer = (n) => exchangeOk(n, 20)
    const provider = makeProvider()

    await provider.exchangeToken(input())
    await provider.exchangeToken(input())

    expect(exchanges()).toHaveLength(2)
  })

  it('two_simultaneous_identical_calls_make_one_request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    exchangeAnswer = (n) => gate.then(() => exchangeOk(n)) as never
    const provider = makeProvider()

    const first = provider.exchangeToken(input())
    const second = provider.exchangeToken(input())
    await vi.waitFor(() => expect(exchanges()).toHaveLength(1))
    release()

    expect(await Promise.all([first, second])).toEqual([
      { ok: true, data: { accessToken: 'dlg-1', scope: 'messages:send:text' } },
      { ok: true, data: { accessToken: 'dlg-1', scope: 'messages:send:text' } },
    ])
    expect(exchanges()).toHaveLength(1)
  })

  it('a_joiner_of_an_orphaned_request_stops_waiting_and_makes_its_own', async () => {
    // The first request never settles (Workers cancelled the request that started it).
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    exchangeAnswer = (n) =>
      n === 1 ? (new Promise(() => {}) as never) : exchangeOk(n)
    const provider = makeProvider()
    void provider.exchangeToken(input()) // the initiator, never awaited

    const joiner = provider.exchangeToken(input())
    await exchangeCalled(1)
    expect(exchanges()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_999)
    expect(exchanges()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)

    expect(await joiner).toMatchObject({
      ok: true,
      data: { accessToken: 'dlg-2' },
    })
    expect(exchanges()).toHaveLength(2)
    // The orphan entry is gone: the next call is served from the cache, not stuck behind it.
    await provider.exchangeToken(input())
    expect(exchanges()).toHaveLength(2)
  })

  it('an_orphaned_request_older_than_its_deadline_is_dropped_without_timers', async () => {
    // Only Date is faked (beforeEach): no timer fires, so the orphan cannot rescue itself.
    exchangeAnswer = (n) =>
      n === 1 ? (new Promise(() => {}) as never) : exchangeOk(n)
    const provider = makeProvider()
    void provider.exchangeToken(input()) // the initiator, cancelled by the runtime
    await exchangeCalled(1)
    expect(exchanges()).toHaveLength(1)

    advance(12) // past one request duration plus the margin
    expect(await provider.exchangeToken(input())).toMatchObject({
      ok: true,
      data: { accessToken: 'dlg-2' },
    })
    expect(exchanges()).toHaveLength(2)
  })

  it('a_joiner_that_is_answered_in_time_never_makes_a_second_request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    exchangeAnswer = (n) => gate.then(() => exchangeOk(n)) as never
    const provider = makeProvider()
    void provider.exchangeToken(input())
    const joiner = provider.exchangeToken(input())
    await exchangeCalled(1)
    release()

    expect(await joiner).toMatchObject({ ok: true })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(exchanges()).toHaveLength(1)
  })

  it('simultaneous_calls_with_another_subject_token_do_not_share_the_request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    exchangeAnswer = (n) => gate.then(() => exchangeOk(n)) as never
    const provider = makeProvider()

    const a = provider.exchangeToken(input({ subjectToken: 'a.b.c' }))
    const b = provider.exchangeToken(input({ subjectToken: 'd.e.f' }))
    await vi.waitFor(() => expect(exchanges()).toHaveLength(2))
    release()
    await Promise.all([a, b])

    expect(exchanges()).toHaveLength(2)
  })

  it('a_failed_in_flight_request_is_not_kept_for_the_next_call', async () => {
    exchangeAnswer = (n) =>
      n === 1 ? json(400, { error: 'invalid_grant' }) : exchangeOk(n)
    const provider = makeProvider()

    const [failed, shared] = await Promise.all([
      provider.exchangeToken(input()),
      provider.exchangeToken(input()),
    ])
    const next = await provider.exchangeToken(input())

    expect(failed.ok).toBe(false)
    expect(shared.ok).toBe(false)
    expect(next.ok).toBe(true)
    expect(exchanges()).toHaveLength(2)
  })

  it('does_not_cache_errors', async () => {
    exchangeAnswer = (n) =>
      n === 1
        ? json(400, {
            error: 'invalid_grant',
            error_description: 'session closed',
          })
        : exchangeOk(n)
    const provider = makeProvider()

    const failed = await provider.exchangeToken(input())
    const retried = await provider.exchangeToken(input())

    expect(failed.ok).toBe(false)
    expect(retried.ok).toBe(true)
    expect(exchanges()).toHaveLength(2)
  })

  it('is_per_provider_not_global', async () => {
    await makeProvider().exchangeToken(input())
    await makeProvider().exchangeToken(input())

    expect(exchanges()).toHaveLength(2)
  })

  it('is_bounded_and_drops_the_oldest_entry', async () => {
    const provider = makeProvider()
    for (let i = 0; i < 501; i++) {
      await provider.exchangeToken(input({ subjectToken: `t.${i}.s` }))
    }
    expect(exchanges()).toHaveLength(501)

    await provider.exchangeToken(input({ subjectToken: 't.0.s' })) // the oldest: evicted
    expect(exchanges()).toHaveLength(502)
    await provider.exchangeToken(input({ subjectToken: 't.500.s' })) // the newest: still there
    expect(exchanges()).toHaveLength(502)
  })
})

describe('error answers are Results with the RFC code', () => {
  it.each([
    'invalid_grant',
    'invalid_target',
    'invalid_scope',
    'invalid_request',
  ])('maps_%s_to_an_api_error', async (code) => {
    exchangeAnswer = () =>
      json(400, { error: code, error_description: `because ${code}` })

    const result = await makeProvider().exchangeToken(input())

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'api',
        code,
        message: `because ${code}`,
        status: 400,
      },
    })
  })

  it('maps_a_429_without_body_to_temporarily_unavailable', async () => {
    exchangeAnswer = () => ({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => {
        throw new Error('no body')
      },
    })

    const result = await makeProvider().exchangeToken(input())

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'api', code: 'temporarily_unavailable', status: 429 },
    })
  })

  it('maps_a_refusal_to_give_the_bearer_to_an_api_error', async () => {
    global.fetch = vi.fn(async (url: URL | string) =>
      String(url) === TOKEN_URL
        ? json(400, {
            error: 'invalid_scope',
            error_description: 'not granted',
          })
        : exchangeOk(1),
    ) as unknown as typeof fetch

    const result = await makeProvider().exchangeToken(input())

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'api', code: 'invalid_scope', status: 400 },
    })
  })

  it('maps_a_network_failure_to_an_sdk_error', async () => {
    exchangeAnswer = () => {
      throw new Error('socket closed')
    }

    const result = await makeProvider().exchangeToken(input())

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'sdk', reason: 'network', message: 'socket closed' },
    })
  })

  it('rejects_a_malformed_success_answer', async () => {
    exchangeAnswer = () =>
      json(200, { access_token: 'x', token_type: 'Bearer', expires_in: 120 })

    const result = await makeProvider().exchangeToken(input())

    expect(result).toMatchObject({ ok: false, error: { kind: 'api' } })
  })

  it('rejects_an_answer_whose_issued_token_type_is_not_an_access_token', async () => {
    exchangeAnswer = () =>
      json(200, {
        access_token: 'x',
        issued_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
        token_type: 'Bearer',
        expires_in: 120,
        scope: 'messages:send:text',
      })

    const result = await makeProvider().exchangeToken(input())

    expect(result.ok).toBe(false)
  })
})

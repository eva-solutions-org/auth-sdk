import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
} from '@eva_solutions/auth-contracts'
import { createClientIpForwarder } from '../src/client-ip-forwarding'

const IP = '203.0.113.7'
const TOKEN = 'service-token-secret'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const make = (over: Record<string, unknown> = {}) => {
  const getServiceToken = vi.fn(async () => TOKEN)
  const onError = vi.fn()
  const forward = createClientIpForwarder<void>({
    getClientIp: () => IP,
    getServiceToken,
    onError,
    ...over,
  })
  return { forward, getServiceToken, onError }
}

describe('createClientIpForwarder', () => {
  it('returns both headers together', async () => {
    const { forward } = make()
    expect(await forward()).toEqual({
      [SERVICE_TOKEN_HEADER]: TOKEN,
      [CLIENT_IP_HEADER]: IP,
    })
  })

  it('returns undefined without options', async () => {
    expect(await createClientIpForwarder<void>(undefined)()).toBeUndefined()
  })

  it('reports onError with code and status, never the token or the IP', async () => {
    const err = Object.assign(new Error(`${TOKEN} ${IP}`), { status: 503 })
    const { forward, onError } = make({
      getServiceToken: async () => {
        throw err
      },
    })
    expect(await forward()).toBeUndefined()
    expect(onError).toHaveBeenCalledWith({
      code: 'service_token_failed',
      status: 503,
    })
    expect(JSON.stringify(onError.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(onError.mock.calls)).not.toContain(IP)
  })

  it('survives a throwing or rejecting onError', async () => {
    const failing = (cb: () => unknown) =>
      make({
        getServiceToken: async () => {
          throw new Error('x')
        },
        onError: cb,
      }).forward
    expect(
      await failing(() => {
        throw new Error('cb')
      })(),
    ).toBeUndefined()
    expect(
      await failing(() => Promise.reject(new Error('cb')))(),
    ).toBeUndefined()
  })

  it('does not call getServiceToken again for 30 s after a failure', async () => {
    let fail = true
    const getServiceToken = vi.fn(async () => {
      if (fail) throw new Error('down')
      return TOKEN
    })
    const { forward } = make({ getServiceToken })
    await forward()
    fail = false
    expect(await forward()).toBeUndefined()
    expect(getServiceToken).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_001)
    expect(await forward()).toBeDefined()
    expect(getServiceToken).toHaveBeenCalledTimes(2)
  })

  it('keeps the back-off per instance', async () => {
    const a = make({
      getServiceToken: async () => {
        throw new Error('down')
      },
    })
    await a.forward()
    expect(await make().forward()).toBeDefined()
  })

  it('gives up after 2 s, reports a timeout and starts the back-off', async () => {
    const getServiceToken = vi.fn(() => new Promise<string>(() => {}))
    const { forward, onError } = make({ getServiceToken })
    const pending = forward()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(await pending).toBeUndefined()
    expect(onError).toHaveBeenCalledWith({
      code: 'service_token_timeout',
      status: undefined,
    })
    await forward()
    expect(getServiceToken).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a token that arrives in time', async () => {
    const { forward } = make({
      getServiceToken: () =>
        new Promise<string>((r) => setTimeout(() => r(TOKEN), 1_500)),
    })
    const pending = forward()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await pending).toBeDefined()
  })

  it('skips the token when there is no IP, and reports a throwing getClientIp', async () => {
    const none = make({ getClientIp: () => null })
    expect(await none.forward()).toBeUndefined()
    expect(none.getServiceToken).not.toHaveBeenCalled()
    expect(none.onError).not.toHaveBeenCalled()

    const boom = make({
      getClientIp: () => {
        throw new Error('x')
      },
    })
    expect(await boom.forward()).toBeUndefined()
    expect(boom.onError).toHaveBeenCalledWith({
      code: 'client_ip_failed',
      status: undefined,
    })
  })

  it.each(['1.2.3.4\r\nx-evil: 1', 'a b'])(
    'rejects an IP that is not a safe header value (%j)',
    async (ip) => {
      const { forward, getServiceToken } = make({ getClientIp: () => ip })
      expect(await forward()).toBeUndefined()
      expect(getServiceToken).not.toHaveBeenCalled()
    },
  )

  it('rejects a token that is not a safe header value', async () => {
    const { forward, onError } = make({ getServiceToken: async () => 'a\nb' })
    expect(await forward()).toBeUndefined()
    expect(onError).toHaveBeenCalledWith({
      code: 'service_token_failed',
      status: undefined,
    })
  })

  it('uses, inside the back-off, a token that arrived after the 2 s gave up', async () => {
    let release!: (t: string) => void
    const getServiceToken = vi.fn(
      () => new Promise<string>((r) => (release = r)),
    )
    const { forward, onError } = make({ getServiceToken })
    const first = forward()
    await vi.advanceTimersByTimeAsync(2_001)
    expect(await first).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    release(TOKEN) // the provider finished and cached it (5 s after the start)
    await vi.advanceTimersByTimeAsync(0)

    expect(await forward()).toEqual({
      [SERVICE_TOKEN_HEADER]: TOKEN,
      [CLIENT_IP_HEADER]: IP,
    })
    expect(getServiceToken).toHaveBeenCalledTimes(1) // no second request, no second wait
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('shares one instance (and its state) per options object', async () => {
    const options = {
      getClientIp: () => IP,
      getServiceToken: vi.fn(async (): Promise<string> => {
        throw new Error('down')
      }),
    }
    const a = createClientIpForwarder<void>(options)
    const b = createClientIpForwarder<void>(options)
    await a()
    expect(await b()).toBeUndefined()
    expect(options.getServiceToken).toHaveBeenCalledTimes(1)
  })
})

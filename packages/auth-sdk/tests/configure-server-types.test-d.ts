/**
 * `serviceCredentials` is mandatory on the server entries and absent from the react entry: a
 * secret must not be accepted (nor suggested by the types) in the browser.
 */
import { describe, it } from 'vitest'
import { configureEvaAuth as configureServer } from '../src/index'
import { configureEvaAuth as configureHono } from '../src/hono'
import { configureEvaAuth as configureGeneric } from '../src/generic'
import { configureEvaAuth as configureReact } from '../src/react'

describe('configureEvaAuth types', () => {
  it('the server entries require serviceCredentials (object or null)', () => {
    configureServer({ authUrl: 'https://auth.test', serviceCredentials: null })
    configureHono({
      authUrl: 'https://auth.test',
      serviceCredentials: { clientId: 'x', secretHex: 'ab' },
    })
    configureGeneric({ authUrl: 'https://auth.test', serviceCredentials: null })
    // @ts-expect-error serviceCredentials is required
    configureServer({ authUrl: 'https://auth.test' })
    // @ts-expect-error undefined is not the explicit discard
    configureHono({ serviceCredentials: undefined })
    // @ts-expect-error serviceCredentials is required
    configureGeneric({ product: 'whatsapp-panel' })
  })

  it('the server entries accept getClientIp and onClientIpForwardingError', () => {
    configureServer({
      serviceCredentials: null,
      getClientIp: (context) =>
        'req' in context ? context.req.header('x-real-ip') : null,
      onClientIpForwardingError: (info) => void info.code,
    })
  })

  it('the react entry takes the base options and no serviceCredentials', () => {
    configureReact({ authUrl: 'https://auth.test', product: 'whatsapp-panel' })
    // @ts-expect-error a secret never goes to the browser
    configureReact({ serviceCredentials: null })
    configureReact({
      // @ts-expect-error a secret never goes to the browser
      serviceCredentials: { clientId: 'x', secretHex: 'ab' },
    })
    // @ts-expect-error server only
    configureReact({ getClientIp: () => null })
  })
})

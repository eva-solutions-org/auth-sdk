/**
 * configureEvaAuth({ product }): slug format, immutable, and required
 * only by the code that needs it. Each test loads a fresh module (the config is module state).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshConfig() {
  vi.resetModules()
  return import('../src/config')
}

beforeEach(() => {
  vi.resetModules()
})

describe('configureEvaAuth product', () => {
  it('stores a valid product slug', async () => {
    const config = await freshConfig()

    config.configureEvaAuth({ product: 'whatsapp-panel' })

    expect(config.getProduct()).toBe('whatsapp-panel')
  })

  it.each(['', 'ab', 'Whatsapp-Panel', '1panel', 'my_panel', 'x'.repeat(65)])(
    'rejects the malformed slug %j',
    async (bad) => {
      const config = await freshConfig()

      expect(() => config.configureEvaAuth({ product: bad })).toThrow(
        /product inválido/,
      )
    },
  )

  it('is immutable: same value is a no-op, another value throws', async () => {
    const config = await freshConfig()
    config.configureEvaAuth({ product: 'whatsapp-panel' })

    expect(() =>
      config.configureEvaAuth({ product: 'whatsapp-panel' }),
    ).not.toThrow()
    expect(() => config.configureEvaAuth({ product: 'gym-panel' })).toThrow(
      /no puede cambiar/,
    )
    expect(config.getProduct()).toBe('whatsapp-panel')
  })

  it('an invalid product leaves the rest of the call unapplied (atomic)', async () => {
    const config = await freshConfig()

    expect(() =>
      config.configureEvaAuth({
        authUrl: 'https://auth.test',
        product: 'Bad Slug',
      }),
    ).toThrow()

    expect(() => config.getAuthUrl()).toThrow(/authUrl no configurada/)
  })

  it('omitting product does not reset or require it', async () => {
    const config = await freshConfig()
    config.configureEvaAuth({ product: 'whatsapp-panel' })

    config.configureEvaAuth({ authUrl: 'https://auth.test' })

    expect(config.getProduct()).toBe('whatsapp-panel')
  })

  it('getProduct without configuring throws the config error, not a generic one', async () => {
    const config = await freshConfig()
    config.configureEvaAuth({ authUrl: 'https://auth.test' })

    let thrown: unknown
    try {
      config.getProduct()
    } catch (err) {
      thrown = err
    }

    expect(config.isEvaAuthConfigError(thrown)).toBe(true)
  })

  it('a service that only verifies service tokens needs no product', async () => {
    const config = await freshConfig()
    config.configureEvaAuth({ authUrl: 'https://auth.test' })
    const { verifyServiceToken } = await import('../src/s2s/service-token')
    const { createLocalJWKSet } = await import('jose')

    const result = await verifyServiceToken('a.b.c', {
      audience: 'whatsapp-api',
      requiredScope: 'messages:send:text',
      jwks: createLocalJWKSet({ keys: [] }),
    })

    // Rejected as a token (malformed), never as a missing-product config error.
    expect(result.ok).toBe(false)
  })
})

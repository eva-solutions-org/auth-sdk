/**
 * Type tests para ConfigureEvaAuthOptions — authUrl en runtime (v3)
 *
 * REQ-SDK-01: configureEvaAuth acepta `authUrl?: string` (restaurado en v3.0.0; fue
 * eliminado en v2.0.0 cuando la URL se horneaba en build-time).
 * REQ-CFG-08: cookieDomain, errorMessages, errorWire siguen siendo aceptados.
 *
 * Patrón: @ts-expect-error como sentinel para validar que el typecheck falla cuando debe.
 * El test FALLA si la línea @ts-expect-error NO genera un error de TS.
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import { assertType } from 'vitest'
import type { ConfigureEvaAuthOptions } from '../src/config'
import { configureEvaAuth } from '../src/config'

// ─── REQ-SDK-01: authUrl existe como string opcional ─────────────────────────

describe('ConfigureEvaAuthOptions — authUrl en runtime (REQ-SDK-01)', () => {
  it('ConfigureEvaAuthOptions tiene authUrl opcional de tipo string', () => {
    type AU = ConfigureEvaAuthOptions['authUrl']
    expectTypeOf<AU>().toEqualTypeOf<string | undefined>()
  })

  it('configureEvaAuth acepta authUrl sin error de TypeScript', () => {
    assertType<void>(configureEvaAuth({ authUrl: 'https://x.com' }))
  })

  it('configureEvaAuth acepta authUrl junto con cookieDomain', () => {
    assertType<void>(configureEvaAuth({ authUrl: 'https://x.com', cookieDomain: '.example.com' }))
  })

  it('pasar authUrl como number produce error de TypeScript', () => {
    // @ts-expect-error — authUrl debe ser string
    configureEvaAuth({ authUrl: 42 })
  })
})

// ─── REQ-CFG-08: campos válidos siguen siendo aceptados ──────────────────────

describe('ConfigureEvaAuthOptions — campos válidos aceptados (REQ-CFG-08)', () => {
  it('cookieDomain es opcional y acepta string', () => {
    type CD = ConfigureEvaAuthOptions['cookieDomain']
    expectTypeOf<CD>().toEqualTypeOf<string | undefined>()
  })

  it('errorWire es opcional y acepta "api" | "string" | undefined', () => {
    type EW = ConfigureEvaAuthOptions['errorWire']
    expectTypeOf<EW>().toEqualTypeOf<'api' | 'string' | undefined>()
  })

  it('configureEvaAuth acepta objeto vacío sin error de TypeScript', () => {
    assertType<void>(configureEvaAuth({}))
  })

  it('configureEvaAuth acepta cookieDomain sin error de TypeScript', () => {
    assertType<void>(configureEvaAuth({ cookieDomain: '.example.com' }))
  })

  it('configureEvaAuth acepta errorWire sin error de TypeScript', () => {
    assertType<void>(configureEvaAuth({ errorWire: 'api' }))
  })

  it('configureEvaAuth acepta errorWire "string" sin error de TypeScript', () => {
    assertType<void>(configureEvaAuth({ errorWire: 'string' }))
  })
})

/**
 * Type tests para ConfigureEvaAuthOptions — v2.0.0
 *
 * REQ-CFG-01: configureEvaAuth NO acepta authUrl (campo eliminado en v2.0.0).
 * REQ-CFG-08: cookieDomain, errorMessages, errorWire siguen siendo aceptados.
 * NFR-04: error de compilación TS al pasar authUrl.
 *
 * Patrón: @ts-expect-error como sentinel para validar que el typecheck falla cuando debe.
 * El test FALLA si la línea @ts-expect-error NO genera un error de TS (campo inexistente).
 */
import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import { assertType } from 'vitest'
import type { ConfigureEvaAuthOptions } from '../src/config'
import { configureEvaAuth } from '../src/config'

// ─── REQ-CFG-01: authUrl fue eliminado — TypeScript rechaza el campo ──────────

describe('ConfigureEvaAuthOptions — authUrl eliminado (REQ-CFG-01)', () => {
  it('ConfigureEvaAuthOptions NO tiene propiedad authUrl', () => {
    // Si authUrl existiera en el tipo, esta línea de expect-type pasaría,
    // y el @ts-expect-error de abajo causaría error de compilación.
    // Al estar authUrl eliminado, el type no tiene esa propiedad.
    type HasAuthUrl = 'authUrl' extends keyof ConfigureEvaAuthOptions ? true : false
    expectTypeOf<HasAuthUrl>().toEqualTypeOf<false>()
  })

  it('pasar authUrl a configureEvaAuth produce error de TypeScript (REQ-CFG-01)', () => {
    // @ts-expect-error — authUrl no existe en ConfigureEvaAuthOptions (eliminado en v2.0.0)
    configureEvaAuth({ authUrl: 'https://x.com' })
  })

  it('pasar authUrl junto con cookieDomain produce error de TypeScript', () => {
    // @ts-expect-error — authUrl no existe en ConfigureEvaAuthOptions (eliminado en v2.0.0)
    configureEvaAuth({ authUrl: 'https://x.com', cookieDomain: '.example.com' })
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

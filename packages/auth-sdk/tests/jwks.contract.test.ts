/**
 * Test de contrato fail-closed — usa jose REAL (sin vi.mock('jose')).
 *
 * Valida que el comportamiento fail-closed de createRemoteJWKSet documentado en
 * ADR-016 y verificado en GOTCHA #3416 (jose 6.2.3 remote.js) sigue siendo correcto.
 *
 * Estos tests detectan regresión si jose cambia su comportamiento interno en upgrades.
 * No usan vi.mock('jose') — este archivo NO puede coexistir con los mocks globales
 * de jwks.mock.test.ts (D-03 del design). Por eso está en un archivo separado.
 *
 * ARQUITECTURA DE TESTS:
 *   S-FC-01, S-FC-02, S-FC-03 — Smoke tests de reload() directo.
 *     Verifican que el fetch failure se propaga correctamente cuando reload() es
 *     invocado DIRECTAMENTE. NO ejercitan la red de seguridad real de fresh().
 *     Son útiles para detectar cambios en la firma de reload(), pero NO prueban
 *     la garantía de ADR-016 (D-B02): cache expirado + endpoint caído → fail-closed.
 *
 *   S-FC-04 — Test de contrato REAL de fail-closed vía getKey() / jwtVerify().
 *     Este es el test que ejercita la garantía de seguridad de ADR-016:
 *     cache poblado → cacheMaxAge expirado → endpoint caído → getKey() detecta
 *     !fresh() → reload() → throw. NUNCA sirve clave stale.
 *     Usa generateKeyPair + SignJWT + jwtVerify con jose REAL para validar el
 *     path completo de autenticación, no solo reload() aislado.
 *
 * Cubre: REQ-FC-01, REQ-FC-02, REQ-FC-03, REQ-FC-04 (garantía real ADR-016)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createRemoteJWKSet,
  customFetch,
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
} from 'jose'

// JWKS con una clave EC P-256 mínima (objeto válido para la estructura JWKS de jose).
// No es una clave real verificable — solo necesitamos que jose la acepte como estructura
// para los smoke tests S-FC-01/02/03 que solo ejercitan reload() sin importar la clave.
const VALID_JWKS_BODY = JSON.stringify({
  keys: [
    {
      kty: 'EC',
      crv: 'P-256',
      kid: 'test-key-1',
      use: 'sig',
      alg: 'ES256',
      x: 'YHFqTHDu6gmOv3k9s4tC5bHZ6N3Y0K1pSEiDIrBq4KA',
      y: 'Zt1GaHjj0k5YpbNm2vRkQ2ZuSdVJTWPBHJKuFWrwBdI',
    },
  ],
})

describe('contrato fail-closed (jose real — sin mock de createRemoteJWKSet)', () => {
  it('S-FC-01: [smoke] reload() lanza cuando el endpoint devuelve HTTP 500 (REQ-FC-01)', async () => {
    // SMOKE TEST de reload() directo — NO ejercita la garantía de fresh() / getKey().
    // Verifica que el fetch failure se propaga desde reload() cuando se invoca directamente.
    // La garantía real de fail-closed (cache expirado + endpoint caído) está en S-FC-04.

    // customFetch que siempre retorna 500 — el fetch falla
    const failingFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'internal server error' }), {
        status: 500,
      }),
    )

    const jwksFn = createRemoteJWKSet(
      new URL('http://localhost:19999/.well-known/jwks.json'),
      {
        cacheMaxAge: 1, // 1ms — decorativo en este test; reload() no evalúa fresh()
        [customFetch]: failingFetch,
      },
    )

    // reload() internamente llama fetchJwks() → nuestro customFetch → 500 → JOSEError
    await expect(
      (jwksFn as unknown as { reload: () => Promise<void> }).reload(),
    ).rejects.toThrow()

    // Verificar que customFetch fue invocado (no se usó cache stale)
    expect(failingFetch).toHaveBeenCalled()
  }, 5_000)

  it('S-FC-02: [smoke] reload() lanza cuando fetch rechaza (timeout simulado — REQ-FC-02)', async () => {
    // SMOKE TEST de reload() directo — NO ejercita la garantía de fresh() / getKey().
    // Verifica que un rechazo de fetch (AbortError / timeout de red) se propaga desde reload().
    // La garantía real de fail-closed (cache expirado + endpoint caído) está en S-FC-04.

    // customFetch que rechaza con Error (simula AbortError / timeout de red)
    const timeoutFetch = vi.fn().mockRejectedValue(new Error('fetch timeout'))

    const jwksFn = createRemoteJWKSet(
      new URL('http://localhost:19998/.well-known/jwks.json'),
      {
        cacheMaxAge: 1, // 1ms — decorativo en este test; reload() no evalúa fresh()
        [customFetch]: timeoutFetch,
      },
    )

    // El primer reload() ya falla porque customFetch rechaza
    await expect(
      (jwksFn as unknown as { reload: () => Promise<void> }).reload(),
    ).rejects.toThrow()

    // Verificar que customFetch fue invocado (no se usó cache stale)
    expect(timeoutFetch).toHaveBeenCalled()
  }, 5_000)

  it('S-FC-03: [smoke] customFetch se invoca exactamente 1 vez cuando el cache está fresco (REQ-FC-03)', async () => {
    // SMOKE TEST de reload() directo — NO ejercita la garantía de fresh() / getKey().
    // Verifica que después del primer reload() el estado fresh() es true.
    // Nota: reload() siempre fetcha incondicionalmente; la evaluación de fresh()
    // solo ocurre en getKey(). Este test verifica el estado del cache, no el path
    // de seguridad. La garantía real de fail-closed vía fresh() está en S-FC-04.

    // customFetch que retorna JWKS válido en el primer fetch
    const successFetch = vi.fn().mockResolvedValue(
      new Response(VALID_JWKS_BODY, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const jwksFn = createRemoteJWKSet(
      new URL('http://localhost:19997/.well-known/jwks.json'),
      {
        cacheMaxAge: 3_600_000, // 1h — el cache permanece fresco durante el test
        [customFetch]: successFetch,
      },
    )

    // Primer reload — pobla el cache
    await (jwksFn as unknown as { reload: () => Promise<void> }).reload()

    // jwksFn.fresh debería ser true ahora
    expect((jwksFn as unknown as { fresh: boolean }).fresh).toBe(true)

    // remote.js: reload() hace fetch SIEMPRE (no verifica fresh()).
    // La verificación de fresh() está en getKey(), no en reload() directamente.
    // Por eso usamos la propiedad fresh para assertar el estado del cache.
    // El customFetch fue llamado exactamente 1 vez hasta ahora.
    expect(successFetch).toHaveBeenCalledTimes(1)
  }, 5_000)

  it('S-FC-04: fail-closed REAL vía getKey() — cache expirado + endpoint caído → jwtVerify lanza (REQ-FC-04 / ADR-016 D-B02)', async () => {
    // RED DE SEGURIDAD REAL de ADR-016 / D-B02.
    // Este test ejercita el path completo de seguridad que S-FC-01/02/03 NO cubren:
    //   1. getKey() con cache poblado y fresco → jwtVerify OK (warm path).
    //   2. Reloj avanzado más allá de cacheMaxAge → fresh() === false.
    //   3. Endpoint caído (customFetch devuelve 500).
    //   4. jwtVerify invoca jwksFn → getKey() → !fresh() → reload() → 500 → LANZA.
    //      NUNCA sirve la clave stale cacheada.
    //
    // Verificación de anti-regresión: si jose eliminara la comprobación !fresh() en
    // getKey() (línea 109 de remote.js), el paso 4 usaría la clave cacheada y el
    // test fallaría porque jwtVerify resolvería en lugar de rechazar.

    // Paso 0: generar par de claves EC P-256 reales para firmar/verificar tokens.
    const { privateKey, publicKey } = await generateKeyPair('ES256', {
      extractable: true,
    })
    const publicJwk = await exportJWK(publicKey)
    const kid = 'contract-test-key'

    const jwksBody = JSON.stringify({
      keys: [{ ...publicJwk, kid, use: 'sig', alg: 'ES256' }],
    })

    // customFetch con dos fases controladas por una bandera.
    let endpointDown = false
    const controlledFetch = vi.fn().mockImplementation(() => {
      if (endpointDown) {
        // Fase 2: endpoint caído → 500
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'service unavailable' }), {
            status: 500,
          }),
        )
      }
      // Fase 1: endpoint online → JWKS válido
      return Promise.resolve(
        new Response(jwksBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    // cacheMaxAge muy pequeño (50ms) para poder expirar con setSystemTime.
    const CACHE_MAX_AGE_MS = 50

    const jwksFn = createRemoteJWKSet(
      new URL('http://localhost:19996/.well-known/jwks.json'),
      {
        cacheMaxAge: CACHE_MAX_AGE_MS,
        [customFetch]: controlledFetch,
      },
    )

    // Paso 1: firmar un token con la clave privada generada.
    const token = await new SignJWT({ sub: 'test-subject' })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    // Paso 1b: jwtVerify con el endpoint online → pobla el cache vía getKey().
    // getKey() llama reload() (porque !this.#local), fetchea, jwksTimestamp se setea.
    await expect(
      jwtVerify(token, jwksFn, { algorithms: ['ES256'] }),
    ).resolves.toBeDefined()

    // Verificar que el cache está fresco después del primer verify.
    expect((jwksFn as unknown as { fresh: boolean }).fresh).toBe(true)
    const fetchCountAfterWarm = controlledFetch.mock.calls.length
    expect(fetchCountAfterWarm).toBeGreaterThanOrEqual(1)

    // Paso 2: avanzar el reloj más allá de cacheMaxAge → fresh() === false.
    // getKey() evaluará !fresh() → true → llamará reload().
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + CACHE_MAX_AGE_MS + 100)

    try {
      // Verificar que fresh() ahora es false (cache expirado).
      expect((jwksFn as unknown as { fresh: boolean }).fresh).toBe(false)

      // Paso 3: simular que el endpoint está caído.
      endpointDown = true

      // Paso 4: jwtVerify invoca jwksFn → getKey() → !fresh() → reload() → 500 → LANZA.
      // GARANTÍA DE ADR-016: no sirve la clave stale aunque esté en cache.
      await expect(
        jwtVerify(token, jwksFn, { algorithms: ['ES256'] }),
      ).rejects.toThrow()

      // El customFetch fue invocado al menos una vez más (el reload() post-expiración).
      expect(controlledFetch.mock.calls.length).toBeGreaterThan(
        fetchCountAfterWarm,
      )
    } finally {
      // Restaurar timers reales siempre, incluso si el test falla.
      vi.useRealTimers()
    }
  }, 10_000)
})

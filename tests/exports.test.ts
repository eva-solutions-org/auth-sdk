/**
 * T-036 + GAP-01 + Batch-14: Valida que todos los símbolos públicos nuevos están correctamente
 * exportados desde src/index.ts (entry point raíz @eva/auth-sdk).
 *
 * REQ-EXPORTS-01 LOCKED: error types + error-codes + getMessage disponibles
 * desde el entry point raíz.
 * REQ-EXPORTS-02 (GAP-01): webhooks + admin + s2s accesibles desde raíz.
 * Batch-14 (G1..G7): nuevos exports de constantes catalogadas.
 *
 * Cubre:
 * - ERROR_CODES: runtime object con 12 entries
 * - SDK_ERROR_REASONS: runtime object con 6 entries
 * - getMessage: función helper
 * - EvaApiError / EvaSdkError / EvaError: tipos (importables como type)
 * - CoreErrorCode / ErrorCode / SdkErrorReason: tipos (importables como type)
 * - Webhooks: EVENT_CODES, verifyWebhookSignature, WEBHOOK_TIMESTAMP_WINDOW_SECONDS, WEBHOOK_HEADERS
 * - Admin: createAdminClient, ADMIN_ERROR_CODES
 * - S2S: createS2SClient, signS2SRequest, buildS2SCanonicalString, EMPTY_BODY_SHA256_HEX,
 *        S2S_TIMESTAMP_WINDOW_SECONDS, S2S_SCOPES, S2S_RESPONSE_HEADERS, USERS_BATCH_MAX_IDS
 * - Root: ACCOUNT_STATES
 */
import { describe, it, expect } from 'vitest'
import {
  // Runtime values — nuevos
  ERROR_CODES,
  SDK_ERROR_REASONS,
  getMessage,
  // Webhooks
  EVENT_CODES,
  verifyWebhookSignature,
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
  WEBHOOK_HEADERS,
  // Admin
  createAdminClient,
  ADMIN_ERROR_CODES,
  // S2S
  createS2SClient,
  signS2SRequest,
  buildS2SCanonicalString,
  EMPTY_BODY_SHA256_HEX,
  S2S_TIMESTAMP_WINDOW_SECONDS,
  S2S_SCOPES,
  S2S_RESPONSE_HEADERS,
  USERS_BATCH_MAX_IDS,
  // S2S server-side — v1.1.0 (REQ-API-06)
  verifyS2SRequest,
  // Account states (G1)
  ACCOUNT_STATES,
  // Runtime values — preexistentes (regresión: no deben haberse roto)
  HEADERS,
  COOKIES,
  COOKIE_MAX_AGE,
  JWT_CONFIG,
  DEFAULT_ERROR_MESSAGES,
  readTokensFromCookies,
  configureEvaAuth,
  getPublicKey,
  fetchJwks,
  clearJwksCache,
  verifyAccessToken,
  createHttpClient,
  createEvaAuth,
  getAuthUrl,
  getEvaEnv,
  getCookieDomain,
} from '../src/index'

// Hono S2S exports — from hono barrel (REQ-API-02,03,05)
import { s2sAuth, requireScope } from '../src/hono'

// ──────────────────────────────────────────────────────────────────────────────
// ERROR_CODES
// ──────────────────────────────────────────────────────────────────────────────

describe('ERROR_CODES export (REQ-ERR-01, REQ-ERR-02)', () => {
  it('existe y es un objeto', () => {
    expect(ERROR_CODES).toBeDefined()
    expect(typeof ERROR_CODES).toBe('object')
  })

  it('tiene exactamente 12 entries', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(12)
  })

  it('contiene los 12 error codes del Auth Service', () => {
    expect(ERROR_CODES.account_state_locked).toBe('account_state_locked')
    expect(ERROR_CODES.unauthorized).toBe('unauthorized')
    expect(ERROR_CODES.validation_error).toBe('validation_error')
    expect(ERROR_CODES.not_found).toBe('not_found')
    expect(ERROR_CODES.conflict).toBe('conflict')
    expect(ERROR_CODES.forbidden).toBe('forbidden')
    expect(ERROR_CODES.rate_limited).toBe('rate_limited')
    expect(ERROR_CODES.gone).toBe('gone')
    expect(ERROR_CODES.unprocessable_entity).toBe('unprocessable_entity')
    expect(ERROR_CODES.bad_request).toBe('bad_request')
    expect(ERROR_CODES.internal_error).toBe('internal_error')
    expect(ERROR_CODES.service_unavailable).toBe('service_unavailable')
  })

  it('los valores son iguales a sus keys (as const)', () => {
    for (const [k, v] of Object.entries(ERROR_CODES)) {
      expect(v).toBe(k)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// SDK_ERROR_REASONS
// ──────────────────────────────────────────────────────────────────────────────

describe('SDK_ERROR_REASONS export (REQ-ERR-06, REQ-ERR-07)', () => {
  it('existe y es un objeto', () => {
    expect(SDK_ERROR_REASONS).toBeDefined()
    expect(typeof SDK_ERROR_REASONS).toBe('object')
  })

  it('tiene exactamente 6 entries', () => {
    expect(Object.keys(SDK_ERROR_REASONS)).toHaveLength(6)
  })

  it('contiene los 6 SDK error reasons', () => {
    expect(SDK_ERROR_REASONS.auth_required).toBe('auth_required')
    expect(SDK_ERROR_REASONS.token_invalid).toBe('token_invalid')
    expect(SDK_ERROR_REASONS.refresh_no_tokens).toBe('refresh_no_tokens')
    expect(SDK_ERROR_REASONS.verify_failed).toBe('verify_failed')
    expect(SDK_ERROR_REASONS.network).toBe('network')
    expect(SDK_ERROR_REASONS.malformed).toBe('malformed')
  })

  it('los valores son iguales a sus keys (as const)', () => {
    for (const [k, v] of Object.entries(SDK_ERROR_REASONS)) {
      expect(v).toBe(k)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// getMessage helper
// ──────────────────────────────────────────────────────────────────────────────

describe('getMessage export (REQ-ERR-11)', () => {
  it('existe y es una función', () => {
    expect(getMessage).toBeDefined()
    expect(typeof getMessage).toBe('function')
  })

  it('retorna el message de un EvaApiError', () => {
    const err = { kind: 'api' as const, code: 'unauthorized', message: 'No autorizado', status: 401 }
    expect(getMessage(err)).toBe('No autorizado')
  })

  it('retorna el message de un EvaSdkError', () => {
    const err = { kind: 'sdk' as const, reason: 'auth_required' as const, message: 'Sin tokens', status: 401 }
    expect(getMessage(err)).toBe('Sin tokens')
  })

  it('funciona como alternativa a result.error.message', () => {
    const result = { ok: false as const, error: { kind: 'api' as const, code: 'bad_request', message: 'Teléfono inválido', status: 400 } }
    expect(getMessage(result.error)).toBe(result.error.message)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Regresión: exports preexistentes no rotos por T-035
// ──────────────────────────────────────────────────────────────────────────────

describe('exports preexistentes — regresión (T-035 no rompió nada)', () => {
  it('HEADERS existe y tiene AUTHORIZATION', () => {
    expect(HEADERS).toBeDefined()
    expect(typeof HEADERS.AUTHORIZATION).toBe('string')
  })

  it('COOKIES existe y tiene ACCESS_TOKEN y REFRESH_TOKEN', () => {
    expect(COOKIES.ACCESS_TOKEN).toBe('eva_access_token')
    expect(COOKIES.REFRESH_TOKEN).toBe('eva_refresh_token')
  })

  it('COOKIE_MAX_AGE existe y tiene ACCESS_TOKEN y REFRESH_TOKEN', () => {
    expect(COOKIE_MAX_AGE).toBeDefined()
    expect(typeof COOKIE_MAX_AGE.ACCESS_TOKEN).toBe('number')
    expect(typeof COOKIE_MAX_AGE.REFRESH_TOKEN).toBe('number')
  })

  it('JWT_CONFIG existe', () => {
    expect(JWT_CONFIG).toBeDefined()
  })

  it('DEFAULT_ERROR_MESSAGES existe y tiene 16 keys', () => {
    expect(DEFAULT_ERROR_MESSAGES).toBeDefined()
    expect(Object.keys(DEFAULT_ERROR_MESSAGES)).toHaveLength(16)
  })

  it('readTokensFromCookies es función', () => {
    expect(typeof readTokensFromCookies).toBe('function')
  })

  it('configureEvaAuth es función', () => {
    expect(typeof configureEvaAuth).toBe('function')
  })

  it('getPublicKey / fetchJwks / clearJwksCache son funciones', () => {
    expect(typeof getPublicKey).toBe('function')
    expect(typeof fetchJwks).toBe('function')
    expect(typeof clearJwksCache).toBe('function')
  })

  it('verifyAccessToken es función', () => {
    expect(typeof verifyAccessToken).toBe('function')
  })

  it('createHttpClient es función', () => {
    expect(typeof createHttpClient).toBe('function')
  })

  it('createEvaAuth es función', () => {
    expect(typeof createEvaAuth).toBe('function')
  })

  it('getAuthUrl / getEvaEnv / getCookieDomain son funciones', () => {
    expect(typeof getAuthUrl).toBe('function')
    expect(typeof getEvaEnv).toBe('function')
    expect(typeof getCookieDomain).toBe('function')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GAP-01: Módulo webhooks accesible desde raíz (REQ-EXPORTS-02)
// ──────────────────────────────────────────────────────────────────────────────

describe('webhooks exports desde raíz (GAP-01, REQ-EXPORTS-02)', () => {
  it('EVENT_CODES existe y es un objeto', () => {
    expect(EVENT_CODES).toBeDefined()
    expect(typeof EVENT_CODES).toBe('object')
  })

  it('verifyWebhookSignature es función', () => {
    expect(typeof verifyWebhookSignature).toBe('function')
  })

  it('WEBHOOK_TIMESTAMP_WINDOW_SECONDS es número', () => {
    expect(typeof WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBe('number')
    expect(WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBeGreaterThan(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GAP-01: Módulo admin accesible desde raíz (REQ-EXPORTS-02)
// ──────────────────────────────────────────────────────────────────────────────

describe('admin exports desde raíz (GAP-01, REQ-EXPORTS-02)', () => {
  it('createAdminClient es función', () => {
    expect(typeof createAdminClient).toBe('function')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GAP-01: Módulo S2S accesible desde raíz (REQ-EXPORTS-02)
// ──────────────────────────────────────────────────────────────────────────────

describe('s2s exports desde raíz (GAP-01, REQ-EXPORTS-02)', () => {
  it('createS2SClient es función', () => {
    expect(typeof createS2SClient).toBe('function')
  })

  it('signS2SRequest es función', () => {
    expect(typeof signS2SRequest).toBe('function')
  })

  it('buildS2SCanonicalString es función', () => {
    expect(typeof buildS2SCanonicalString).toBe('function')
  })

  it('EMPTY_BODY_SHA256_HEX es string no vacío', () => {
    expect(typeof EMPTY_BODY_SHA256_HEX).toBe('string')
    expect(EMPTY_BODY_SHA256_HEX.length).toBeGreaterThan(0)
  })

  it('S2S_TIMESTAMP_WINDOW_SECONDS es número', () => {
    expect(typeof S2S_TIMESTAMP_WINDOW_SECONDS).toBe('number')
    expect(S2S_TIMESTAMP_WINDOW_SECONDS).toBeGreaterThan(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G1: ACCOUNT_STATES accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('ACCOUNT_STATES export (Batch-14 G1)', () => {
  it('existe y es un objeto', () => {
    expect(ACCOUNT_STATES).toBeDefined()
    expect(typeof ACCOUNT_STATES).toBe('object')
  })

  it('tiene exactamente 6 entries', () => {
    expect(Object.keys(ACCOUNT_STATES)).toHaveLength(6)
  })

  it('contiene los 6 estados de cuenta', () => {
    expect(ACCOUNT_STATES.no_verificado).toBe('no_verificado')
    expect(ACCOUNT_STATES.verificado).toBe('verificado')
    expect(ACCOUNT_STATES.pendiente_de_verificacion).toBe('pendiente_de_verificacion')
    expect(ACCOUNT_STATES.suspendido).toBe('suspendido')
    expect(ACCOUNT_STATES.baneado).toBe('baneado')
    expect(ACCOUNT_STATES.eliminado).toBe('eliminado')
  })

  it('los valores son iguales a sus keys (as const)', () => {
    for (const [k, v] of Object.entries(ACCOUNT_STATES)) {
      expect(v).toBe(k)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G2: WEBHOOK_HEADERS accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('WEBHOOK_HEADERS export (Batch-14 G2)', () => {
  it('existe y es un objeto', () => {
    expect(WEBHOOK_HEADERS).toBeDefined()
    expect(typeof WEBHOOK_HEADERS).toBe('object')
  })

  it('tiene SIGNATURE, ID y TIMESTAMP con valores correctos', () => {
    expect(WEBHOOK_HEADERS.SIGNATURE).toBe('x-eva-webhook-signature')
    expect(WEBHOOK_HEADERS.ID).toBe('x-eva-webhook-id')
    expect(WEBHOOK_HEADERS.TIMESTAMP).toBe('x-eva-webhook-timestamp')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G3: S2S_SCOPES accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('S2S_SCOPES export (Batch-14 G3)', () => {
  it('existe y es un objeto', () => {
    expect(S2S_SCOPES).toBeDefined()
    expect(typeof S2S_SCOPES).toBe('object')
  })

  it('tiene los 3 scopes correctos', () => {
    expect(S2S_SCOPES.USERS_READ).toBe('users:read')
    expect(S2S_SCOPES.WEBHOOKS_READ).toBe('webhooks:read')
    expect(S2S_SCOPES.WEBHOOKS_WRITE).toBe('webhooks:write')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G4: ADMIN_ERROR_CODES accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('ADMIN_ERROR_CODES export (Batch-14 G4)', () => {
  it('existe y es un objeto', () => {
    expect(ADMIN_ERROR_CODES).toBeDefined()
    expect(typeof ADMIN_ERROR_CODES).toBe('object')
  })

  it('tiene service_client_already_exists y service_client_not_found', () => {
    expect(ADMIN_ERROR_CODES.service_client_already_exists).toBe('service_client_already_exists')
    expect(ADMIN_ERROR_CODES.service_client_not_found).toBe('service_client_not_found')
  })

  it('los valores son iguales a sus keys (as const)', () => {
    for (const [k, v] of Object.entries(ADMIN_ERROR_CODES)) {
      expect(v).toBe(k)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G5: USERS_BATCH_MAX_IDS accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('USERS_BATCH_MAX_IDS export (Batch-14 G5)', () => {
  it('existe y es 100', () => {
    expect(USERS_BATCH_MAX_IDS).toBe(100)
    expect(typeof USERS_BATCH_MAX_IDS).toBe('number')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Batch-14 G7: S2S_RESPONSE_HEADERS accesible desde raíz
// ──────────────────────────────────────────────────────────────────────────────

describe('S2S_RESPONSE_HEADERS export (Batch-14 G7)', () => {
  it('existe y es un objeto', () => {
    expect(S2S_RESPONSE_HEADERS).toBeDefined()
    expect(typeof S2S_RESPONSE_HEADERS).toBe('object')
  })

  it('tiene SERVER_TIME con valor correcto', () => {
    expect(S2S_RESPONSE_HEADERS.SERVER_TIME).toBe('x-eva-server-time')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// v1.1.0: verifyS2SRequest exportado desde barrel raíz (REQ-API-06, T-015)
// ──────────────────────────────────────────────────────────────────────────────

describe('verifyS2SRequest export desde raíz (v1.1.0, REQ-API-06)', () => {
  it('verifyS2SRequest es función', () => {
    expect(verifyS2SRequest).toBeDefined()
    expect(typeof verifyS2SRequest).toBe('function')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// v1.1.0: s2sAuth y requireScope exportados desde barrel hono (REQ-API-02,03, T-015)
// ──────────────────────────────────────────────────────────────────────────────

describe('s2sAuth y requireScope desde barrel hono (v1.1.0, REQ-API-02,03)', () => {
  it('s2sAuth es función', () => {
    expect(s2sAuth).toBeDefined()
    expect(typeof s2sAuth).toBe('function')
  })

  it('requireScope es función', () => {
    expect(requireScope).toBeDefined()
    expect(typeof requireScope).toBe('function')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// v1.1.0: s2sAuth y requireScope NO exportados desde barrel raíz (REQ-API-07, T-015)
// ──────────────────────────────────────────────────────────────────────────────

describe('s2sAuth y requireScope NO exportados desde barrel raíz (REQ-API-07)', () => {
  it('s2sAuth no está en el barrel raíz (src/index)', async () => {
    // Si src/index exportara s2sAuth, el import dinámico lo incluiría.
    // Verificamos que no está presente como export nombrado en src/index.
    const rootModule = await import('../src/index')
    expect((rootModule as Record<string, unknown>)['s2sAuth']).toBeUndefined()
  })

  it('requireScope no está en el barrel raíz (src/index)', async () => {
    const rootModule = await import('../src/index')
    expect((rootModule as Record<string, unknown>)['requireScope']).toBeUndefined()
  })
})

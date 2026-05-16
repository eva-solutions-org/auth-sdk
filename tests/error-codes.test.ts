/**
 * Tests unitarios para src/error-codes.ts y src/schemas.ts (parseErrorResponse).
 * REQs cubiertos: REQ-ERR-01, REQ-ERR-02, REQ-ERR-08, REQ-ERR-09, REQ-ERR-10, REQ-SCHEMA-01, REQ-SCHEMA-02.
 */
import { describe, it, expect } from 'vitest'
import {
  ERROR_CODES,
  SDK_ERROR_REASONS,
} from '../src/error-codes'
import { parseErrorResponse } from '../src/schemas'

// ─── ERROR_CODES ───────────────────────────────────────────────────────────────

describe('ERROR_CODES', () => {
  it('tiene exactamente 12 entries (REQ-ERR-01)', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(12)
  })

  it('incluye account_state_locked (D-07 LOCKED — replica runtime del API)', () => {
    expect(ERROR_CODES.account_state_locked).toBe('account_state_locked')
  })

  it('incluye los 11 codes base (REQ-ERR-02)', () => {
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

  it('es inmutable (as const)', () => {
    // Verificar que el objeto no tiene valor 'undefined' en ninguna key
    for (const value of Object.values(ERROR_CODES)) {
      expect(typeof value).toBe('string')
    }
  })

  it('cada valor es igual a su key (espejo del API)', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key)
    }
  })
})

// ─── SDK_ERROR_REASONS ─────────────────────────────────────────────────────────

describe('SDK_ERROR_REASONS', () => {
  it('tiene exactamente 6 entries (REQ-ERR-06)', () => {
    expect(Object.keys(SDK_ERROR_REASONS)).toHaveLength(6)
  })

  it('incluye los 6 reasons internos', () => {
    expect(SDK_ERROR_REASONS.auth_required).toBe('auth_required')
    expect(SDK_ERROR_REASONS.token_invalid).toBe('token_invalid')
    expect(SDK_ERROR_REASONS.refresh_no_tokens).toBe('refresh_no_tokens')
    expect(SDK_ERROR_REASONS.verify_failed).toBe('verify_failed')
    expect(SDK_ERROR_REASONS.network).toBe('network')
    expect(SDK_ERROR_REASONS.malformed).toBe('malformed')
  })

  it('cada valor es igual a su key', () => {
    for (const [key, value] of Object.entries(SDK_ERROR_REASONS)) {
      expect(value).toBe(key)
    }
  })
})

// ─── parseErrorResponse ────────────────────────────────────────────────────────

describe('parseErrorResponse (REQ-ERR-08, REQ-ERR-09, REQ-ERR-10, REQ-SCHEMA-01, REQ-SCHEMA-02)', () => {
  describe('status === 0 → EvaSdkError reason:network', () => {
    it('retorna kind:sdk, reason:network, status:0', () => {
      const result = parseErrorResponse(0, null)
      expect(result.kind).toBe('sdk')
      expect(result.status).toBe(0)
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('network')
      }
    })

    it('ignora el body cuando status es 0', () => {
      const result = parseErrorResponse(0, { error: { code: 'x', message: 'y' } })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('network')
      }
    })
  })

  describe('body null o undefined → EvaSdkError reason:malformed', () => {
    it('body null retorna malformed con el status dado', () => {
      const result = parseErrorResponse(500, null)
      expect(result.kind).toBe('sdk')
      expect(result.status).toBe(500)
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body undefined retorna malformed con el status dado', () => {
      const result = parseErrorResponse(400, undefined)
      expect(result.kind).toBe('sdk')
      expect(result.status).toBe(400)
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })
  })

  describe('body con shape válido { error: { code, message } } → EvaApiError', () => {
    it('retorna kind:api con code y message del wire', () => {
      const body = { error: { code: 'unauthorized', message: 'Unauthorized' } }
      const result = parseErrorResponse(401, body)
      expect(result.kind).toBe('api')
      expect(result.status).toBe(401)
      if (result.kind === 'api') {
        expect(result.code).toBe('unauthorized')
        expect(result.message).toBe('Unauthorized')
      }
    })

    it('preserva feature-specific codes (ErrorCode abierto)', () => {
      const body = { error: { code: 'service_client_already_exists', message: 'Already exists' } }
      const result = parseErrorResponse(409, body)
      expect(result.kind).toBe('api')
      if (result.kind === 'api') {
        expect(result.code).toBe('service_client_already_exists')
      }
    })

    it('preserva el status HTTP correcto', () => {
      const body = { error: { code: 'not_found', message: 'Not found' } }
      const result = parseErrorResponse(404, body)
      expect(result.status).toBe(404)
    })
  })

  describe('body con shape incorrecto → EvaSdkError reason:malformed', () => {
    it('body string (no objeto) → malformed', () => {
      const result = parseErrorResponse(500, 'error string')
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body objeto sin key error → malformed', () => {
      const result = parseErrorResponse(500, { message: 'algo' })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body con error como string (shape 0.x) → malformed', () => {
      // El API 0.x emitía { error: "mensaje" }. Con el nuevo schema esto es malformed.
      const result = parseErrorResponse(401, { error: 'Unauthorized' })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body con error.code faltante → malformed', () => {
      const result = parseErrorResponse(400, { error: { message: 'Only message' } })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body con error.message faltante → malformed', () => {
      const result = parseErrorResponse(400, { error: { code: 'only_code' } })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })

    it('body null-like con error:null → malformed', () => {
      const result = parseErrorResponse(500, { error: null })
      expect(result.kind).toBe('sdk')
      if (result.kind === 'sdk') {
        expect(result.reason).toBe('malformed')
      }
    })
  })
})

/**
 * Tests para src/error-helpers.ts
 * Cobertura 100%: branch guards, generic matchers, 12 atajos API, 6 atajos SDK.
 * Incluye casos positivos, negativos (branch opuesto) y cruzados.
 */

import { describe, expect, it } from 'vitest'
import {
  isApiError,
  isAuthRequired,
  isBadRequest,
  isConflict,
  isForbidden,
  isGone,
  isInternalError,
  isMalformed,
  isNetworkError,
  isNotFound,
  isRateLimited,
  isRefreshNoTokens,
  isServiceUnavailable,
  isSdkError,
  isAccountStateLocked,
  isTokenInvalid,
  isUnauthorized,
  isUnprocessableEntity,
  isValidationError,
  isVerifyFailed,
  matchError,
  matchSdkReason,
} from '../src/error-helpers'
import type { EvaApiError, EvaSdkError, EvaError } from '../src/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const apiNotFound: EvaApiError = { kind: 'api', code: 'not_found', message: 'Not found', status: 404 }
const apiUnauthorized: EvaApiError = { kind: 'api', code: 'unauthorized', message: 'Unauthorized', status: 401 }
const apiForbidden: EvaApiError = { kind: 'api', code: 'forbidden', message: 'Forbidden', status: 403 }
const apiConflict: EvaApiError = { kind: 'api', code: 'conflict', message: 'Conflict', status: 409 }
const apiValidationError: EvaApiError = { kind: 'api', code: 'validation_error', message: 'Invalid', status: 422 }
const apiRateLimited: EvaApiError = { kind: 'api', code: 'rate_limited', message: 'Rate limited', status: 429 }
const apiGone: EvaApiError = { kind: 'api', code: 'gone', message: 'Gone', status: 410 }
const apiUnprocessableEntity: EvaApiError = { kind: 'api', code: 'unprocessable_entity', message: 'Unprocessable', status: 422 }
const apiBadRequest: EvaApiError = { kind: 'api', code: 'bad_request', message: 'Bad request', status: 400 }
const apiInternalError: EvaApiError = { kind: 'api', code: 'internal_error', message: 'Internal error', status: 500 }
const apiServiceUnavailable: EvaApiError = { kind: 'api', code: 'service_unavailable', message: 'Service unavailable', status: 503 }
const apiAccountStateLocked: EvaApiError = { kind: 'api', code: 'account_state_locked', message: 'Account locked', status: 403 }
const apiFeatureSpecific: EvaApiError = { kind: 'api', code: 'service_client_already_exists', message: 'Already exists', status: 409 }

const sdkNetwork: EvaSdkError = { kind: 'sdk', reason: 'network', message: 'Network error', status: 0 }
const sdkTokenInvalid: EvaSdkError = { kind: 'sdk', reason: 'token_invalid', message: 'Token invalid', status: 401 }
const sdkAuthRequired: EvaSdkError = { kind: 'sdk', reason: 'auth_required', message: 'Auth required', status: 401 }
const sdkRefreshNoTokens: EvaSdkError = { kind: 'sdk', reason: 'refresh_no_tokens', message: 'No tokens', status: 500 }
const sdkVerifyFailed: EvaSdkError = { kind: 'sdk', reason: 'verify_failed', message: 'Verify failed', status: 500 }
const sdkMalformed: EvaSdkError = { kind: 'sdk', reason: 'malformed', message: 'Malformed', status: 0 }

// ---------------------------------------------------------------------------
// Branch guards
// ---------------------------------------------------------------------------

describe('isApiError', () => {
  it('retorna true para EvaApiError', () => {
    expect(isApiError(apiNotFound)).toBe(true)
  })

  it('retorna false para EvaSdkError', () => {
    expect(isApiError(sdkNetwork)).toBe(false)
  })

  it('narrows a EvaApiError — acceso a .code disponible en el bloque if', () => {
    const err: EvaError = apiNotFound
    if (isApiError(err)) {
      // Si TS no narrows correctamente, esto falla en typecheck
      const code: string = err.code
      expect(code).toBe('not_found')
    }
  })
})

describe('isSdkError', () => {
  it('retorna true para EvaSdkError', () => {
    expect(isSdkError(sdkNetwork)).toBe(true)
  })

  it('retorna false para EvaApiError', () => {
    expect(isSdkError(apiNotFound)).toBe(false)
  })

  it('narrows a EvaSdkError — acceso a .reason disponible en el bloque if', () => {
    const err: EvaError = sdkNetwork
    if (isSdkError(err)) {
      const reason: string = err.reason
      expect(reason).toBe('network')
    }
  })
})

// ---------------------------------------------------------------------------
// Generic matchers
// ---------------------------------------------------------------------------

describe('matchError', () => {
  it('retorna true para EvaApiError con code exacto', () => {
    expect(matchError(apiConflict, 'conflict')).toBe(true)
  })

  it('retorna false para EvaApiError con code distinto', () => {
    expect(matchError(apiNotFound, 'conflict')).toBe(false)
  })

  it('retorna false para EvaSdkError (no es api)', () => {
    expect(matchError(sdkNetwork, 'conflict')).toBe(false)
  })

  it('funciona con feature-specific codes (semiabierto)', () => {
    expect(matchError(apiFeatureSpecific, 'service_client_already_exists')).toBe(true)
  })

  it('narrows code literal dentro del if', () => {
    const err: EvaError = apiNotFound
    if (matchError(err, 'not_found')) {
      // TS debe permitir acceder a err.code como literal 'not_found'
      expect(err.code).toBe('not_found')
    }
  })
})

describe('matchSdkReason', () => {
  it('retorna true para EvaSdkError con reason exacto', () => {
    expect(matchSdkReason(sdkNetwork, 'network')).toBe(true)
  })

  it('retorna false para EvaSdkError con reason distinto', () => {
    expect(matchSdkReason(sdkTokenInvalid, 'network')).toBe(false)
  })

  it('retorna false para EvaApiError (no es sdk)', () => {
    expect(matchSdkReason(apiNotFound, 'network')).toBe(false)
  })

  it('narrows reason literal dentro del if', () => {
    const err: EvaError = sdkNetwork
    if (matchSdkReason(err, 'network')) {
      expect(err.reason).toBe('network')
    }
  })
})

// ---------------------------------------------------------------------------
// API shortcut predicates (12)
// ---------------------------------------------------------------------------

describe('isNotFound', () => {
  it('positivo: not_found', () => {
    expect(isNotFound(apiNotFound)).toBe(true)
  })
  it('negativo: otro code api', () => {
    expect(isNotFound(apiUnauthorized)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isNotFound(sdkNetwork)).toBe(false)
  })
  it('narrows .code a literal not_found', () => {
    if (isNotFound(apiNotFound)) {
      expect(apiNotFound.code).toBe('not_found')
    }
  })
})

describe('isUnauthorized', () => {
  it('positivo: unauthorized', () => {
    expect(isUnauthorized(apiUnauthorized)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isUnauthorized(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isUnauthorized(sdkNetwork)).toBe(false)
  })
})

describe('isForbidden', () => {
  it('positivo: forbidden', () => {
    expect(isForbidden(apiForbidden)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isForbidden(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isForbidden(sdkNetwork)).toBe(false)
  })
})

describe('isConflict', () => {
  it('positivo: conflict', () => {
    expect(isConflict(apiConflict)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isConflict(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isConflict(sdkNetwork)).toBe(false)
  })
})

describe('isValidationError', () => {
  it('positivo: validation_error', () => {
    expect(isValidationError(apiValidationError)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isValidationError(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isValidationError(sdkNetwork)).toBe(false)
  })
})

describe('isRateLimited', () => {
  it('positivo: rate_limited', () => {
    expect(isRateLimited(apiRateLimited)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isRateLimited(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isRateLimited(sdkNetwork)).toBe(false)
  })
})

describe('isGone', () => {
  it('positivo: gone', () => {
    expect(isGone(apiGone)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isGone(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isGone(sdkNetwork)).toBe(false)
  })
})

describe('isUnprocessableEntity', () => {
  it('positivo: unprocessable_entity', () => {
    expect(isUnprocessableEntity(apiUnprocessableEntity)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isUnprocessableEntity(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isUnprocessableEntity(sdkNetwork)).toBe(false)
  })
})

describe('isBadRequest', () => {
  it('positivo: bad_request', () => {
    expect(isBadRequest(apiBadRequest)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isBadRequest(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isBadRequest(sdkNetwork)).toBe(false)
  })
})

describe('isInternalError', () => {
  it('positivo: internal_error', () => {
    expect(isInternalError(apiInternalError)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isInternalError(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isInternalError(sdkNetwork)).toBe(false)
  })
})

describe('isServiceUnavailable', () => {
  it('positivo: service_unavailable', () => {
    expect(isServiceUnavailable(apiServiceUnavailable)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isServiceUnavailable(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isServiceUnavailable(sdkNetwork)).toBe(false)
  })
})

describe('isAccountStateLocked', () => {
  it('positivo: account_state_locked', () => {
    expect(isAccountStateLocked(apiAccountStateLocked)).toBe(true)
  })
  it('negativo: not_found', () => {
    expect(isAccountStateLocked(apiNotFound)).toBe(false)
  })
  it('negativo: sdk error', () => {
    expect(isAccountStateLocked(sdkNetwork)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SDK shortcut predicates (6)
// ---------------------------------------------------------------------------

describe('isNetworkError', () => {
  it('positivo: network', () => {
    expect(isNetworkError(sdkNetwork)).toBe(true)
  })
  it('negativo: otro reason sdk', () => {
    expect(isNetworkError(sdkTokenInvalid)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isNetworkError(apiNotFound)).toBe(false)
  })
  it('narrows .reason a literal network', () => {
    if (isNetworkError(sdkNetwork)) {
      expect(sdkNetwork.reason).toBe('network')
    }
  })
})

describe('isTokenInvalid', () => {
  it('positivo: token_invalid', () => {
    expect(isTokenInvalid(sdkTokenInvalid)).toBe(true)
  })
  it('negativo: network', () => {
    expect(isTokenInvalid(sdkNetwork)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isTokenInvalid(apiNotFound)).toBe(false)
  })
})

describe('isAuthRequired', () => {
  it('positivo: auth_required', () => {
    expect(isAuthRequired(sdkAuthRequired)).toBe(true)
  })
  it('negativo: network', () => {
    expect(isAuthRequired(sdkNetwork)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isAuthRequired(apiNotFound)).toBe(false)
  })
})

describe('isRefreshNoTokens', () => {
  it('positivo: refresh_no_tokens', () => {
    expect(isRefreshNoTokens(sdkRefreshNoTokens)).toBe(true)
  })
  it('negativo: network', () => {
    expect(isRefreshNoTokens(sdkNetwork)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isRefreshNoTokens(apiNotFound)).toBe(false)
  })
})

describe('isVerifyFailed', () => {
  it('positivo: verify_failed', () => {
    expect(isVerifyFailed(sdkVerifyFailed)).toBe(true)
  })
  it('negativo: network', () => {
    expect(isVerifyFailed(sdkNetwork)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isVerifyFailed(apiNotFound)).toBe(false)
  })
})

describe('isMalformed', () => {
  it('positivo: malformed', () => {
    expect(isMalformed(sdkMalformed)).toBe(true)
  })
  it('negativo: network', () => {
    expect(isMalformed(sdkNetwork)).toBe(false)
  })
  it('negativo: api error', () => {
    expect(isMalformed(apiNotFound)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Casos cruzados API vs SDK
// ---------------------------------------------------------------------------

describe('casos cruzados — cross-branch false negatives', () => {
  it('isNotFound con unauthorized retorna false', () => {
    expect(isNotFound(apiUnauthorized)).toBe(false)
  })

  it('isUnauthorized con forbidden retorna false', () => {
    expect(isUnauthorized(apiForbidden)).toBe(false)
  })

  it('isNetworkError con api error retorna false', () => {
    expect(isNetworkError(apiUnauthorized)).toBe(false)
  })

  it('isTokenInvalid con auth_required retorna false', () => {
    expect(isTokenInvalid(sdkAuthRequired)).toBe(false)
  })

  it('isConflict con service_client_already_exists retorna false (es feature-specific)', () => {
    // El feature-specific code NO debe matchear conflict aunque semánticamente sea similar
    expect(isConflict(apiFeatureSpecific)).toBe(false)
  })

  it('matchError captura feature-specific code', () => {
    expect(matchError(apiFeatureSpecific, 'service_client_already_exists')).toBe(true)
  })
})

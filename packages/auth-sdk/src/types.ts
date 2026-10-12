// Import rule (D-35): this module is reachable from `src/react`, so it takes ONLY `import type` from
// the contract. A by-value import of a schema module would pull its load-time `.meta()`
// registrations into the react bundle (the react closure gate fails on it).
import type {
  ACTIVITY_STATES,
  PRIVACY_STATES,
  Company,
  PublicProfile,
  Session,
} from '@eva_solutions/auth-contracts'

// The shapes below are aliases of the shared contract: the wire is defined there, once.
export type ActivityState = (typeof ACTIVITY_STATES)[number]
export type PrivacyState = (typeof PRIVACY_STATES)[number]

export type EvaUser = PublicProfile

export type EvaSession = Session

export type EvaEmpresa = Company

export type EvaTokenPayload<TExtra extends Record<string, unknown> = {}> = {
  id: string
  sessionId: string
} & TExtra

/**
 * Error proveniente del Auth Service (respuesta HTTP con shape { error: { code, message } }).
 * D-02 v3 LOCKED: discriminated union con kind:'api'.
 */
export type EvaApiError = {
  kind: 'api'
  /** Error code del API (CoreErrorCode | feature-specific string). */
  code: string
  /** Mensaje humano del API. */
  message: string
  /** HTTP status code del API (400–503). */
  status: number
}

/**
 * Error interno del SDK (red, parsing, lógica de verify).
 * D-02 v3 LOCKED: discriminated union con kind:'sdk'.
 */
export type EvaSdkError = {
  kind: 'sdk'
  /** Reason interno — enum cerrado (SdkErrorReason). */
  reason: import('./error-codes').SdkErrorReason
  /** Mensaje descriptivo del error. */
  message: string
  /** HTTP status sugerido: 401 (auth/token), 500 (verify_failed), 0 (network/malformed). */
  status: number
}

/**
 * Discriminated union de todos los errores del SDK.
 * Narrow por `.kind` para acceder a propiedades específicas de cada variante.
 */
export type EvaError = EvaApiError | EvaSdkError

/**
 * Resultado de operaciones asincrónicas del SDK.
 * D-10 LOCKED: status vive SOLO en error.status (no duplicado en el Result top-level).
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: EvaError }

export type DeviceInfo = {
  deviceType: string
  os: string
  browser: string
  userAgent: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
}

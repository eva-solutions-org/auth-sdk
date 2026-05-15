export type ActivityState = 'activo' | 'ausente' | 'ocupado' | 'desconectado'
export type PrivacyState = 'publico' | 'amigos' | 'invisible'

export type EvaUser = {
  id: string
  phone: string
  name: string | null
  lastName: string | null
  email: string | null
  dni: string | null
  stateActivity: ActivityState
  statePrivacy: PrivacyState
  createdAt: string
}

export type EvaSession = {
  sessionId: string
  deviceType: string
  os: string
  browser: string
  ipAddress: string
  createdAt: string
  current: boolean
}

export type EvaEmpresa = {
  id: string
  ruc: string
  razonSocial: string
  slug: string
  direccion: string | null
  celular: string | null
  email: string | null
  img: string | null
}

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
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: EvaError }

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



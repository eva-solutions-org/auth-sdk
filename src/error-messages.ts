/**
 * Mensajes de error del SDK — fuente de verdad centralizada.
 * Standalone: NO importa de config.ts (evita ciclo de dependencias).
 * La validación runtime de overrides vive en config.ts (usa Zod).
 */

export interface EvaErrorMessages {
  // === Middleware / verify ===
  /** Auth requerida (middleware 401 sin token). */
  authRequired: string
  /** Token inválido (signature/format). */
  tokenInvalid: string
  /** Token expirado. */
  tokenExpired: string
  /** Claims del token no cumplen schema extra. */
  tokenClaimsInvalid: string
  /** Token de acceso/refresh no presente en cookies. */
  tokenNotFound: string
  /** Verify falló después de refresh exitoso. Soporta placeholder {0} para el inner error. */
  verifyFailedAfterRefresh: string
  /** Refresh OK pero servidor no devolvió tokens. */
  refreshNoNewTokens: string
  /** Refresh token falló. */
  refreshFailed: string
  // === Auth routes ===
  /** Login con credenciales inválidas. */
  loginFailed: string
  /** Registro falló. */
  registrationFailed: string
  /** Logout falló. */
  logoutFailed: string
  /** JSON malformado en body. */
  invalidJsonBody: string
  /** Schema validation falló sobre teléfono. */
  invalidPhone: string
  /** Body de PATCH /me vacío o inválido. */
  invalidUpdateBody: string
  /** sessionId malformado en /sessions/:id. */
  sessionInvalid: string
  // === Generic ===
  /** Error interno (500) cuando se expone al cliente. */
  internalError: string
}

/**
 * Defaults regression-locked: strings exactos que el SDK escribe hoy.
 * Frozen para prevenir mutación accidental entre tests/requests.
 */
export const DEFAULT_ERROR_MESSAGES: Readonly<EvaErrorMessages> = Object.freeze({
  authRequired: 'Autenticación requerida',
  tokenInvalid: 'Tokens no válidos',
  tokenExpired: 'Token expirado',
  tokenClaimsInvalid: 'Claims del token inválidas',
  tokenNotFound: 'Token de acceso no encontrado',
  verifyFailedAfterRefresh: 'Verificación fallida tras refresh: {0}',
  refreshNoNewTokens: 'El refresco no retornó nuevos tokens',
  refreshFailed: 'Falló el refresco de tokens',
  loginFailed: 'Teléfono o código inválido',
  registrationFailed: 'Registro fallido',
  logoutFailed: 'Logout fallido',
  invalidJsonBody: 'JSON inválido en el body',
  invalidPhone: 'Teléfono inválido',
  invalidUpdateBody: 'Cuerpo de actualización vacío',
  sessionInvalid: 'ID de sesión inválido',
  internalError: 'Error interno',
})

/**
 * Resuelve los mensajes de error con precedencia: local > global > default.
 * El merge es shallow string-por-string.
 * `""` (string vacío) se respeta como override explícito (≠ undefined).
 */
export function resolveErrorMessages(
  local?: Partial<EvaErrorMessages>,
  global?: Partial<EvaErrorMessages>,
): EvaErrorMessages {
  return { ...DEFAULT_ERROR_MESSAGES, ...global, ...local }
}

/**
 * Reemplaza placeholders `{N}` en un template string.
 * Ejemplo: formatMessage('Error: {0}', 'detalle') → 'Error: detalle'
 */
export function formatMessage(template: string, ...args: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_, idx) => args[Number(idx)] ?? '')
}

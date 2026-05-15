import { z } from 'zod'
import { clearCache } from './jwks-cache'
import {
  DEFAULT_ERROR_MESSAGES,
  type EvaErrorMessages,
} from './error-messages'

export type EvaEnv = 'local' | 'development' | 'production'

// Schema generado dinámicamente desde DEFAULT_ERROR_MESSAGES → keys siempre sincronizadas.
// .partial() → todas las keys son opcionales. .strict() → rechaza keys desconocidas.
const ErrorMessagesSchema = z.object(
  Object.fromEntries(
    (Object.keys(DEFAULT_ERROR_MESSAGES) as (keyof EvaErrorMessages)[]).map(
      k => [k, z.string()],
    ),
  ) as Record<keyof EvaErrorMessages, z.ZodString>,
).partial().strict()

// === Fallback build-time (constantes internas, NO exportadas) ===
const BUILD_TIME_AUTH_URL: string = __EVA_AUTH_URL__
const BUILD_TIME_ENV: EvaEnv = __EVA_ENV__ as EvaEnv

// === Estado runtime mutable (NO exportado directamente) ===
type RuntimeConfig = {
  authUrl?: string
  cookieDomain?: string
  errorMessages?: Partial<EvaErrorMessages>
  errorWire?: 'api' | 'string'
}

let _runtimeConfig: RuntimeConfig = {}

// === Validators ===

function validateAuthUrl(value: string, context: 'param' | 'env'): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    if (context === 'param') {
      throw new Error(`EVA_AUTH_URL inválida: ${value}`)
    }
    console.warn(`[eva-auth-sdk] EVA_AUTH_URL inválida en process.env (${value}); usando build-time fallback`)
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    if (context === 'param') {
      throw new Error(`EVA_AUTH_URL inválida (protocolo no soportado: ${parsed.protocol}): ${value}`)
    }
    console.warn(
      `[eva-auth-sdk] EVA_AUTH_URL inválida en process.env (protocolo no soportado: ${parsed.protocol}); usando build-time fallback`,
    )
    return null
  }
  return value
}

function validateCookieDomain(value: string): void {
  if (/[;\r\n]/.test(value)) {
    throw new Error('cookieDomain inválido: caracteres prohibidos (;, \\r, \\n)')
  }
}

// === API pública ===

export interface ConfigureEvaAuthOptions {
  /**
   * URL del Auth Service. Override programático con máxima precedencia.
   * Validada con new URL() + protocolo http/https — throw inmediato si inválida.
   * Si se omite (undefined), NO resetea el valor previo.
   */
  authUrl?: string
  /**
   * Domain para Set-Cookie. Validada contra header injection (;, \r, \n).
   * Si se omite (undefined), NO resetea el valor previo.
   * Recomendado: '.miempresa.com' para compartir entre subdominios.
   */
  cookieDomain?: string
  /**
   * Mensajes de error que el SDK escribe en respuestas 4xx.
   * Override granular: keys no provistas mantienen el default.
   * Si se omite (undefined), NO resetea el valor previo.
   * `""` se respeta como override explícito (no cae al default).
   * @throws Error si alguna key es desconocida o si algún valor no es string.
   */
  errorMessages?: Partial<EvaErrorMessages>
  /**
   * Shape del wire HTTP que el SDK Hono emite cuando rechaza un request.
   * - 'api' (default): { error: { code: string, message: string } } — consistente con el API.
   * - 'string': { error: string } — legacy, para consumers que esperan mensaje plano.
   * D-13 v2 LOCKED: default='api', configurable para compat con consumers 0.x.
   * @throws Error si se pasa un valor distinto de 'api' o 'string'.
   */
  errorWire?: 'api' | 'string'
}

/**
 * Configura el SDK en runtime. Idempotente — llamadas repetidas sobrescriben los campos
 * provistos. Llamar al boot del consumidor, antes del primer request.
 *
 * @throws Error si authUrl no es URL válida o tiene protocolo no soportado (no http/https).
 * @throws Error si cookieDomain contiene caracteres de header injection (;, \r, \n).
 */
export function configureEvaAuth(opts: ConfigureEvaAuthOptions): void {
  if (opts.authUrl !== undefined) {
    // validateAuthUrl con 'param' siempre retorna string o lanza — nunca null
    const validated = validateAuthUrl(opts.authUrl, 'param') as string
    const prev = _runtimeConfig.authUrl
    _runtimeConfig.authUrl = validated
    // Invalida JWKS cache solo si authUrl realmente cambió (B-3)
    if (prev !== validated) {
      clearCache()
    }
  }
  if (opts.cookieDomain !== undefined) {
    validateCookieDomain(opts.cookieDomain)
    _runtimeConfig.cookieDomain = opts.cookieDomain
  }
  if (opts.errorMessages !== undefined) {
    _runtimeConfig.errorMessages = validateErrorMessagesInput(opts.errorMessages)
  }
  if (opts.errorWire !== undefined) {
    if (opts.errorWire !== 'api' && opts.errorWire !== 'string') {
      throw new Error(
        `[eva-auth-sdk] errorWire inválido: "${opts.errorWire}". Valores válidos: 'api' | 'string'`,
      )
    }
    _runtimeConfig.errorWire = opts.errorWire
  }
}

/**
 * Retorna la URL del Auth Service con la siguiente precedencia:
 * 1. configureEvaAuth({ authUrl }) — runtime param
 * 2. process.env.EVA_AUTH_URL — variable de entorno (con guard para Edge runtimes)
 * 3. __EVA_AUTH_URL__ — constante horneada en build-time
 */
export function getAuthUrl(): string {
  if (_runtimeConfig.authUrl) return _runtimeConfig.authUrl

  const envRaw = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EVA_AUTH_URL
  const envTrimmed = envRaw?.trim()
  if (envTrimmed) {
    const validated = validateAuthUrl(envTrimmed, 'env')
    if (validated) return validated
  }

  return BUILD_TIME_AUTH_URL
}

/**
 * Retorna el cookieDomain configurado vía configureEvaAuth, o undefined si no se configuró.
 */
export function getCookieDomain(): string | undefined {
  return _runtimeConfig.cookieDomain
}

/**
 * Retorna el entorno horneado en build-time (local | development | production).
 * No es afectado por configureEvaAuth.
 */
export function getEvaEnv(): EvaEnv {
  return BUILD_TIME_ENV
}

/**
 * Retorna los errorMessages globales configurados vía configureEvaAuth (sin merge con defaults).
 * Retorna undefined si no se configuraron.
 */
export function getErrorMessages(): Partial<EvaErrorMessages> | undefined {
  return _runtimeConfig.errorMessages
}

/**
 * Retorna el shape del wire HTTP para respuestas de error.
 * Default: 'api' — sin configureEvaAuth el SDK emite { error: { code, message } }.
 * D-13 v2 LOCKED.
 */
export function getErrorWire(): 'api' | 'string' {
  return _runtimeConfig.errorWire ?? 'api'
}

/**
 * Valida un objeto Partial<EvaErrorMessages> con Zod.
 * Lanza Error con path y mensaje de Zod si alguna key es desconocida o algún valor no es string.
 * Usado internamente por configureEvaAuth, evaAuth y verifyRequest para validación temprana.
 */
export function validateErrorMessagesInput(
  input: Partial<EvaErrorMessages>,
): Partial<EvaErrorMessages> {
  const result = ErrorMessagesSchema.safeParse(input)
  if (!result.success) {
    throw new Error(
      `[eva-auth-sdk] errorMessages inválido: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return result.data
}

// NOTA: NO se exporta __resetEvaAuthConfig.
// Los tests que necesiten resetear estado usan vi.resetModules() + re-import dinámico.

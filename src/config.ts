import { z } from 'zod'
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
  cookieDomain?: string
  errorMessages?: Partial<EvaErrorMessages>
  errorWire?: 'api' | 'string'
}

let _runtimeConfig: RuntimeConfig = {}

// === Validators ===

/**
 * Valida que `value` sea una URL https (o http con host loopback para tests/dev local).
 * Lanza Error síncrono si la URL es malformada, usa protocolo no soportado,
 * o usa http con host no-loopback.
 * Exportada para uso interno del SDK (createS2SClient, createAdminClient).
 * NO re-exportada desde los barrels públicos (src/index.ts, etc.) — REQ-HTTPS-10.
 */
export function validateHttpsUrl(value: string, label: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} inválida: URL malformada: ${value}`)
  }

  if (parsed.protocol === 'http:') {
    // NOTA: en Node.js, new URL('http://[::1]:4000').hostname devuelve '[::1]' (con corchetes).
    // El WHATWG URL spec permite ambas representaciones según el runtime.
    // Este SDK se ejecuta en Node.js/Edge runtimes que mantienen los corchetes en .hostname para IPv6.
    const hostname = parsed.hostname
    // oxlint-disable-next-line prefer-string-starts-ends-with -- regex anclada requerida para seguridad (CWE-319): startsWith('127.') aceptaría '127.evil.com'
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||   // defensa: dead-code en Node 20+ (Ada 2.0 retorna '[::1]' con corchetes)
      hostname === '[::1]' || // Node.js 20+ (WHATWG Ada 2.0): .hostname de IPv6 literal incluye corchetes
      /^127(?:\.\d{1,3}){3}$/.test(hostname) // forma IPv4 completa anclada — bloquea '127.evil.com'
    ) {
      return // loopback http: permitido (tests + desarrollo local)
    }
    throw new Error(`${label} inválida: se requiere https (o loopback http): ${value}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} inválida: protocolo no soportado (${parsed.protocol}): ${value}`)
  }
  // https: → válido, void
}

function validateCookieDomain(value: string): void {
  if (/[;\r\n]/.test(value)) {
    throw new Error('cookieDomain inválido: caracteres prohibidos (;, \\r, \\n)')
  }
}

// === API pública ===

export interface ConfigureEvaAuthOptions {
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
 * @throws Error si cookieDomain contiene caracteres de header injection (;, \r, \n).
 */
export function configureEvaAuth(opts: ConfigureEvaAuthOptions): void {
  // D-07: guard de cortesía para consumidores en JS puro que aún pasen authUrl
  // (eliminado en v2.0.0 — no tiene efecto funcional, solo emite aviso de migración)
  if ('authUrl' in opts) {
    // oxlint-disable-next-line no-console -- intentional consumer-facing migration warning
    console.warn(
      '[eva-auth-sdk] configureEvaAuth: el campo `authUrl` fue eliminado en v2.0.0 y ya no tiene efecto. ' +
      'La URL del Auth Service se fija en build-time. Ver CHANGELOG.md#200 para migrar.',
    )
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
 * Retorna la URL del Auth Service horneada en build-time.
 * El valor se fija al compilar — no es configurable en runtime.
 */
export function getAuthUrl(): string {
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

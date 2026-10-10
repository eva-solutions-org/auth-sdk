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

// === Fallback build-time (constante interna, NO exportada) ===
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

/**
 * Valida y normaliza `authUrl`: https (o loopback http), con path permitido, sin userinfo,
 * query ni fragmento. Ningún mensaje incluye el valor recibido: puede traer credenciales.
 * Lo único que se ve en un mensaje es el href ya normalizado (esquema, host, puerto, path),
 * que llegado a ese punto no puede contener userinfo, query ni fragmento.
 * Retorna el href normalizado sin una única `/` final.
 */
function validateAuthUrl(value: unknown): string {
  // Entrada de JS sin tipar (as any / JSON): sin esto `value.includes` lanzaría un TypeError ajeno.
  if (typeof value !== 'string') {
    throw new Error('[eva-auth-sdk] authUrl inválida: debe ser string')
  }
  // Chequeo sobre el string crudo: `URL.search`/`URL.hash` valen '' para un `?` o `#` solitario.
  if (value.includes('?') || value.includes('#')) {
    throw new Error('[eva-auth-sdk] authUrl inválida: no puede contener query (?) ni fragmento (#)')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('[eva-auth-sdk] authUrl inválida: URL malformada')
  }
  // Esquemas con path opaco (mailto:, redis:, data:) no exponen userinfo en URL.username y
  // validateHttpsUrl ecoaría el valor crudo: se rechazan aquí, sin incluir el input.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('[eva-auth-sdk] authUrl inválida: protocolo no soportado (solo https, o http en loopback)')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('[eva-auth-sdk] authUrl inválida: no puede incluir credenciales (usuario/contraseña)')
  }
  validateHttpsUrl(parsed.href, '[eva-auth-sdk] authUrl')
  return parsed.href.replace(/\/$/, '')
}

function validateCookieDomain(value: string): void {
  if (/[;\r\n]/.test(value)) {
    throw new Error('cookieDomain inválido: caracteres prohibidos (;, \\r, \\n)')
  }
}

// === API pública ===

export interface ConfigureEvaAuthOptions {
  /**
   * URL base del Auth Service. Obligatoria antes del primer uso que la necesite
   * (`authFetch`, JWKS): si falta, esos usos lanzan `EvaAuthConfigError`.
   * Acepta https, o http solo en loopback (localhost, 127.0.0.1, [::1]); admite path
   * (`https://host/auth`). Rechaza userinfo, query y fragmento (incluidos `?` y `#` solitarios).
   * Se normaliza (host en minúsculas, sin `/` final) y es inmutable: reconfigurar con el mismo
   * valor normalizado es no-op; con otro valor lanza Error.
   * Si se omite (undefined), no valida ni modifica el valor previo.
   * @throws Error si la URL es inválida o difiere de la ya configurada.
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

const CONFIG_ERROR_NAME = 'EvaAuthConfigError'

function createEvaAuthConfigError(message: string): Error {
  const err = new Error(message)
  err.name = CONFIG_ERROR_NAME
  return err
}

/**
 * Indica si `err` es un error de configuración del SDK (falta `authUrl`).
 * Uso interno: `authFetch` y `verifyAccessToken` lo relanzan en vez de mapearlo a
 * red / token inválido. NO re-exportada desde los barrels públicos.
 */
export function isEvaAuthConfigError(err: unknown): boolean {
  return err instanceof Error && err.name === CONFIG_ERROR_NAME
}

/**
 * Fase de validación de `configureEvaAuth`: pura, lanza sin mutar nada.
 * Si cualquier campo es inválido (o `authUrl` cambia), no se confirma ningún campo.
 */
function buildConfigPatch(opts: ConfigureEvaAuthOptions, current: RuntimeConfig): Partial<RuntimeConfig> {
  const patch: Partial<RuntimeConfig> = {}
  if (opts.authUrl !== undefined) {
    const normalized = validateAuthUrl(opts.authUrl)
    if (current.authUrl !== undefined && current.authUrl !== normalized) {
      throw new Error('[eva-auth-sdk] authUrl ya fue configurada y no puede cambiar en runtime')
    }
    patch.authUrl = normalized
  }
  if (opts.cookieDomain !== undefined) {
    validateCookieDomain(opts.cookieDomain)
    patch.cookieDomain = opts.cookieDomain
  }
  if (opts.errorMessages !== undefined) {
    patch.errorMessages = validateErrorMessagesInput(opts.errorMessages)
  }
  if (opts.errorWire !== undefined) {
    if (opts.errorWire !== 'api' && opts.errorWire !== 'string') {
      throw new Error(
        `[eva-auth-sdk] errorWire inválido: "${opts.errorWire}". Valores válidos: 'api' | 'string'`,
      )
    }
    patch.errorWire = opts.errorWire
  }
  return patch
}

/**
 * Configura el SDK en runtime. Llamar al boot del consumidor, antes del primer request;
 * importar el SDK o crear `evaAuth()` no lee la configuración ni lanza.
 *
 * Es atómica: valida todos los campos y recién entonces los confirma; si uno falla, ninguno cambia.
 * `authUrl` es inmutable (re-configurar el mismo valor normalizado es no-op). El resto de los
 * campos provistos sobrescriben el valor previo; los omitidos (undefined) no lo resetean.
 *
 * @throws Error si `authUrl` es inválida o distinta de la ya configurada, si cookieDomain contiene
 *   caracteres de header injection (;, \r, \n), o si errorMessages / errorWire son inválidos.
 */
export function configureEvaAuth(opts: ConfigureEvaAuthOptions): void {
  const patch = buildConfigPatch(opts, _runtimeConfig)
  _runtimeConfig = { ..._runtimeConfig, ...patch }
}

/**
 * Retorna la URL del Auth Service configurada vía `configureEvaAuth({ authUrl })`
 * (normalizada, sin `/` final).
 * @throws Error de configuración (`name === 'EvaAuthConfigError'`) si aún no se configuró.
 *   `authFetch` y `verifyAccessToken` lo propagan: el consumidor ve un 500, nunca un 401 o un error de red.
 */
export function getAuthUrl(): string {
  if (_runtimeConfig.authUrl === undefined) {
    throw createEvaAuthConfigError(
      '[eva-auth-sdk] authUrl no configurada: llama configureEvaAuth({ authUrl }) al arrancar',
    )
  }
  return _runtimeConfig.authUrl
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

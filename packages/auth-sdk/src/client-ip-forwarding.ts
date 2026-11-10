/**
 * Reenvío de la IP real del usuario a Auth. Un backend que llama a Auth en nombre de un usuario
 * ve su propia IP en Auth: con una credencial de servicio (`x-eva-service-token`, scope
 * `login:client-ip`) reenvía la IP real en `x-eva-client-ip`. Ambos headers o ninguno.
 *
 * Nunca rompe la llamada: ante cualquier fallo devuelve `undefined` (sin headers) y avisa por
 * `onError` sin token ni IP. Módulo puro: sin Hono ni dependencias del runtime.
 */
import {
  CLIENT_IP_HEADER,
  SERVICE_TOKEN_HEADER,
} from '@eva_solutions/auth-contracts'

/** Espera máxima de `getServiceToken`; vencida, la llamada sigue sin headers. */
const SERVICE_TOKEN_TIMEOUT_MS = 2_000
/** Tras un fallo de `getServiceToken` no se vuelve a pedir durante este tiempo. */
const SERVICE_TOKEN_RETRY_DELAY_MS = 30_000

/** Valor de header seguro: ASCII visible, sin espacios ni controles (fetch lanza con otros). */
const HEADER_VALUE = /^[\x21-\x7e]{1,512}$/

export type ClientIpForwardingErrorCode =
  | 'client_ip_failed'
  | 'service_token_failed'
  | 'service_token_timeout'

export type ClientIpForwardingErrorInfo = {
  code: ClientIpForwardingErrorCode
  /** Solo si el error original trae un `status` numérico (p. ej. `ServiceTokenRequestError`). */
  status?: number
}

/**
 * `TContext` es lo que recibe `getClientIp`: el `Context` de Hono en las rutas y en `evaAuth`, la
 * `Request` en `verifyRequest`.
 */
export type ClientIpForwardingOptions<TContext> = {
  getClientIp: (context: TContext) => string | null | undefined
  /** Token de servicio `aud: auth-api`, scope `login:client-ip` (`createServiceTokenProvider`). */
  getServiceToken: () => Promise<string>
  /** Aviso de fallo, sin token ni IP. Una excepción del propio callback se ignora. */
  onError?: (info: ClientIpForwardingErrorInfo) => void
}

class TokenTimeout extends Error {}

const statusOf = (err: unknown): number | undefined => {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

type Forwarder<TContext> = (
  context: TContext,
) => Promise<Record<string, string> | undefined>

const forwarders = new WeakMap<object, Forwarder<never>>()

/**
 * Devuelve el constructor de headers de reenvío de ESE objeto de opciones. El estado (los 30 s sin
 * reintento y el token tardío) es por objeto: la misma opción pasada a `evaAuthRoutes`, `evaAuth`
 * y `verifyRequest` comparte un solo estado. Declara la opción una vez, fuera del handler.
 *
 * @example
 * ```ts
 * const forward = createClientIpForwarder({ getClientIp: (req: Request) => ..., getServiceToken })
 * const headers = await forward(request) // undefined si no hay IP o falló
 * await createHttpClient().getUser({ accessToken }, headers)
 * ```
 */
export function createClientIpForwarder<TContext>(
  opts: ClientIpForwardingOptions<TContext> | undefined,
): Forwarder<TContext> {
  if (!opts) return async () => undefined
  const existing = forwarders.get(opts)
  if (existing) return existing as Forwarder<TContext>
  const created = buildForwarder(opts)
  forwarders.set(opts, created as Forwarder<never>)
  return created
}

function buildForwarder<TContext>(
  opts: ClientIpForwardingOptions<TContext>,
): Forwarder<TContext> {
  let retryAt = 0
  // Token that arrived after the 2 s gave up (the provider finished and cached it): usable while
  // the back-off lasts, with no new request and no new wait.
  let lateToken: string | undefined

  const report = (info: ClientIpForwardingErrorInfo): void => {
    try {
      const result = opts.onError?.(info) as unknown
      if (result instanceof Promise) result.catch(() => {})
    } catch {
      // el callback nunca rompe la llamada
    }
  }

  const fetchToken = (): Promise<string> => {
    const request = new Promise<string>((res) => res(opts.getServiceToken()))
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        request.then(
          (value) => {
            if (HEADER_VALUE.test(value)) lateToken = value
          },
          () => {},
        )
        reject(new TokenTimeout())
      }, SERVICE_TOKEN_TIMEOUT_MS)
      request.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })
  }

  return async (context) => {
    let ip: string | null | undefined
    try {
      ip = opts.getClientIp(context)
    } catch (err) {
      report({ code: 'client_ip_failed', status: statusOf(err) })
      return undefined
    }
    if (ip === null || ip === undefined || ip === '') return undefined
    if (typeof ip !== 'string' || !HEADER_VALUE.test(ip)) {
      report({ code: 'client_ip_failed' })
      return undefined
    }

    if (Date.now() < retryAt) {
      return lateToken === undefined
        ? undefined
        : { [SERVICE_TOKEN_HEADER]: lateToken, [CLIENT_IP_HEADER]: ip }
    }
    lateToken = undefined

    try {
      const token = await fetchToken()
      if (typeof token !== 'string' || !HEADER_VALUE.test(token)) {
        throw new TypeError('invalid service token')
      }
      return { [SERVICE_TOKEN_HEADER]: token, [CLIENT_IP_HEADER]: ip }
    } catch (err) {
      retryAt = Date.now() + SERVICE_TOKEN_RETRY_DELAY_MS
      report({
        code:
          err instanceof TokenTimeout
            ? 'service_token_timeout'
            : 'service_token_failed',
        status: statusOf(err),
      })
      return undefined
    }
  }
}

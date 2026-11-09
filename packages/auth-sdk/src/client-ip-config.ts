/**
 * Configuración de servidor del reenvío de IP: `configureEvaAuth({ serviceCredentials })`.
 *
 * El consumidor entrega su credencial de servicio UNA vez y el reenvío funciona sin cablear nada:
 * `evaAuthRoutes`, `evaAuthOpenAPIRoutes`, `evaAuth` y `verifyRequest` usan por defecto el objeto de
 * reenvío que se crea aquí (un proveedor de tokens `aud: auth-api`, scope `login:client-ip`).
 *
 * Vive APARTE de `config.ts` a propósito: `config.ts` es alcanzable desde el entry `react` (el
 * navegador) y este módulo arrastra el proveedor S2S (HMAC). El entry `react` nunca lo importa.
 */
import {
  createClientIpForwarder,
  type ClientIpForwardingErrorInfo,
  type ClientIpForwardingOptions,
} from './client-ip-forwarding'
import {
  configureEvaAuth as configureBase,
  getAuthUrl,
  type ConfigureEvaAuthOptions as ConfigureEvaAuthBaseOptions,
} from './config'
import { S2S_SCOPES } from './s2s/constants'
import { createServiceTokenProvider } from './s2s/token-provider'

/** Lo que recibe `getClientIp`: el `Context` de Hono (estructural, sin importar hono) o una `Request`. */
export type ClientIpContext =
  | { req: { header(name: string): string | undefined } }
  | Request

export type ServiceCredentials = { clientId: string; secretHex: string }

export interface ConfigureEvaAuthServerOptions extends ConfigureEvaAuthBaseOptions {
  /**
   * Credencial de servicio de ESTE backend (la de su service client en Auth). OBLIGATORIA en los
   * entry de servidor: `null` es el descarte explícito (solo local o sin backend); `undefined`
   * lanza al configurar. Con credencial, el SDK reenvía la IP real del usuario a Auth en todas las
   * llamadas hechas en nombre de un usuario. No hay nada que conceder: el permiso
   * `login:client-ip` es implícito en Auth para cualquier service client habilitado. Fuera de
   * Cloudflare Workers exige además `getClientIp`. Nunca la pongas en código de navegador.
   * Reconfigurar con la misma credencial no recrea el objeto ni reinicia el backoff.
   */
  serviceCredentials: ServiceCredentials | null
  /**
   * De dónde sale la IP del usuario. OBLIGATORIO con `serviceCredentials` fuera de Cloudflare
   * Workers: ahí el default (`cf-connecting-ip`, que fija el borde de Cloudflare) no existe, porque
   * en otro servidor lo escribe el cliente. Lee el header que SOLO tu proxy fija y sobrescribe
   * siempre, o la IP del socket; nunca `x-forwarded-for`. En Workers es opcional (el default).
   * Si devuelve nada, no se reenvía.
   */
  getClientIp?: (context: ClientIpContext) => string | null | undefined
  /**
   * Aviso de un fallo del reenvío (sin token ni IP). Por defecto `console.warn` con `code` y
   * `status`: nunca queda apagado en silencio.
   */
  onClientIpForwardingError?: (info: ClientIpForwardingErrorInfo) => void
}

type ServerState = {
  credentials: ServiceCredentials | null | undefined
  getClientIp?: (context: ClientIpContext) => string | null | undefined
  onError?: (info: ClientIpForwardingErrorInfo) => void
  options?: ClientIpForwardingOptions<ClientIpContext>
}

let state: ServerState = { credentials: undefined }

/** Lee un header de un `Context` de Hono o de una `Request`. */
export function readRequestHeader(
  context: ClientIpContext,
  name: string,
): string | undefined {
  if ('req' in context) return context.req.header(name)
  return context.headers.get(name) ?? undefined
}

/** `cf-connecting-ip` solo es de fiar detrás del borde de Cloudflare: es el runtime de Workers. */
const isCloudflareWorkers = (): boolean =>
  typeof navigator !== 'undefined' &&
  navigator.userAgent === 'Cloudflare-Workers'

const defaultGetClientIp = (context: ClientIpContext) =>
  readRequestHeader(context, 'cf-connecting-ip')

const defaultOnError = (info: ClientIpForwardingErrorInfo): void => {
  // oxlint-disable-next-line no-console -- the default must never leave the failure silent
  console.warn('[eva-auth-sdk] client IP forwarding failed', {
    code: info.code,
    status: info.status,
  })
}

const HEX = /^(?:[0-9a-fA-F]{2})+$/

function validateCredentials(value: unknown): ServiceCredentials | null {
  if (value === undefined) {
    throw new Error(
      '[eva-auth-sdk] serviceCredentials es obligatorio en configureEvaAuth: pasa { clientId, secretHex } o null para descartarlo (solo local o sin backend)',
    )
  }
  if (value === null) return null
  const creds = value as Partial<ServiceCredentials>
  if (
    typeof value !== 'object' ||
    typeof creds.clientId !== 'string' ||
    creds.clientId === '' ||
    typeof creds.secretHex !== 'string' ||
    !HEX.test(creds.secretHex)
  ) {
    throw new Error(
      '[eva-auth-sdk] serviceCredentials inválido: se espera { clientId: string no vacío, secretHex: string hex }',
    )
  }
  return { clientId: creds.clientId, secretHex: creds.secretHex }
}

/**
 * Configura el SDK en un servidor (entry raíz, `/hono` y `/generic`). Igual que la configuración
 * base, más `serviceCredentials` obligatorio. Atómica: si algo es inválido, nada cambia.
 *
 * @throws Error si `serviceCredentials` es `undefined` o inválido, o por cualquier error de la
 *   configuración base. Ningún mensaje incluye valores sensibles.
 */
export function configureEvaAuth(opts: ConfigureEvaAuthServerOptions): void {
  const credentials = validateCredentials(opts.serviceCredentials)
  const { getClientIp, onClientIpForwardingError } = opts
  if (getClientIp !== undefined && typeof getClientIp !== 'function') {
    throw new Error('[eva-auth-sdk] getClientIp inválido: debe ser una función')
  }
  if (
    onClientIpForwardingError !== undefined &&
    typeof onClientIpForwardingError !== 'function'
  ) {
    throw new Error(
      '[eva-auth-sdk] onClientIpForwardingError inválido: debe ser una función',
    )
  }
  if (
    credentials !== null &&
    getClientIp === undefined &&
    state.getClientIp === undefined &&
    !isCloudflareWorkers()
  ) {
    throw new Error(
      '[eva-auth-sdk] getClientIp es obligatorio con serviceCredentials fuera de Cloudflare Workers: el header cf-connecting-ip solo es de fiar detrás del borde de Cloudflare. Pasa getClientIp leyendo el header que fija tu proxy (o la IP del socket), o serviceCredentials: null',
    )
  }
  const {
    serviceCredentials: _credentials,
    getClientIp: _getClientIp,
    onClientIpForwardingError: _onError,
    ...base
  } = opts
  configureBase(base)

  const same =
    credentials !== null &&
    state.credentials !== null &&
    state.credentials !== undefined &&
    state.credentials.clientId === credentials.clientId &&
    state.credentials.secretHex === credentials.secretHex
  state = {
    credentials,
    getClientIp: getClientIp ?? state.getClientIp,
    onError: onClientIpForwardingError ?? state.onError,
    // The same credential keeps the object, and with it the provider and the back-off.
    ...(same && state.options !== undefined && { options: state.options }),
  }
}

/**
 * El objeto de reenvío configurado (uno solo mientras la credencial no cambie), o `undefined` si
 * no hay credencial (`null` o sin configurar) o aún no hay `authUrl`. Se crea la primera vez que
 * se pide, no al configurar: el orden de arranque no importa.
 */
export function getConfiguredClientIpForwardingOptions():
  | ClientIpForwardingOptions<ClientIpContext>
  | undefined {
  const credentials = state.credentials
  if (credentials === null || credentials === undefined) return undefined
  if (state.options !== undefined) return state.options
  let authUrl: string
  try {
    authUrl = getAuthUrl()
  } catch {
    return undefined // sin authUrl no hay llamadas que reenviar; authFetch lo reportará
  }
  const provider = createServiceTokenProvider({
    authUrl,
    clientId: credentials.clientId,
    secretHex: credentials.secretHex,
    audience: 'auth-api',
    scope: S2S_SCOPES.LOGIN_CLIENT_IP,
  })
  // Delegating callbacks: reconfiguring `getClientIp` / the error callback does not need a new
  // object (and a new object would restart the back-off).
  state.options = {
    getClientIp: (context) =>
      (state.getClientIp ?? defaultGetClientIp)(context),
    getServiceToken: () => provider.getToken(),
    onError: (info) => (state.onError ?? defaultOnError)(info),
  }
  return state.options
}

const noForwarding = async (): Promise<undefined> => undefined

/**
 * Constructor de los headers de reenvío con la credencial configurada, para quien llama
 * directo a `createHttpClient`: `createHttpClient().getUser({ accessToken }, await forward(request))`.
 * Es el mismo (y comparte el backoff) que usan las rutas y los middlewares. Devuelve `undefined`
 * si no hay IP, si falló, o si no hay credencial. Llámalo después de `configureEvaAuth`.
 */
export function getConfiguredClientIpForwarder(): (
  context: ClientIpContext,
) => Promise<Record<string, string> | undefined> {
  const options = getConfiguredClientIpForwardingOptions()
  return options === undefined ? noForwarding : createClientIpForwarder(options)
}

/**
 * Forwarder de un handler: la opción explícita tiene prioridad; si no, la configurada, resuelta en
 * cada request (crear una ruta o un middleware no lee la configuración).
 */
export function resolveClientIpForwarder<TContext extends ClientIpContext>(
  explicit: ClientIpForwardingOptions<TContext> | undefined,
): (context: TContext) => Promise<Record<string, string> | undefined> {
  return (context) =>
    explicit === undefined
      ? getConfiguredClientIpForwarder()(context)
      : createClientIpForwarder(explicit)(context)
}

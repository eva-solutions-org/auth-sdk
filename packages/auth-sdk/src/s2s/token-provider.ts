/**
 * Proveedor de tokens de servicio (client credentials) para un servicio que llama a otro.
 *
 * Pide el token a `POST /api/v1/internal/token` autenticándose con la firma HMAC del service client
 * (la única ruta servicio -> servicio que la conserva), lo guarda en memoria y lo entrega a cada
 * llamada como `Authorization: Bearer`. El caché vive en la instancia: crea UN proveedor por
 * (audiencia, scope) y compártelo.
 */

import {
  INTERNAL_TOKEN_ROUTES,
  isScopeOfAudience,
  isServiceAudience,
} from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { validateHttpsUrl } from '../config'
import { signS2SHeaders } from './sign'

/** Cuánto antes del vencimiento se renueva el token, en milisegundos. */
export const SERVICE_TOKEN_RENEW_MARGIN_MS = 30_000

const REQUEST_TIMEOUT_MS = 10_000

// Margen para que el plazo de quien se une no venza antes que el aborto del que inició el pedido.
const JOIN_GRACE_MS = 1_000

const encoder = new TextEncoder()

export type ServiceTokenProviderConfig = {
  /**
   * URL base del Auth Service (sin `/api/v1`). Se requiere https (o http con host loopback para
   * tests); admite path (`https://host/auth`).
   */
  authUrl: string
  /** Slug del service client (`clientId`) que firma el pedido. */
  clientId: string
  /** Clave del service client en hex (64 chars). Nunca viaja: solo firma el pedido. */
  secretHex: string
  /** Servicio destino del token (`'auth-api'`, `'whatsapp-api'`). */
  audience: string
  /** Permisos pedidos separados por espacio. Si falta, se piden todos los concedidos. */
  scope?: string
}

export type ServiceTokenProvider = {
  /**
   * Devuelve un token vigente: el guardado mientras falten más de 30 s para su vencimiento, o uno
   * nuevo. Los pedidos simultáneos comparten una sola llamada al Auth Service.
   * @throws {ServiceTokenRequestError} si el Auth Service rechaza el pedido; `Error` de red si no responde.
   */
  getToken(): Promise<string>
  /**
   * Descarta el token guardado para que la próxima `getToken()` pida uno nuevo. Úsalo cuando el
   * servicio destino responde 401 con un token que creías vigente, pasando ESE token:
   * solo se descarta si sigue siendo el guardado. Así, N respuestas 401 simultáneas del mismo
   * token provocan UN pedido nuevo (la primera descarta; las demás ven que ya no es el guardado
   * y comparten el pedido en curso o el token renovado). Nunca descarta un pedido en curso.
   * Sin argumento descarta el token guardado, sea cual sea.
   */
  invalidate(rejectedToken?: string): void
}

/** El Auth Service rechazó el pedido de token. `code` es el `error` de RFC 6749 (`invalid_client`, …). */
export class ServiceTokenRequestError extends Error {
  readonly code: string
  readonly status: number
  /** Segundos de espera que pidió Auth con `Retry-After` (429 / 503), si los mandó. */
  readonly retryAfterSeconds?: number

  constructor(
    code: string,
    status: number,
    description?: string,
    retryAfterSeconds?: number,
  ) {
    super(description ?? code)
    this.name = 'ServiceTokenRequestError'
    this.code = code
    this.status = status
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds
    }
  }
}

type CachedToken = { token: string; renewAtMs: number }

async function requestToken(
  config: ServiceTokenProviderConfig,
  url: URL,
  body: string,
): Promise<CachedToken> {
  // El vencimiento se mide con el reloj local desde ANTES de pedir y con `expires_in` (relativo),
  // nunca comparando `exp` con el reloj local: un desfase de relojes no puede acortar ni alargar el token.
  const requestedAtMs = Date.now()
  const headers = await signS2SHeaders({
    method: 'POST',
    path: url.pathname,
    rawQuery: '',
    bodyBytes: encoder.encode(body),
    clientId: config.clientId,
    secretHex: config.secretHex,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  if (!res.ok) {
    // El límite de pedidos por client responde 429; el contrato no le da un `error` propio, así que
    // sin cuerpo RFC se trata como `temporarily_unavailable` (reintentable tras `Retry-After`).
    const code =
      typeof json?.error === 'string'
        ? json.error
        : res.status === 429
          ? 'temporarily_unavailable'
          : 'server_error'
    const retryAfterHeader = res.headers?.get('retry-after')?.trim()
    // Sin header (o no numérico) no hay espera pedida: `Number('')` sería 0, "reintenta ya".
    const retryAfter =
      retryAfterHeader !== undefined && /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader)
        : undefined
    const description =
      typeof json?.error_description === 'string'
        ? json.error_description
        : undefined
    throw new ServiceTokenRequestError(
      code,
      res.status,
      description,
      retryAfter,
    )
  }
  const token = json?.access_token
  const expiresIn = json?.expires_in
  if (
    typeof token !== 'string' ||
    token === '' ||
    typeof expiresIn !== 'number' ||
    !(expiresIn > 0)
  ) {
    throw new ServiceTokenRequestError(
      'server_error',
      res.status,
      'Respuesta de token inválida',
    )
  }
  return {
    token,
    renewAtMs: requestedAtMs + expiresIn * 1000 - SERVICE_TOKEN_RENEW_MARGIN_MS,
  }
}

/**
 * Crea un proveedor de tokens de servicio.
 *
 * Deduplica los pedidos simultáneos dentro del mismo proceso (isolate): N llamadas concurrentes a
 * `getToken()` con el caché vacío o vencido hacen UN pedido al Auth Service. Un pedido fallido no
 * se guarda: la siguiente llamada reintenta.
 *
 * Valida su configuración al crearse (audiencia del catálogo, permisos de esa audiencia, clave hex).
 *
 * @example
 * ```ts
 * const provider = createServiceTokenProvider({
 *   authUrl: env.AUTH_URL,
 *   clientId: env.AUTH_CLIENT_ID,
 *   secretHex: env.AUTH_CLIENT_SECRET_HEX,
 *   audience: 'auth-api',
 * })
 * const s2s = createS2SClient({ baseUrl: env.AUTH_URL, tokenProvider: provider })
 * ```
 */
export function createServiceTokenProvider(
  config: ServiceTokenProviderConfig,
): ServiceTokenProvider {
  validateHttpsUrl(config.authUrl, 'ServiceTokenProviderConfig.authUrl')
  if (!isServiceAudience(config.audience)) {
    throw new TypeError(
      `[eva-auth-sdk] createServiceTokenProvider: audience "${config.audience}" no es una audiencia de servicio del catálogo`,
    )
  }
  for (const scope of config.scope?.split(' ').filter(Boolean) ?? []) {
    if (!isScopeOfAudience(config.audience, scope)) {
      throw new TypeError(
        `[eva-auth-sdk] createServiceTokenProvider: "${scope}" no es un permiso de la audiencia "${config.audience}"`,
      )
    }
  }
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(config.secretHex)) {
    throw new TypeError(
      '[eva-auth-sdk] createServiceTokenProvider: secretHex inválido (formato hex requerido)',
    )
  }
  const url = new URL(
    `${config.authUrl.replace(/\/$/, '')}${apiPath(INTERNAL_TOKEN_ROUTES.issue)}`,
  )
  const body = JSON.stringify({
    audience: config.audience,
    ...(config.scope !== undefined && { scope: config.scope }),
  })

  let cached: CachedToken | undefined
  let inFlight: Promise<string> | undefined

  // Un pedido en curso lo comparten las requests del mismo isolate. En Cloudflare Workers, si la
  // request que lo inició termina sin esperarlo (por ejemplo `provider.getToken()` sin `await` ni
  // `waitUntil`), el runtime cancela su subrequest y esa promesa NUNCA se resuelve: quien se
  // unió quedaría colgado. Por eso los que se unen esperan como máximo lo que dura un pedido
  // (`REQUEST_TIMEOUT_MS` más un margen de 1 s); pasado ese plazo lo dan por huérfano y hacen el suyo.
  // (Probado en workerd: ver docs/api.md, sección `createServiceTokenProvider`.)
  const joinWithDeadline = (
    pending: Promise<string>,
    retry: () => Promise<string>,
  ): Promise<string> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (inFlight === pending) inFlight = undefined
        retry().then(resolve, reject)
      }, REQUEST_TIMEOUT_MS + JOIN_GRACE_MS)
      pending.then(
        (token) => {
          clearTimeout(timer)
          resolve(token)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })

  const provider: ServiceTokenProvider = {
    getToken() {
      if (cached !== undefined && Date.now() < cached.renewAtMs) {
        return Promise.resolve(cached.token)
      }
      if (inFlight !== undefined) {
        return joinWithDeadline(inFlight, () => provider.getToken())
      }
      const pending: Promise<string> = requestToken(config, url, body)
        .then((fresh) => {
          cached = fresh
          return fresh.token
        })
        .finally(() => {
          if (inFlight === pending) inFlight = undefined
        })
      inFlight = pending
      return pending
    },
    invalidate(rejectedToken) {
      if (rejectedToken === undefined || cached?.token === rejectedToken) {
        cached = undefined
      }
    },
  }
  return provider
}

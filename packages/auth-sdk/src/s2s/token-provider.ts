/**
 * Proveedor de tokens de servicio (client credentials) para un servicio que llama a otro.
 *
 * Pide el token a `POST /api/v1/internal/token` autenticándose con la firma HMAC del service client
 * (la única ruta servicio -> servicio que la conserva), lo guarda en memoria y lo entrega a cada
 * llamada como `Authorization: Bearer`. El caché vive en la instancia: crea UN proveedor por
 * (audiencia, scope) y compártelo.
 */

import {
  ACCESS_TOKEN_TYPE,
  INTERNAL_TOKEN_EXCHANGE_ROUTES,
  INTERNAL_TOKEN_ROUTES,
  TOKEN_EXCHANGE_GRANT_TYPE,
  isDelegableAudience,
  isDelegableScope,
  isScopeOfAudience,
  isServiceAudience,
} from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { ORPHAN_AFTER_MS, isOrphaned } from '../orphan'
import { validateHttpsUrl } from '../config'
import type { Result } from '../types'
import { signS2SHeaders } from './sign'

/** Cuánto antes del vencimiento se renueva el token, en milisegundos. */
export const SERVICE_TOKEN_RENEW_MARGIN_MS = 30_000

const REQUEST_TIMEOUT_MS = 10_000

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

/**
 * What the clients that call a service need from a provider: a token and a way to drop a rejected
 * one. `createServiceTokenProvider` returns more ({@link ServiceTokenProvider}); a hand-made source
 * (tests, another credential flow) only needs these two.
 */
export type ServiceTokenSource = {
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

/** Input of {@link ServiceTokenProvider.exchangeToken}. */
export type ExchangeTokenInput = {
  /**
   * Token to exchange: the access token of the user (`aud` = product of this actor) or a delegated
   * token (`aud` = audience of this actor, for a re-exchange). Pass one your service has ALREADY
   * verified (`verifyAccessToken`, `verifyDelegatedToken` or the middleware): the SDK does not.
   */
  subjectToken: string
  /** Destination service of the delegated token: one audience with a delegation edge from this client. Never `auth-api`. */
  audience: string
  /** Permissions asked for, separated by space. If absent, everything delegable on that edge. */
  scope?: string
}

/** A delegated token (`typ: dlg-at+jwt`) and the permissions it carries. */
export type DelegatedTokenGrant = {
  accessToken: string
  /** Permissions issued, separated by space (they can be fewer than asked for). */
  scope: string
}

/**
 * Provider of service tokens for ONE (audience, scope), plus the token exchange of the same client.
 */
export type ServiceTokenProvider = ServiceTokenSource & {
  /**
   * Exchanges a subject token for a delegated one (RFC 8693) so this service can call another one
   * on behalf of the user. Authenticates with its own service token (`aud: auth-api`, permission
   * `tokens:exchange`), which it obtains and renews by itself whatever the audience of this
   * provider is.
   *
   * Caches the delegated token in this isolate until 30 s before its `exp` (it lives 120 s). The
   * key is the audience, the scope and a fingerprint of the WHOLE subject token: a token with other
   * claims (another session, user or company), or the same re-exchanged from another token of the
   * chain (other `jti`), never reuses an entry. Errors are not cached.
   *
   * Returns a Result: `invalid_grant` (session closed, user or company out, product not contracted,
   * depth or cycle) is a normal answer, not an exception. The failures of Auth keep their RFC code
   * in `error.code` (`invalid_grant`, `invalid_target`, `invalid_scope`, `invalid_client`, ...).
   */
  exchangeToken(input: ExchangeTokenInput): Promise<Result<DelegatedTokenGrant>>
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

/** Entries the exchange cache keeps per provider before it drops expired ones and then the oldest. */
const EXCHANGE_CACHE_MAX_ENTRIES = 500

type CachedGrant = { grant: DelegatedTokenGrant; renewAtMs: number }

const malformed = (message: string): Result<never> => ({
  ok: false,
  error: { kind: 'sdk', reason: 'malformed', message, status: 0 },
})

/** SHA-256 of the subject token as hex: the cache never keys on claims nobody verified here. */
async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/** Validates the exchange input locally (a bad audience or scope is a sure `invalid_target` / `invalid_scope`). */
function validateExchangeInput(
  input: ExchangeTokenInput,
): Result<never> | null {
  if (typeof input.subjectToken !== 'string' || input.subjectToken === '') {
    return malformed('exchangeToken: subjectToken requerido')
  }
  if (!isDelegableAudience(input.audience)) {
    return malformed(
      `exchangeToken: "${String(input.audience)}" no es una audiencia delegable del catálogo (auth-api nunca lo es)`,
    )
  }
  for (const scope of input.scope?.split(' ').filter(Boolean) ?? []) {
    if (!isDelegableScope(input.audience, scope)) {
      return malformed(
        `exchangeToken: "${scope}" no es un permiso delegable de la audiencia "${input.audience}"`,
      )
    }
  }
  return null
}

function postExchange(
  url: URL,
  bearer: string,
  input: ExchangeTokenInput,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: input.subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      audience: input.audience,
      ...(input.scope !== undefined && { scope: input.scope }),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
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
  let inFlightStartedMs = 0

  // Token exchange: authenticates with a service token of its own (`aud: auth-api`, permission
  // `tokens:exchange`), whatever the audience of this provider is. Created on first use.
  const exchangeUrl = new URL(
    `${config.authUrl.replace(/\/$/, '')}${apiPath(INTERNAL_TOKEN_EXCHANGE_ROUTES.exchange)}`,
  )
  let exchangeBearer: ServiceTokenSource | undefined
  const exchangeCache = new Map<string, CachedGrant>()

  const rememberGrant = (key: string, entry: CachedGrant): void => {
    if (exchangeCache.size >= EXCHANGE_CACHE_MAX_ENTRIES) {
      const now = Date.now()
      for (const [k, v] of exchangeCache) {
        if (now >= v.renewAtMs) exchangeCache.delete(k)
      }
      if (exchangeCache.size >= EXCHANGE_CACHE_MAX_ENTRIES) {
        const oldest = exchangeCache.keys().next().value
        if (oldest !== undefined) exchangeCache.delete(oldest)
      }
    }
    exchangeCache.set(key, entry)
  }

  // Pedidos en curso por llave: dos llamadas simultáneas iguales hacen UN pedido (como `getToken`).
  const exchangeInFlight = new Map<
    string,
    { promise: Promise<Result<DelegatedTokenGrant>>; startedMs: number }
  >()

  const requestExchange = async (
    input: ExchangeTokenInput,
    key: string,
  ): Promise<Result<DelegatedTokenGrant>> => {
    try {
      exchangeBearer ??= createServiceTokenProvider({
        authUrl: config.authUrl,
        clientId: config.clientId,
        secretHex: config.secretHex,
        audience: 'auth-api',
        scope: 'tokens:exchange',
      })
      // As in the S2S client: a 401 means the Bearer was not good (revoked, client disabled);
      // drop it and try ONCE more with a fresh one.
      const requestedAtMs = Date.now()
      let bearer = await exchangeBearer.getToken()
      let res = await postExchange(exchangeUrl, bearer, input)
      if (res.status === 401) {
        exchangeBearer.invalidate(bearer)
        bearer = await exchangeBearer.getToken()
        res = await postExchange(exchangeUrl, bearer, input)
      }
      const json = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null

      if (!res.ok) {
        const code =
          typeof json?.error === 'string'
            ? json.error
            : res.status === 429
              ? 'temporarily_unavailable'
              : 'server_error'
        return {
          ok: false,
          error: {
            kind: 'api',
            code,
            message:
              typeof json?.error_description === 'string'
                ? json.error_description
                : code,
            status: res.status,
          },
        }
      }
      const accessToken = json?.access_token
      const expiresIn = json?.expires_in
      const scope = json?.scope
      if (
        typeof accessToken !== 'string' ||
        accessToken === '' ||
        typeof expiresIn !== 'number' ||
        !(expiresIn > 0) ||
        typeof scope !== 'string' ||
        json?.issued_token_type !== ACCESS_TOKEN_TYPE ||
        json?.token_type !== 'Bearer'
      ) {
        return {
          ok: false,
          error: {
            kind: 'api',
            code: 'server_error',
            message: 'Respuesta de token exchange inválida',
            status: res.status,
          },
        }
      }
      const grant: DelegatedTokenGrant = { accessToken, scope }
      rememberGrant(key, {
        grant,
        renewAtMs:
          requestedAtMs + expiresIn * 1000 - SERVICE_TOKEN_RENEW_MARGIN_MS,
      })
      return { ok: true, data: grant }
    } catch (err) {
      // Auth refused the Bearer request itself (bad signature, disabled client, no grant).
      if (err instanceof ServiceTokenRequestError) {
        return {
          ok: false,
          error: {
            kind: 'api',
            code: err.code,
            message: err.message,
            status: err.status,
          },
        }
      }
      return {
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'network',
          message: err instanceof Error ? err.message : 'Network error',
          status: 0,
        },
      }
    }
  }

  const exchangeToken = async (
    input: ExchangeTokenInput,
  ): Promise<Result<DelegatedTokenGrant>> => {
    const invalid = validateExchangeInput(input)
    if (invalid !== null) return invalid

    const scopeKey = (input.scope ?? '')
      .split(' ')
      .filter(Boolean)
      .sort()
      .join(' ')
    const key = `${await fingerprint(input.subjectToken)}|${input.audience}|${scopeKey}`
    const hit = exchangeCache.get(key)
    if (hit !== undefined) {
      if (Date.now() < hit.renewAtMs) return { ok: true, data: hit.grant }
      exchangeCache.delete(key)
    }
    let entry = exchangeInFlight.get(key)
    if (entry !== undefined && isOrphaned(entry.startedMs)) {
      exchangeInFlight.delete(key)
      entry = undefined
    }
    const pending = entry?.promise
    if (pending !== undefined) {
      // Como en `getToken`: si la request que inició el pedido terminó sin esperarlo, Workers lo
      // cancela y su promesa NUNCA se resuelve (`.finally` tampoco corre). Quien se une espera
      // como máximo lo que dura un pedido más el margen; luego suelta la entrada (si sigue siendo
      // esa) y hace el suyo.
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (exchangeInFlight.get(key)?.promise === pending)
            exchangeInFlight.delete(key)
          exchangeToken(input).then(resolve, reject)
        }, ORPHAN_AFTER_MS)
        pending.then(
          (result) => {
            clearTimeout(timer)
            resolve(result)
          },
          (err: unknown) => {
            clearTimeout(timer)
            reject(err)
          },
        )
      })
    }
    const started = requestExchange(input, key).finally(() => {
      if (exchangeInFlight.get(key)?.promise === started)
        exchangeInFlight.delete(key)
    })
    exchangeInFlight.set(key, { promise: started, startedMs: Date.now() })
    return started
  }

  // Un pedido en curso lo comparten las requests del mismo isolate. En Cloudflare Workers, si la
  // request que lo inició termina sin esperarlo (por ejemplo `provider.getToken()` sin `await` ni
  // `waitUntil`), el runtime cancela su subrequest y esa promesa NUNCA se resuelve: quien se
  // unió quedaría colgado. Por eso los que se unen esperan como máximo lo que dura un pedido
  // (`ORPHAN_AFTER_MS`: un pedido más un margen de 1 s); pasado ese plazo lo dan por huérfano y hacen el suyo.
  // (Probado en workerd: ver docs/api.md, sección `createServiceTokenProvider`.)
  const joinWithDeadline = (
    pending: Promise<string>,
    retry: () => Promise<string>,
  ): Promise<string> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (inFlight === pending) inFlight = undefined
        retry().then(resolve, reject)
      }, ORPHAN_AFTER_MS)
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
      // A request cancelled by the runtime leaves `inFlight` hanging and its timer dies with it:
      // one older than its deadline is orphaned, whatever the timers did.
      if (inFlight !== undefined && isOrphaned(inFlightStartedMs)) {
        inFlight = undefined
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
      inFlightStartedMs = Date.now()
      return pending
    },
    invalidate(rejectedToken) {
      if (rejectedToken === undefined || cached?.token === rejectedToken) {
        cached = undefined
      }
    },
    exchangeToken,
  }
  return provider
}

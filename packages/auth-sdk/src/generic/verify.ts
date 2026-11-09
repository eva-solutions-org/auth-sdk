import type { ZodType } from 'zod'
import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies } from '../cookies'
import type { ClientIpForwardingOptions } from '../client-ip-forwarding'
import { resolveClientIpForwarder } from '../client-ip-config'
import { createHttpClient } from '../http-client'
import { deduplicateRefresh } from '../refresh-dedup'
import { isTransientVerifyFailure } from '../verify-failure'
import type { EvaTokenPayload, EvaError, EvaSdkError } from '../types'
import {
  resolveErrorMessages,
  formatMessage,
  type EvaErrorMessages,
} from '../error-messages'
import { getErrorMessages, validateErrorMessagesInput } from '../config'

export type VerifyRequestOptions<TExtra extends Record<string, unknown>> = {
  extraClaimsSchema?: ZodType<TExtra>
  errorMessages?: Partial<EvaErrorMessages>
  /**
   * Solo backends: reenvía la IP real del usuario en el auto-refresh (ver `evaAuthRoutes`). El
   * estado (30 s sin reintento) es por objeto de opción: declárala una vez, fuera del handler.
   */
  clientIpForwarding?: ClientIpForwardingOptions<Request>
}

type VerifyResult<TExtra extends Record<string, unknown>> = {
  payload: EvaTokenPayload<TExtra>
  newCookies?: string[]
}

const client = createHttpClient()

/**
 * Resultado de `verifyRequest`. Es un `Result`, salvo que un fallo puede traer `newCookies`: pasa
 * cuando Auth ya rotó los tokens pero el nuevo no se pudo verificar por un fallo transitorio
 * (503). Escríbelas igual, o la sesión rotada se pierde.
 */
export type VerifyRequestResult<TExtra extends Record<string, unknown>> =
  | { ok: true; data: VerifyResult<TExtra> }
  | { ok: false; error: EvaError; newCookies?: string[] }

const unavailable = (): EvaSdkError => ({
  kind: 'sdk',
  reason: 'network',
  message: 'Servicio de autenticación no disponible',
  status: 503,
})

/**
 * Verifica una Request (cookies, JWT y auto-refresh) y devuelve un `VerifyRequestResult`; los
 * rechazos de autenticación (401) no lanzan. Un fallo transitorio de verificación (JWKS
 * inaccesible) devuelve 503 sin refrescar; si ocurre tras un refresh, trae `newCookies` con los
 * tokens ya rotados.
 *
 * @throws Error de configuración (`name === 'EvaAuthConfigError'`) si `authUrl` no fue
 *   configurada con `configureEvaAuth({ authUrl })` y la request trae algún token: se necesita
 *   para el JWKS o el refresh. El consumidor debe responder 500, nunca 401 ni limpiar cookies.
 *   También lanza si falta `product` y la request trae un header `cookie` (se necesita para nombrar
 *   las cookies de sesión). Una request sin header `cookie` devuelve `auth_required` (401) sin leer
 *   la configuración.
 */
export async function verifyRequest<
  TExtra extends Record<string, unknown> = {},
>(
  request: Request,
  opts: VerifyRequestOptions<TExtra> = {},
): Promise<VerifyRequestResult<TExtra>> {
  if (opts.errorMessages !== undefined) {
    validateErrorMessagesInput(opts.errorMessages)
  }

  const messages = resolveErrorMessages(opts.errorMessages, getErrorMessages())
  const cookieHeader = request.headers.get('cookie')
  const { accessToken, refreshToken } = readTokensFromCookies(cookieHeader)

  if (accessToken) {
    const result = await verifyAccessToken<TExtra>(accessToken, {
      extraClaimsSchema: opts.extraClaimsSchema,
    })
    if (result.ok) return { ok: true, data: { payload: result.data } }
    // No se pudo VERIFICAR (JWKS inaccesible): sin refresh, que gastaría una rotación sin motivo.
    if (isTransientVerifyFailure(result.error)) {
      return { ok: false, error: unavailable() }
    }
  }

  // Path: no hay accessToken válido ni refreshToken → auth_required (REQ-SDK-01)
  if (!refreshToken) {
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'auth_required',
        message: messages.authRequired,
        status: 401,
      } satisfies EvaSdkError,
    }
  }

  const headers = await resolveClientIpForwarder(opts.clientIpForwarding)(
    request,
  )
  const refreshResult = await deduplicateRefresh(refreshToken, () =>
    client.refresh({ refreshToken }, headers),
  )

  if (!refreshResult.ok) {
    // Refresh falló con error del API — propagar el error tal cual (EvaApiError o EvaSdkError)
    return { ok: false, error: refreshResult.error }
  }

  const { tokens } = refreshResult.data

  // Path: refresh OK pero no hay tokens nuevos → refresh_no_tokens (REQ-SDK-03)
  if (!tokens) {
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'refresh_no_tokens',
        message: messages.refreshNoNewTokens,
        status: 401,
      } satisfies EvaSdkError,
    }
  }

  const verifyResult = await verifyAccessToken<TExtra>(tokens.accessToken, {
    extraClaimsSchema: opts.extraClaimsSchema,
  })

  // Auth ya rotó los tokens: si no se pudo VERIFICAR el nuevo (fallo transitorio) se devuelven
  // para que el consumidor los escriba, con 503; no se pierde la rotación.
  if (!verifyResult.ok && isTransientVerifyFailure(verifyResult.error)) {
    return {
      ok: false,
      error: unavailable(),
      newCookies: setTokenCookies(tokens),
    }
  }

  // Path: verify post-refresh falló → verify_failed (REQ-SDK-04, REQ-SDK-05)
  if (!verifyResult.ok) {
    // Obtener mensaje del error (EvaSdkError tiene .message; compatibilidad defensiva para mocks)
    const innerMessage =
      typeof verifyResult.error === 'object' &&
      verifyResult.error !== null &&
      'message' in verifyResult.error
        ? (verifyResult.error as { message: string }).message
        : String(verifyResult.error)
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'verify_failed',
        message: formatMessage(messages.verifyFailedAfterRefresh, innerMessage),
        status: 401,
      } satisfies EvaSdkError,
    }
  }

  return {
    ok: true,
    data: {
      payload: verifyResult.data,
      newCookies: setTokenCookies(tokens),
    },
  }
}

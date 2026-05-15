import type { ZodType } from 'zod'
import { verifyAccessToken } from '../jwt'
import { readTokensFromCookies, setTokenCookies } from '../cookies'
import { createHttpClient } from '../http-client'
import { deduplicateRefresh } from '../refresh-dedup'
import type { EvaTokenPayload, Result, EvaSdkError } from '../types'
import { resolveErrorMessages, formatMessage, type EvaErrorMessages } from '../error-messages'
import { getErrorMessages, validateErrorMessagesInput } from '../config'

export type VerifyRequestOptions<TExtra extends Record<string, unknown>> = {
  extraClaimsSchema?: ZodType<TExtra>
  errorMessages?: Partial<EvaErrorMessages>
}

type VerifyResult<TExtra extends Record<string, unknown>> = {
  payload: EvaTokenPayload<TExtra>
  newCookies?: string[]
}

const client = createHttpClient()

export async function verifyRequest<TExtra extends Record<string, unknown> = {}>(
  request: Request,
  opts: VerifyRequestOptions<TExtra> = {},
): Promise<Result<VerifyResult<TExtra>>> {
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

  const refreshResult = await deduplicateRefresh(refreshToken, () => client.refresh({ refreshToken }))

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

  // Path: verify post-refresh falló → verify_failed (REQ-SDK-04, REQ-SDK-05)
  if (!verifyResult.ok) {
    // Obtener mensaje del error (EvaSdkError tiene .message; compatibilidad defensiva para mocks)
    const innerMessage =
      typeof verifyResult.error === 'object' && verifyResult.error !== null && 'message' in verifyResult.error
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

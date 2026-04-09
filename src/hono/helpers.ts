import type { Context } from 'hono'
import type { EvaTokenPayload } from '../types'

export function getEvaPayload(c: Context): EvaTokenPayload {
  const payload = c.get('evaPayload') as EvaTokenPayload | undefined
  if (!payload) throw new Error('Middleware evaAuth no aplicado')
  return payload
}

/** @deprecated Usa getEvaPayload() en su lugar. Retorna EvaTokenPayload, no EvaUser. */
export function getEvaUser(c: Context): EvaTokenPayload {
  return getEvaPayload(c)
}

export function getSessionId(c: Context): string {
  return getEvaPayload(c).sessionId
}

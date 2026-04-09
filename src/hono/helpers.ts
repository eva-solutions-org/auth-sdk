import type { Context } from 'hono'
import type { EvaTokenPayload } from '../types'

export function getEvaPayload(c: Context): EvaTokenPayload {
  const payload = c.get('evaPayload') as EvaTokenPayload | undefined
  if (!payload) throw new Error('Middleware evaAuth no aplicado')
  return payload
}

export function getSessionId(c: Context): string {
  return getEvaPayload(c).sessionId
}

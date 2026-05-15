import type { Context } from 'hono'
import type { EvaTokenPayload } from '../types'
import type { EvaAuthVariables } from './middleware'

export function getEvaPayload<TExtra extends Record<string, unknown> = {}>(
  c: Context<{ Variables: EvaAuthVariables<TExtra> }>,
): EvaTokenPayload<TExtra> {
  const payload = c.get('evaPayload')
  if (!payload) throw new Error('Middleware evaAuth no aplicado')
  return payload
}

export function getSessionId<TExtra extends Record<string, unknown> = {}>(
  c: Context<{ Variables: EvaAuthVariables<TExtra> }>,
): string {
  return getEvaPayload(c).sessionId
}

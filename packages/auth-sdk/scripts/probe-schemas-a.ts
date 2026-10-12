/**
 * Probe B1: schema reuse cross-module.
 * Este módulo exporta schemas Zod 4 que serán importados desde probe-openapi.ts
 * (módulo distinto) para verificar que defineOpenAPIRoute infiere tipos correctamente.
 */
import { z } from 'zod'

export const ProbeLoginSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
})

export const ProbeGetCodeSchema = z.object({
  phone: z.string().min(1),
})

export const ProbeErrorResponseSchema = z.object({
  error: z.string(),
})

export const ProbeLoginResponseSchema = z.object({
  data: z.object({
    user: z.object({ id: z.string() }),
  }),
})

export type ProbeLoginInput = z.infer<typeof ProbeLoginSchema>
export type ProbeGetCodeInput = z.infer<typeof ProbeGetCodeSchema>

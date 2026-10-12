import { z } from 'zod'
import { publicProfileSchema } from './users'

/**
 * SCHEMA module: service-to-service users batch. The request schema has NO maximum on `ids`: the
 * cap is `USERS_BATCH_MAX_IDS` (constants), enforced by whoever applies it, so the published
 * OpenAPI document keeps carrying no `maxItems`.
 */

export const usersBatchRequestSchema = z
  .object({
    ids: z.array(z.string()).meta({
      description:
        'IDs de usuarios. Strings que no sean UUID v4 se filtran tolerantemente.',
    }),
  })
  .strict()

export const usersBatchResponseSchema = z.object({
  data: z.object({
    users: z.array(publicProfileSchema).meta({
      description: 'Usuarios activos encontrados. No se garantiza el orden.',
    }),
  }),
})

export type UsersBatchRequest = z.input<typeof usersBatchRequestSchema>
export type UsersBatchResponse = z.output<typeof usersBatchResponseSchema>

import { z } from 'zod'
import { USERS_BATCH_MAX_IDS } from './constants'
import { publicProfileSchema } from './users'

/**
 * SCHEMA module: service-to-service users batch. `ids` is capped at `USERS_BATCH_MAX_IDS`
 * (constants), the hard upper bound: the API env `USERS_BATCH_MAX_IDS` can only lower it, and the
 * published OpenAPI document carries it as `maxItems`.
 */

export const usersBatchRequestSchema = z
  .object({
    ids: z.array(z.string()).max(USERS_BATCH_MAX_IDS).meta({
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

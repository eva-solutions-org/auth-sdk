import { z } from 'zod'

/**
 * SCHEMA module: generic confirmation responses shared by several routes. Descriptions are wire
 * text and must not name routes.
 */

/** Response with a confirmation message. */
export const messageResponseSchema = z.object({
  data: z.object({
    message: z.string().meta({ description: 'Mensaje de confirmación' }),
  }),
})

/** Response with a confirmation message and the number of affected items. */
export const messageWithCountResponseSchema = z.object({
  data: z.object({
    message: z.string().meta({ description: 'Mensaje de confirmación' }),
    count: z.number().meta({ description: 'Cantidad de elementos afectados' }),
  }),
})

export type MessageResponse = z.output<typeof messageResponseSchema>
export type MessageWithCountResponse = z.output<
  typeof messageWithCountResponseSchema
>

import { z } from 'zod'

/**
 * SCHEMA module: on-demand cleanup of expired data (admin). The query is a strict BASE object with
 * no refinements, and descriptions are wire text: they must not name routes.
 */

/**
 * Query of `POST /admin/maintenance/cleanup`: `limit` (default and maximum 100) caps each of the two
 * batches of one call. Strict: a misspelled parameter fails instead of being ignored.
 */
export const maintenanceCleanupQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict()

export const maintenanceCleanupResponseSchema = z.object({
  data: z.object({
    usersPurged: z.number().int().meta({
      description:
        'Cuentas eliminadas con la ventana de restauración vencida, purgadas en esta llamada',
    }),
    eventsDeleted: z.number().int().meta({
      description:
        'Eventos de webhook sin entregas vivas y fuera de la retención, borrados en esta llamada',
    }),
    hasMore: z.boolean().meta({
      description: 'true si queda más por limpiar: vuelve a llamar',
    }),
  }),
})

export type MaintenanceCleanupQuery = z.input<
  typeof maintenanceCleanupQuerySchema
>
export type MaintenanceCleanupResponse = z.output<
  typeof maintenanceCleanupResponseSchema
>

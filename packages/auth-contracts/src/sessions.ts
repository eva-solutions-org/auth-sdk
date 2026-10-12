import { z } from 'zod'

/** SCHEMA module: the active sessions of the authenticated user. */

/** Response of the active sessions list. */
export const sessionListResponseSchema = z.object({
  data: z
    .array(
      z.object({
        sessionId: z.uuid().meta({ description: 'ID de la sesión' }),
        deviceType: z.string().meta({ description: 'Tipo de dispositivo' }),
        os: z.string().meta({ description: 'Sistema operativo' }),
        browser: z.string().meta({ description: 'Navegador' }),
        ipAddress: z.string().meta({ description: 'Dirección IP' }),
        createdAt: z
          .string()
          .meta({ description: 'Fecha de creación de la sesión' }),
        current: z
          .boolean()
          .meta({ description: 'Indica si es la sesión actual' }),
      }),
    )
    .meta({ description: 'Lista de sesiones' }),
})

export type SessionListResponse = z.output<typeof sessionListResponseSchema>
export type Session = SessionListResponse['data'][number]

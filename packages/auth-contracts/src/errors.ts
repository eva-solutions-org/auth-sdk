import { z } from 'zod'

/**
 * SCHEMA module (it calls `.meta()` at load time): react-reachable SDK code must not import it by
 * value. It holds only the error body; the error codes live in the PURE `constants.ts`.
 *
 * Wire shape `{ error: { code, message } }`. `code` is an open `string`, not an enum: features add
 * their own snake_case codes. Metadata uses only the zod-native metadata API, never the zod-to-openapi extension.
 */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({
        description: 'Código de error enumerado (snake_case ASCII)',
      }),
      message: z
        .string()
        .meta({ description: 'Mensaje human-readable del error' }),
    }),
  })
  .meta({ id: 'ErrorBody' })

export type ErrorResponse = z.output<typeof errorResponseSchema>

import { z } from 'zod'
import {
  CONTRATACION_ESTADOS,
  CONTRATACION_ESTADOS_FACTURACION,
} from './empresa-vocab'

/**
 * SCHEMA module: contracts of a product by a company (`empresa_productos`). A product asks for
 * its own contract (`POST`) or cancels it (`DELETE`) with its service token (permission
 * `contrataciones:pedir`, grantable to products) plus the access token
 * of a holder (`subjectToken`, see `empresas.ts`); billing (permission `contrataciones:escribir`, never granted to a product,
 * no product) and the Auth admin write any row with `PUT`. Only `prueba` and `activo`, with
 * `hasta` empty or in the future, count as contracted.
 */

export const contratacionSchema = z.object({
  empresaId: z.string(),
  producto: z.string(),
  estado: z.enum(CONTRATACION_ESTADOS),
  desde: z.string().meta({ description: 'Timestamp ISO 8601 de inicio' }),
  hasta: z.string().nullable().meta({
    description: 'Timestamp ISO 8601 de vencimiento; null = sin vencimiento',
  }),
  actualizadoEn: z.string(),
})

/**
 * `PUT .../productos/{producto}` (billing and the Auth admin). `hasta` omitted leaves it as is;
 * `null` removes the end; a value sets (or extends) it.
 */
export const setContratacionRequestSchema = z
  .object({
    estado: z.enum(CONTRATACION_ESTADOS_FACTURACION),
    hasta: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()

/** Answer of asking for (201) and of writing (200) a contract. */
export const contratacionResponseSchema = z.object({ data: contratacionSchema })

/** `GET /internal/empresas/{id}/productos/{producto}`: for shared services that serve service-to-service calls. */
export const contratadoResponseSchema = z.object({
  data: z.object({ contratado: z.boolean() }),
})

export type Contratacion = z.output<typeof contratacionSchema>
export type SetContratacionRequest = z.input<
  typeof setContratacionRequestSchema
>
export type ContratacionResponse = z.output<typeof contratacionResponseSchema>
export type ContratadoResponse = z.output<typeof contratadoResponseSchema>

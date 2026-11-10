import { z } from 'zod'
import { productoSlugSchema } from './auth'

/**
 * SCHEMA module: products (the audience of the user access token) as administered through the
 * signed `/admin` surface. There is no delete: a product is disabled. The API applies the rules
 * the contract does not carry (no refinements here): a slug that equals a service audience
 * (`isServiceAudience`) is a 400, and an update body with no field is a 400.
 */

const nombreSchema = z.string().trim().min(1).max(100)

export const productoSchema = z
  .object({
    slug: z.string(),
    nombre: z.string(),
    enabled: z.boolean(),
  })
  .meta({ id: 'Producto' })

export const createProductoRequestSchema = z
  .object({
    slug: productoSlugSchema,
    nombre: nombreSchema,
    enabled: z.boolean().optional().default(true),
  })
  .strict()

/** Update body: strict BASE object, every field optional. */
export const updateProductoRequestSchema = z
  .object({
    nombre: nombreSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

export const listProductosResponseSchema = z
  .object({ data: z.object({ productos: z.array(productoSchema) }) })
  .meta({ id: 'AdminProductosResponse' })

/** Answer of creating (201) and of updating (200) a product. */
export const productoResponseSchema = z
  .object({ data: z.object({ producto: productoSchema }) })
  .meta({ id: 'AdminProductoResponse' })

export type Producto = z.output<typeof productoSchema>
export type CreateProductoRequest = z.input<typeof createProductoRequestSchema>
export type UpdateProductoRequest = z.input<typeof updateProductoRequestSchema>
export type ListProductosResponse = z.output<typeof listProductosResponseSchema>
export type ProductoResponse = z.output<typeof productoResponseSchema>

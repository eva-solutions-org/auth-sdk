import { z } from 'zod'

/**
 * SCHEMA module: companies, their branches and members, as exposed by the service-to-service API.
 * Request bodies are strict BASE objects with no refinements. Auth stores no roles: who may ask
 * for each operation is decided by the product with its own roles.
 */

const idSchema = z.string().min(1).max(64)

/** Branch of a company. */
export const sucursalSchema = z.object({
  id: z.string().meta({ description: 'ID de la sucursal' }),
  empresaId: z.string().meta({ description: 'ID de la empresa' }),
  nombre: z.string().meta({ description: 'Nombre de la sucursal' }),
  direccion: z
    .string()
    .nullable()
    .meta({ description: 'Dirección de la sucursal' }),
})

export const createEmpresaRequestSchema = z
  .object({
    ruc: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .meta({ description: 'RUC de la empresa' }),
    razonSocial: z.string().trim().min(1).max(200),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, {
      error: 'slug debe matchear ^[a-z0-9][a-z0-9-]{1,63}$',
    }),
    direccion: z.string().min(1).max(500).optional(),
    celular: z.string().min(1).max(30).optional(),
    email: z.string().trim().toLowerCase().max(254).email().optional(),
    primerMiembroUserId: idSchema.meta({
      description: 'Usuario que queda como primer miembro de la empresa',
    }),
  })
  .strict()

export const addEmpresaMemberRequestSchema = z
  .object({ userId: idSchema })
  .strict()

export const createSucursalRequestSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100),
    direccion: z.string().min(1).max(500).optional(),
  })
  .strict()

const empresaFields = {
  id: z.string().meta({ description: 'ID de la empresa' }),
  ruc: z.string().meta({ description: 'RUC de la empresa' }),
  razonSocial: z.string().meta({ description: 'Razón social' }),
  slug: z.string().meta({ description: 'Slug identificador' }),
  direccion: z
    .string()
    .nullable()
    .meta({ description: 'Dirección de la empresa' }),
  celular: z.string().nullable().meta({ description: 'Celular de contacto' }),
  email: z.string().nullable().meta({ description: 'Email de contacto' }),
  img: z.string().nullable().meta({ description: 'URL de imagen/logo' }),
}

/** Company as answered by its creation (201). */
export const empresaResponseSchema = z.object({
  data: z.object(empresaFields),
})

/** Company with its branches and members (`GET /internal/empresas/{id}`). */
export const empresaDetailResponseSchema = z.object({
  data: z.object({
    ...empresaFields,
    sucursales: z.array(sucursalSchema),
    miembros: z.array(z.object({ userId: z.string() })),
  }),
})

/** Answer of adding a member (201). */
export const empresaMemberResponseSchema = z.object({
  data: z.object({ empresaId: z.string(), userId: z.string() }),
})

/** Answer of creating a branch (201). */
export const sucursalResponseSchema = z.object({ data: sucursalSchema })

export type Sucursal = z.output<typeof sucursalSchema>
export type CreateEmpresaRequest = z.input<typeof createEmpresaRequestSchema>
export type AddEmpresaMemberRequest = z.input<
  typeof addEmpresaMemberRequestSchema
>
export type CreateSucursalRequest = z.input<typeof createSucursalRequestSchema>
export type EmpresaResponse = z.output<typeof empresaResponseSchema>
export type EmpresaDetailResponse = z.output<typeof empresaDetailResponseSchema>
export type EmpresaMemberResponse = z.output<typeof empresaMemberResponseSchema>
export type SucursalResponse = z.output<typeof sucursalResponseSchema>

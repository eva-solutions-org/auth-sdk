import { z } from 'zod'

/**
 * SCHEMA module: the directory of companies, the only cross-company search. Open to users with the
 * access token of any enabled product (rate limited per user) and to services with
 * `directorio:leer`. Only active, opted-in companies, only the public profile fields, at most 50
 * per page.
 */

export const directorioQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    rubro: z.string().trim().min(1).max(100).optional(),
    ciudad: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict()

export const directorioEmpresaSchema = z.object({
  id: z.string(),
  razonSocial: z.string(),
  rubro: z.string().nullable(),
  ciudad: z.string().nullable(),
  descripcion: z.string().nullable(),
  img: z.string().nullable(),
})

export const directorioResponseSchema = z.object({
  data: z.object({
    empresas: z.array(directorioEmpresaSchema),
    nextCursor: z.string().nullable(),
  }),
})

export type DirectorioQuery = z.input<typeof directorioQuerySchema>
export type DirectorioEmpresa = z.output<typeof directorioEmpresaSchema>
export type DirectorioResponse = z.output<typeof directorioResponseSchema>

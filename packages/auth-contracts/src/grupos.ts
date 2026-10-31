import { z } from 'zod'
import { subjectTokenRequestSchema, subjectTokenSchema } from './empresas'

/**
 * SCHEMA module: groups of companies (grouping only, they grant no access: membership stays per
 * company). Only a holder (`titular`) groups: every request carries the `subjectToken` of a person
 * who holds the companies involved. A group left with no companies deletes itself.
 */

const idSchema = z.string().min(1).max(64)
const nombreSchema = z.string().trim().min(1).max(100)

export const grupoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  empresaIds: z.array(z.string()),
})

/** Creates a group with one company of the person. */
export const createGrupoRequestSchema = z
  .object({
    nombre: nombreSchema,
    empresaId: idSchema,
    subjectToken: subjectTokenSchema,
  })
  .strict()

/** Renaming: a holder of any company of the group. */
export const renameGrupoRequestSchema = z
  .object({ nombre: nombreSchema, subjectToken: subjectTokenSchema })
  .strict()

export const addGrupoEmpresaRequestSchema = z
  .object({ empresaId: idSchema, subjectToken: subjectTokenSchema })
  .strict()

export const removeGrupoEmpresaRequestSchema = subjectTokenRequestSchema

/** Answer of creating (201), renaming (200) and adding a company (201). */
export const grupoResponseSchema = z.object({ data: grupoSchema })

export type Grupo = z.output<typeof grupoSchema>
export type CreateGrupoRequest = z.input<typeof createGrupoRequestSchema>
export type RenameGrupoRequest = z.input<typeof renameGrupoRequestSchema>
export type AddGrupoEmpresaRequest = z.input<
  typeof addGrupoEmpresaRequestSchema
>
export type RemoveGrupoEmpresaRequest = z.input<
  typeof removeGrupoEmpresaRequestSchema
>
export type GrupoResponse = z.output<typeof grupoResponseSchema>

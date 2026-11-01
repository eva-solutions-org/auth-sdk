import { z } from 'zod'
import { INTER_EMPRESA_PERMISSION_LIST } from './catalog'
import { AUTORIZACION_DIRECCIONES } from './empresa-vocab'
import { subjectTokenRequestSchema, subjectTokenSchema } from './empresas'

/**
 * SCHEMA module: authorizations between companies, only for private data. The permission is one
 * of the closed inter-company catalog (`INTER_EMPRESA_PERMISSIONS`), never a service permission.
 * An administrator or the holder of the grantor grants and revokes; one of the beneficiary can
 * renounce (all with the `subjectToken` mechanism of `empresas.ts`). Which permissions a product
 * may grant is administered with `producto_permisos_autorizables`.
 */

const idSchema = z.string().min(1).max(64)

export const interEmpresaPermissionSchema = z.enum(
  INTER_EMPRESA_PERMISSION_LIST,
)

export const createAutorizacionRequestSchema = z
  .object({
    beneficiariaId: idSchema,
    permiso: interEmpresaPermissionSchema,
    subjectToken: subjectTokenSchema,
  })
  .strict()

/** `DELETE`: revocation by the grantor or renunciation by the beneficiary. */
export const deleteAutorizacionRequestSchema = subjectTokenRequestSchema

/** Query of `GET /internal/empresas/{id}/autorizaciones` (the person goes in `SUBJECT_TOKEN_HEADER`). */
export const listAutorizacionesQuerySchema = z
  .object({ direccion: z.enum(AUTORIZACION_DIRECCIONES) })
  .strict()

/**
 * Query of `GET /internal/autorizaciones/verificar`: only for actors whose audience owns the
 * permission (the actor may also have a product). Valid only while both companies are active.
 */
export const verificarAutorizacionQuerySchema = z
  .object({
    otorgante: idSchema,
    beneficiaria: idSchema,
    permiso: interEmpresaPermissionSchema,
  })
  .strict()

/** Authorization in force. */
export const autorizacionSchema = z.object({
  id: z.string(),
  otorganteId: z.string(),
  beneficiariaId: z.string(),
  permiso: z.string(),
  creadaEn: z.string(),
  creadaPor: z.string().meta({ description: 'Persona que la concedió' }),
})

export const autorizacionResponseSchema = z.object({ data: autorizacionSchema })

export const listAutorizacionesResponseSchema = z.object({
  data: z.object({ autorizaciones: z.array(autorizacionSchema) }),
})

export const verificarAutorizacionResponseSchema = z.object({
  data: z.object({ autorizado: z.boolean() }),
})

/** Permissions of the inter-company catalog without repeats (first order kept); an empty list clears them. */
export const setProductoPermisosAutorizablesRequestSchema = z
  .object({
    permisos: z
      .array(interEmpresaPermissionSchema)
      .max(64)
      .transform((list) => [...new Set(list)]),
  })
  .strict()

/** Permissions a product may grant on behalf of its companies (admin). */
export const productoPermisosAutorizablesResponseSchema = z
  .object({
    data: z.object({ producto: z.string(), permisos: z.array(z.string()) }),
  })
  .meta({ id: 'AdminProductoPermisosAutorizablesResponse' })

export type CreateAutorizacionRequest = z.input<
  typeof createAutorizacionRequestSchema
>
export type DeleteAutorizacionRequest = z.input<
  typeof deleteAutorizacionRequestSchema
>
export type ListAutorizacionesQuery = z.input<
  typeof listAutorizacionesQuerySchema
>
export type VerificarAutorizacionQuery = z.input<
  typeof verificarAutorizacionQuerySchema
>
export type Autorizacion = z.output<typeof autorizacionSchema>
export type AutorizacionResponse = z.output<typeof autorizacionResponseSchema>
export type ListAutorizacionesResponse = z.output<
  typeof listAutorizacionesResponseSchema
>
export type VerificarAutorizacionResponse = z.output<
  typeof verificarAutorizacionResponseSchema
>
export type SetProductoPermisosAutorizablesRequest = z.input<
  typeof setProductoPermisosAutorizablesRequestSchema
>
export type ProductoPermisosAutorizablesResponse = z.output<
  typeof productoPermisosAutorizablesResponseSchema
>

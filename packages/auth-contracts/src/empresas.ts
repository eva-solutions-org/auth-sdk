import { z } from 'zod'
import {
  EMPRESA_ESTADOS,
  EMPRESA_ROLES,
  TITULAR_ANTERIOR_DESTINOS,
} from './empresa-vocab'

/**
 * SCHEMA module: companies, their branches and members, as exposed by the service-to-service API
 * and the admin surface. Request bodies are strict BASE objects with no refinements (the API adds
 * rules like "at least one field").
 *
 * One mechanism for every action of a person on a company: the backend of a product sends its
 * service token (Bearer, `aud: auth-api`, the route permission) PLUS the access token of the person
 * as `subjectToken` in the body (`SUBJECT_TOKEN_HEADER` on the requests that have no body). The
 * company comes from the route, never from the session. What is reserved to the Auth admin or to
 * billing carries no `subjectToken`.
 */

const idSchema = z.string().min(1).max(64)

/** Access token (`at+jwt`) of the person on whose behalf a product acts. */
export const subjectTokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .meta({ description: 'Access token de la persona que pide la acción' })

/** Body of the requests that carry nothing but the person (`DELETE` and the like). */
export const subjectTokenRequestSchema = z
  .object({ subjectToken: subjectTokenSchema })
  .strict()

/** Branch of a company. */
export const sucursalSchema = z.object({
  id: z.string().meta({ description: 'ID de la sucursal' }),
  empresaId: z.string().meta({ description: 'ID de la empresa' }),
  nombre: z.string().meta({ description: 'Nombre de la sucursal' }),
  direccion: z
    .string()
    .nullable()
    .meta({ description: 'Dirección de la sucursal' }),
  activa: z.boolean().meta({
    description: 'false tras la baja lógica de la sucursal',
  }),
})

/** Branch as seen by an actor with no product: no address. */
export const sucursalRecortadaSchema = sucursalSchema.pick({
  id: true,
  empresaId: true,
  nombre: true,
  activa: true,
})

/** Public profile of a company (the directory shows only these fields, and only when `visible`). */
export const empresaPerfilSchema = z.object({
  visible: z.boolean().meta({
    description: 'La empresa aparece en el directorio (false por defecto)',
  }),
  rubro: z.string().nullable(),
  ciudad: z.string().nullable(),
  descripcion: z.string().nullable(),
})

const rubroSchema = z.string().trim().min(1).max(100)
const ciudadSchema = z.string().trim().min(1).max(100)
const descripcionSchema = z.string().trim().min(1).max(1000)

/** Profile fields of the update body: `null` clears the value. */
export const updateEmpresaPerfilSchema = z
  .object({
    visible: z.boolean().optional(),
    rubro: rubroSchema.nullable().optional(),
    ciudad: ciudadSchema.nullable().optional(),
    descripcion: descripcionSchema.nullable().optional(),
  })
  .strict()

const rucSchema = z.string().trim().min(1).max(20)
const razonSocialSchema = z.string().trim().min(1).max(200)
const direccionSchema = z.string().min(1).max(500)
const celularSchema = z.string().min(1).max(30)
const emailSchema = z.string().trim().toLowerCase().max(254).email()
const imgSchema = z.string().trim().url().max(2048)

/**
 * `POST /internal/empresas`. The person of `subjectToken` becomes the holder (`titular`) and the
 * product of the actor is contracted in `prueba`. An actor with no product cannot create companies.
 */
export const createEmpresaRequestSchema = z
  .object({
    ruc: rucSchema.meta({ description: 'RUC de la empresa' }),
    razonSocial: razonSocialSchema,
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, {
      error: 'slug debe matchear ^[a-z0-9][a-z0-9-]{1,63}$',
    }),
    direccion: direccionSchema.optional(),
    celular: celularSchema.optional(),
    email: emailSchema.optional(),
    subjectToken: subjectTokenSchema,
  })
  .strict()

/**
 * `PATCH /internal/empresas/{id}`: master data, profile and directory visibility. `ruc` and `slug`
 * are immutable (a body carrying them is rejected by `.strict()`).
 */
export const updateEmpresaRequestSchema = z
  .object({
    razonSocial: razonSocialSchema.optional(),
    direccion: direccionSchema.nullable().optional(),
    celular: celularSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
    img: imgSchema.nullable().optional(),
    perfil: updateEmpresaPerfilSchema.optional(),
    subjectToken: subjectTokenSchema,
  })
  .strict()

/** Query of `GET /internal/empresas`: the companies that contracted the product of the actor. */
export const listEmpresasQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict()

export const addEmpresaMemberRequestSchema = z
  .object({ userId: idSchema, subjectToken: subjectTokenSchema })
  .strict()

/** `PATCH /internal/empresas/{id}/miembros/{userId}`: only the holder changes roles. */
export const updateEmpresaMemberRequestSchema = z
  .object({ rol: z.enum(EMPRESA_ROLES), subjectToken: subjectTokenSchema })
  .strict()

/** `DELETE /internal/empresas/{id}/miembros/{userId}`: `userId` = the person of the token leaves by their own account. */
export const removeEmpresaMemberRequestSchema = subjectTokenRequestSchema

export const createSucursalRequestSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100),
    direccion: direccionSchema.optional(),
    subjectToken: subjectTokenSchema,
  })
  .strict()

export const updateSucursalRequestSchema = z
  .object({
    nombre: z.string().trim().min(1).max(100).optional(),
    direccion: direccionSchema.nullable().optional(),
    subjectToken: subjectTokenSchema,
  })
  .strict()

/** `DELETE /internal/empresas/{id}/sucursales/{sucursalId}` is a logical deactivation (`activa = false`). */
export const deactivateSucursalRequestSchema = subjectTokenRequestSchema

/**
 * `POST /admin/empresas/{id}/titular`: dispute over a RUC or a company with no holder. The person
 * becomes the holder; the previous holder (if any) stays as a `miembro` or leaves, as the runbook says.
 */
export const reassignTitularRequestSchema = z
  .object({
    userId: idSchema,
    titularAnterior: z
      .enum(TITULAR_ANTERIOR_DESTINOS)
      .optional()
      .default('miembro'),
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
  estado: z.enum(EMPRESA_ESTADOS),
  grupoId: z
    .string()
    .nullable()
    .meta({ description: 'Grupo de empresas al que pertenece, si tiene' }),
  perfil: empresaPerfilSchema,
}

/** Company as answered by its creation (201) and its update (200). */
export const empresaResponseSchema = z.object({
  data: z.object(empresaFields),
})

/** Page of companies; `nextCursor` is `null` on the last page. */
export const listEmpresasResponseSchema = z.object({
  data: z.object({
    empresas: z.array(z.object(empresaFields)),
    nextCursor: z.string().nullable(),
  }),
})

/** Full view (`GET /internal/empresas/{id}`) for an actor whose product the company contracted. */
export const empresaDetailResponseSchema = z.object({
  data: z.object({
    vista: z.literal('completa'),
    ...empresaFields,
    sucursales: z.array(sucursalSchema),
    miembros: z.array(
      z.object({ userId: z.string(), rol: z.enum(EMPRESA_ROLES) }),
    ),
  }),
})

/** Trimmed view for an actor with no product (a shared service): no contact data, no members. */
export const empresaRecortadaResponseSchema = z.object({
  data: z.object({
    vista: z.literal('recortada'),
    id: z.string(),
    razonSocial: z.string(),
    estado: z.enum(EMPRESA_ESTADOS),
    sucursales: z.array(sucursalRecortadaSchema),
  }),
})

/** `GET /internal/empresas/{id}`: one of the two views, told apart by `data.vista`. */
export const getEmpresaResponseSchema = z.object({
  data: z.discriminatedUnion('vista', [
    empresaDetailResponseSchema.shape.data,
    empresaRecortadaResponseSchema.shape.data,
  ]),
})

/** Answer of adding a member (201) and of changing a role (200). */
export const empresaMemberResponseSchema = z.object({
  data: z.object({
    empresaId: z.string(),
    userId: z.string(),
    rol: z.enum(EMPRESA_ROLES),
  }),
})

/** Answer of creating (201) and updating (200) a branch. */
export const sucursalResponseSchema = z.object({ data: sucursalSchema })

/** Answer of `baja` and `reactivar` (internal with `empresas:baja`, and admin). */
export const empresaEstadoResponseSchema = z.object({
  data: z.object({ id: z.string(), estado: z.enum(EMPRESA_ESTADOS) }),
})

/** Answer of the holder reassignment. */
export const reassignTitularResponseSchema = z.object({
  data: z.object({
    empresaId: z.string(),
    titularUserId: z.string(),
    titularAnteriorUserId: z.string().nullable(),
  }),
})

export type Sucursal = z.output<typeof sucursalSchema>
export type SucursalRecortada = z.output<typeof sucursalRecortadaSchema>
export type EmpresaPerfil = z.output<typeof empresaPerfilSchema>
export type CreateEmpresaRequest = z.input<typeof createEmpresaRequestSchema>
export type UpdateEmpresaRequest = z.input<typeof updateEmpresaRequestSchema>
export type ListEmpresasQuery = z.input<typeof listEmpresasQuerySchema>
export type AddEmpresaMemberRequest = z.input<
  typeof addEmpresaMemberRequestSchema
>
export type UpdateEmpresaMemberRequest = z.input<
  typeof updateEmpresaMemberRequestSchema
>
export type RemoveEmpresaMemberRequest = z.input<
  typeof removeEmpresaMemberRequestSchema
>
export type CreateSucursalRequest = z.input<typeof createSucursalRequestSchema>
export type UpdateSucursalRequest = z.input<typeof updateSucursalRequestSchema>
export type DeactivateSucursalRequest = z.input<
  typeof deactivateSucursalRequestSchema
>
export type ReassignTitularRequest = z.input<
  typeof reassignTitularRequestSchema
>
export type EmpresaResponse = z.output<typeof empresaResponseSchema>
export type ListEmpresasResponse = z.output<typeof listEmpresasResponseSchema>
export type EmpresaDetailResponse = z.output<typeof empresaDetailResponseSchema>
export type EmpresaRecortadaResponse = z.output<
  typeof empresaRecortadaResponseSchema
>
export type GetEmpresaResponse = z.output<typeof getEmpresaResponseSchema>
export type EmpresaMemberResponse = z.output<typeof empresaMemberResponseSchema>
export type SucursalResponse = z.output<typeof sucursalResponseSchema>
export type EmpresaEstadoResponse = z.output<typeof empresaEstadoResponseSchema>
export type ReassignTitularResponse = z.output<
  typeof reassignTitularResponseSchema
>

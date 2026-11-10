import { z } from 'zod'
import { productoSlugSchema } from './auth'
import { SERVICE_AUDIENCE_SCOPES, SERVICE_AUDIENCES } from './catalog'

/**
 * SCHEMA module: service client provisioning (admin) and the user restore answer. The update body
 * is the strict BASE object: the API adds its own "at least one field" rule on top of it, so this
 * package never carries a refinement. The format of the generated key stays in the API.
 */

/** Human readable slug: starts with a lower case letter, 3 to 64 chars of `[a-z0-9-]`. */
export const serviceClientSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{2,63}$/, {
    error: 'slug debe matchear ^[a-z][a-z0-9-]{2,63}$',
  })

/**
 * Permissions of one audience without repeats. Duplicates are removed (first order kept) instead
 * of rejected: repeating a scope does not change what is granted. At least one is required (a
 * grant with no permissions is removed, not stored) and the input list is bounded (repeats
 * included) so a request cannot carry an arbitrarily long array.
 */
const scopesOf = <const T extends readonly [string, ...string[]]>(scopes: T) =>
  z
    .array(z.enum(scopes))
    .min(1)
    .max(16)
    .transform((list) => [...new Set(list)])

/**
 * Create or replace the grant of a service client on one audience. One variant per audience of the
 * catalog, so a permission typo or a permission of another audience (`admin` on `auth-api`) is
 * rejected by the schema itself. A test pins that every audience has its variant.
 */
export const setServiceClientGrantRequestSchema = z.discriminatedUnion(
  'audience',
  [
    z
      .object({
        audience: z.literal('auth-api'),
        scopes: scopesOf(SERVICE_AUDIENCE_SCOPES['auth-api']),
      })
      .strict(),
    z
      .object({
        audience: z.literal('whatsapp-api'),
        scopes: scopesOf(SERVICE_AUDIENCE_SCOPES['whatsapp-api']),
      })
      .strict(),
  ],
)

export const serviceClientGrantSchema = z
  .object({
    audience: z.enum(SERVICE_AUDIENCES),
    scopes: z.array(z.string()),
  })
  .meta({ id: 'ServiceClientGrant' })

/**
 * Identity of a backend: the product it belongs to (FK to `productos`) and the service audience it
 * IS. Both are set by the admin and may be absent. Product slugs and audiences never coincide.
 * `null` clears the value on update.
 */
const productoOfClientSchema = productoSlugSchema.meta({
  description: 'Producto al que pertenece el backend',
})
const audienciaOfClientSchema = z.enum(SERVICE_AUDIENCES).meta({
  description: 'Servicio que ES el backend (audiencia del catálogo, única)',
})

export const createServiceClientRequestSchema = z
  .object({
    slug: serviceClientSlugSchema,
    name: z.string().min(1).max(100).optional(),
    producto: productoOfClientSchema.optional(),
    audiencia: audienciaOfClientSchema.optional(),
    esAdmin: z.boolean().optional().default(false).meta({
      description:
        'Marca de administrador de Auth: autoriza la superficie /admin firmada',
    }),
  })
  .strict()

/** Update body: strict BASE object, every field optional. */
export const updateServiceClientRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    esAdmin: z.boolean().optional(),
    name: z.string().min(1).max(100).optional(),
    producto: productoOfClientSchema.nullable().optional(),
    audiencia: audienciaOfClientSchema.nullable().optional(),
  })
  .strict()

/** Public view of a service client: it never carries the stored key material. */
export const serviceClientPublicSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    esAdmin: z.boolean(),
    producto: z.string().nullable(),
    audiencia: z.enum(SERVICE_AUDIENCES).nullable(),
    grants: z.array(serviceClientGrantSchema),
    lastUsedAt: z.union([z.string(), z.null()]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'ServiceClientPublic' })

/** Creation answer: the generated key travels only here, one time. */
export const createServiceClientResponseSchema = z
  .object({
    data: z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      esAdmin: z.boolean(),
      producto: z.string().nullable(),
      audiencia: z.enum(SERVICE_AUDIENCES).nullable(),
      enabled: z.literal(true),
      secret: z.string(),
      warning: z.string(),
    }),
  })
  .meta({ id: 'AdminCreateResponse' })

export const listServiceClientsResponseSchema = z
  .object({
    data: z.object({
      clientes: z.array(serviceClientPublicSchema),
    }),
  })
  .meta({ id: 'AdminListResponse' })

export const getServiceClientResponseSchema = z
  .object({
    data: z.object({
      cliente: serviceClientPublicSchema,
    }),
  })
  .meta({ id: 'AdminDetailResponse' })

export const listServiceClientGrantsResponseSchema = z
  .object({
    data: z.object({
      grants: z.array(serviceClientGrantSchema),
    }),
  })
  .meta({ id: 'AdminGrantsResponse' })

export const setServiceClientGrantResponseSchema = z
  .object({
    data: z.object({
      grant: serviceClientGrantSchema,
    }),
  })
  .meta({ id: 'AdminGrantResponse' })

export const updateServiceClientResponseSchema = z
  .object({
    data: z.object({
      cliente: serviceClientPublicSchema,
      warning: z.string().optional(),
    }),
  })
  .meta({ id: 'AdminUpdateResponse' })

export const rotateServiceClientSecretResponseSchema = z
  .object({
    data: z.object({
      slug: z.string(),
      secret: z.string(),
      warning: z.string(),
    }),
  })
  .meta({ id: 'AdminRotateSecretResponse' })

export const restoreUserResponseSchema = z
  .object({
    data: z.object({
      userId: z
        .string()
        .uuid()
        .meta({ description: 'ID del usuario restaurado' }),
      stateAccount: z.literal('no_verificado').meta({
        description:
          'Estado de cuenta tras la restauración (siempre no_verificado)',
      }),
      previouslyDeletedAt: z.string().nullable().meta({
        description: 'Timestamp ISO 8601 de cuando fue eliminado originalmente',
      }),
      restoredAt: z.string().meta({
        description: 'Timestamp ISO 8601 de la restauración',
      }),
    }),
  })
  .meta({ id: 'AdminRestaurarUsuarioResponse' })

export type CreateServiceClientRequest = z.input<
  typeof createServiceClientRequestSchema
>
export type UpdateServiceClientRequest = z.input<
  typeof updateServiceClientRequestSchema
>
export type SetServiceClientGrantRequest = z.input<
  typeof setServiceClientGrantRequestSchema
>
export type ServiceClientGrant = z.output<typeof serviceClientGrantSchema>
export type ListServiceClientGrantsResponse = z.output<
  typeof listServiceClientGrantsResponseSchema
>
export type SetServiceClientGrantResponse = z.output<
  typeof setServiceClientGrantResponseSchema
>
export type ServiceClientPublic = z.output<typeof serviceClientPublicSchema>
export type CreateServiceClientResponse = z.output<
  typeof createServiceClientResponseSchema
>
export type ListServiceClientsResponse = z.output<
  typeof listServiceClientsResponseSchema
>
export type GetServiceClientResponse = z.output<
  typeof getServiceClientResponseSchema
>
export type UpdateServiceClientResponse = z.output<
  typeof updateServiceClientResponseSchema
>
export type RotateServiceClientSecretResponse = z.output<
  typeof rotateServiceClientSecretResponseSchema
>
export type RestoreUserResponse = z.output<typeof restoreUserResponseSchema>

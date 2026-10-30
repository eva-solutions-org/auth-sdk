import { z } from 'zod'
import { SERVICE_CLIENT_SCOPES } from './constants'

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
 * Scopes without repeats. Duplicates are removed (first order kept) instead of rejected: repeating
 * a scope does not change the permissions granted. The input list is bounded (repeats included)
 * so a request cannot carry an arbitrarily long array.
 */
const scopesSchema = z
  .array(z.enum(SERVICE_CLIENT_SCOPES))
  .max(16)
  .transform((scopes) => [...new Set(scopes)])

export const createServiceClientRequestSchema = z
  .object({
    slug: serviceClientSlugSchema,
    name: z.string().min(1).max(100).optional(),
    scopes: scopesSchema.optional().default([]),
  })
  .strict()

/** Update body: strict BASE object, every field optional. */
export const updateServiceClientRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    scopes: scopesSchema.optional(),
    name: z.string().min(1).max(100).optional(),
  })
  .strict()

/** Public view of a service client: it never carries the stored key material. */
export const serviceClientPublicSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    scopes: z.array(z.string()),
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
      scopes: z.array(z.string()),
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

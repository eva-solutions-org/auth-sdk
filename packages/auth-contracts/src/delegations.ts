import { z } from 'zod'
import {
  DELEGABLE_AUDIENCE_SCOPES,
  DELEGABLE_AUDIENCES,
  DELEGABLE_SCOPES,
} from './catalog'

/**
 * SCHEMA module: delegation edges of a service client (admin), `service_client_delegations`. An
 * edge says "this client may exchange a token for a delegated one towards `audience`, carrying at
 * most `scopes`". `auth-api` is never a destination and `admin` is never delegable: the schemas
 * are built from `DELEGABLE_AUDIENCE_SCOPES`, so the typo or the forbidden value is rejected by the
 * schema itself.
 *
 * `requiere_scope_origen` (snake case, like the rest of the token vocabulary) makes the edge usable
 * for a RE-exchange: the incoming delegated token must carry at least one of those permissions. An
 * edge that does not define it admits no re-exchange (only the first hop from a user access token).
 */

/** Permissions of one audience without repeats (first order kept); at least one, bounded. */
const scopesOf = <const T extends readonly [string, ...string[]]>(scopes: T) =>
  z
    .array(z.enum(scopes))
    .min(1)
    .max(16)
    .transform((list) => [...new Set(list)])

const originScopes = z
  .array(z.enum(DELEGABLE_SCOPES))
  .min(1)
  .max(16)
  .transform((list) => [...new Set(list)])

/**
 * Create or replace the edge of a service client towards one audience. One variant per delegable
 * audience; a test pins that every delegable audience has its variant.
 */
export const setServiceClientDelegationRequestSchema = z.discriminatedUnion(
  'audience',
  [
    z
      .object({
        audience: z.literal('whatsapp-api'),
        scopes: scopesOf(DELEGABLE_AUDIENCE_SCOPES['whatsapp-api']),
        requiere_scope_origen: originScopes.optional(),
      })
      .strict(),
  ],
)

export const serviceClientDelegationSchema = z
  .object({
    audience: z.enum(DELEGABLE_AUDIENCES),
    scopes: z.array(z.string()),
    requiere_scope_origen: z.array(z.string()).meta({
      description: 'Vacío = la arista no admite re-exchange',
    }),
  })
  .meta({ id: 'ServiceClientDelegation' })

export const listServiceClientDelegationsResponseSchema = z
  .object({
    data: z.object({ delegations: z.array(serviceClientDelegationSchema) }),
  })
  .meta({ id: 'AdminDelegationsResponse' })

export const setServiceClientDelegationResponseSchema = z
  .object({ data: z.object({ delegation: serviceClientDelegationSchema }) })
  .meta({ id: 'AdminDelegationResponse' })

export type SetServiceClientDelegationRequest = z.input<
  typeof setServiceClientDelegationRequestSchema
>
export type ServiceClientDelegation = z.output<
  typeof serviceClientDelegationSchema
>
export type ListServiceClientDelegationsResponse = z.output<
  typeof listServiceClientDelegationsResponseSchema
>
export type SetServiceClientDelegationResponse = z.output<
  typeof setServiceClientDelegationResponseSchema
>

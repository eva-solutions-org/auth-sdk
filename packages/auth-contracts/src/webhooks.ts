import { z } from 'zod'
import { DELIVERY_STATUSES } from './constants'

/**
 * SCHEMA module: webhook subscriptions and their deliveries. Request bodies are strict BASE
 * objects with no refinements, and descriptions are wire text: they must not name routes.
 */

// Any-version UUID: the filters of the deliveries listing are matched, never generated.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createSubscriptionRequestSchema = z
  .object({
    url: z.string().url().max(2048),
    eventCodes: z.array(z.string()).min(1),
    enabled: z.boolean().optional().default(true),
  })
  .strict()

export const updateSubscriptionRequestSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    eventCodes: z.array(z.string()).min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

/** Query of the deliveries listing: numbers arrive as strings and are coerced. */
export const deliveriesQuerySchema = z
  .object({
    event_id: z.string().regex(UUID_REGEX).optional(),
    subscription_id: z.string().regex(UUID_REGEX).optional(),
    status: z.enum(DELIVERY_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export const subscriptionSchema = z.object({
  id: z.string().meta({ description: 'ID de la subscription' }),
  clientId: z.string().meta({ description: 'ID del cliente' }),
  url: z.string().meta({ description: 'URL del webhook' }),
  eventCodes: z.array(z.string()).meta({ description: 'Eventos suscritos' }),
  enabled: z.boolean().meta({ description: 'Estado activo' }),
  createdAt: z.string().meta({ description: 'Fecha de creación' }),
  updatedAt: z.string().meta({ description: 'Fecha de actualización' }),
})

/** Creation answer: the signing key travels only here, one time. */
export const subscriptionWithSecretResponseSchema = z.object({
  data: z.object({
    subscription: subscriptionSchema,
    signingKey: z.string().meta({ description: 'Signing key one-time' }),
  }),
})

export const subscriptionResponseSchema = z.object({
  data: subscriptionSchema,
})

export const subscriptionListResponseSchema = z.object({
  data: z.object({
    subscriptions: z.array(subscriptionSchema).meta({
      description: 'Lista de subscriptions del cliente',
    }),
  }),
})

export const rotateSubscriptionSecretResponseSchema = z.object({
  data: z.object({
    id: z.string().meta({ description: 'ID de la subscription' }),
    signingKey: z.string().meta({ description: 'Nueva signing key one-time' }),
    updatedAt: z.string().meta({ description: 'Fecha de actualización' }),
  }),
})

export const deliverySchema = z.object({
  id: z.string().meta({ description: 'ID del delivery' }),
  subscriptionId: z.string().meta({ description: 'ID de la subscription' }),
  eventId: z.string().meta({ description: 'ID del evento' }),
  status: z
    .enum(DELIVERY_STATUSES)
    .meta({ description: 'Estado del delivery' }),
  attempts: z.number().meta({ description: 'Número de intentos' }),
  lastAttemptAt: z.string().nullable().meta({ description: 'Último intento' }),
  nextRetryAt: z.string().nullable().meta({ description: 'Próximo retry' }),
  responseStatus: z
    .number()
    .nullable()
    .meta({ description: 'HTTP status de respuesta' }),
  createdAt: z.string().meta({ description: 'Fecha de creación' }),
})

export const deliveryListResponseSchema = z.object({
  data: z.object({
    deliveries: z.array(deliverySchema).meta({
      description: 'Lista de deliveries',
    }),
  }),
})

export type CreateSubscriptionRequest = z.input<
  typeof createSubscriptionRequestSchema
>
export type UpdateSubscriptionRequest = z.input<
  typeof updateSubscriptionRequestSchema
>
export type DeliveriesQuery = z.input<typeof deliveriesQuerySchema>
export type Subscription = z.output<typeof subscriptionSchema>
export type SubscriptionWithSecretResponse = z.output<
  typeof subscriptionWithSecretResponseSchema
>
export type SubscriptionResponse = z.output<typeof subscriptionResponseSchema>
export type SubscriptionListResponse = z.output<
  typeof subscriptionListResponseSchema
>
export type RotateSubscriptionSecretResponse = z.output<
  typeof rotateSubscriptionSecretResponseSchema
>
export type Delivery = z.output<typeof deliverySchema>
export type DeliveryListResponse = z.output<typeof deliveryListResponseSchema>

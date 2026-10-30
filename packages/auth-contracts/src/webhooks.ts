import { z } from 'zod'
import { DELIVERY_STATUSES, EVENT_CODES } from './constants'

/**
 * SCHEMA module: webhook subscriptions and their deliveries. Request bodies are strict BASE
 * objects with no refinements, and descriptions are wire text: they must not name routes.
 */

// Any-version UUID: the filters of the deliveries listing are matched, never generated.
// No regex flags: JSON Schema has none, so a `pattern` generated from a flagged regex would carry
// the flag as literal text and reject every real value. Case-insensitivity uses explicit classes.
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// Webhook target URL: scheme `http` or `https` followed by two slashes, then no whitespace and no
// control characters (C0 and DEL). The scheme is spelled with explicit classes because the regex
// has no flags, and it is part of the published `pattern`, so spec-based validators enforce it too.
// A regex plus a native URL option, not a refinement: request bodies stay
// plain objects. The "no userinfo (`user:pass@host`)" rule is NOT here: for special schemes the
// WHATWG parser accepts `https:u@h`, `https:/u@h` or a backslash form as if the two slashes were
// there, so no regex over the raw text detects it reliably, and a lookahead in the published
// `pattern` would not be portable to RE2 validators. The API applies the rule by parsing the URL.
// oxlint-disable-next-line no-control-regex -- rejecting control characters is the point of this pattern
const WEBHOOK_URL_REGEX = /^[hH][tT][tT][pP][sS]?:\/\/[^\s\x00-\x1F\x7F]+$/

// The regex goes BEFORE `.url()`: zod's url check trims the value it returns, so a regex placed
// after it would never see the padding whitespace it must reject. The `protocol` option is matched
// by zod against the parsed, lowercased scheme, so an uppercase scheme passes; it is not published
// (the JSON Schema keeps `format: uri` and the `pattern` above), which is why the regex also
// carries the scheme.
const webhookUrlSchema = z
  .string()
  .regex(WEBHOOK_URL_REGEX)
  .url({ protocol: /^https?$/ })
  .max(2048)

// Closed catalog of event codes. Duplicates are not rejected here: that needs a refinement, which
// the API applies on top of this schema. The list is bounded (repeats included) so a request cannot
// carry an arbitrarily long array.
const eventCodesSchema = z.array(z.enum(EVENT_CODES)).min(1).max(32)

export const createSubscriptionRequestSchema = z
  .object({
    url: webhookUrlSchema,
    eventCodes: eventCodesSchema,
    enabled: z.boolean().optional().default(true),
  })
  .strict()

export const updateSubscriptionRequestSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    eventCodes: eventCodesSchema.optional(),
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

/**
 * Query of `POST /admin/webhooks/republish-pending`: pending deliveries older than
 * `older_than_minutes` (default 10, at most one week) are republished, `limit` per call (default
 * and maximum 100, one QStash batch). Strict: a misspelled parameter fails instead of being ignored.
 */
export const republishPendingQuerySchema = z
  .object({
    older_than_minutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 7)
      .default(10),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict()

export const republishPendingResponseSchema = z.object({
  data: z.object({
    republished: z.number().int().meta({
      description: 'Entregas republicadas en QStash en esta llamada',
    }),
    hasMore: z.boolean().meta({
      description:
        'true si quedan más entregas pending viejas: vuelve a llamar',
    }),
  }),
})

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
export type RepublishPendingQuery = z.input<typeof republishPendingQuerySchema>
export type RepublishPendingResponse = z.output<
  typeof republishPendingResponseSchema
>
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

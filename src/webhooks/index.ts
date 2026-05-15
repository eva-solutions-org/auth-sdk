/**
 * Entry point del módulo webhooks de @eva/auth-sdk.
 *
 * Importar desde '@eva/auth-sdk/webhooks':
 *   import { verifyWebhookSignature, EVENT_CODES } from '@eva/auth-sdk/webhooks'
 *
 * REQ-EXPORTS-02 LOCKED.
 */

export { verifyWebhookSignature } from './verify-signature'
export type { VerifyWebhookSignatureParams } from './verify-signature'

export {
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
  EVENT_CODES,
  WEBHOOK_HEADERS,
} from './constants'

export type {
  EventCode,
  WebhookPayload,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from './types'

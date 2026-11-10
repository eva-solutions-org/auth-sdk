/**
 * Entry point del módulo webhooks de @eva_solutions/auth-sdk.
 *
 * Importar desde '@eva_solutions/auth-sdk/webhooks':
 *   import { verifyWebhookSignature, EVENT_CODES } from '@eva_solutions/auth-sdk/webhooks'
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

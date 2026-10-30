/**
 * Tipos del módulo Admin para provisioning de service clients y gestión de usuarios.
 *
 * REQ-ADMIN-06 LOCKED.
 */

import type {
  CreateServiceClientResponse,
  MaintenanceCleanupResponse,
  RepublishPendingResponse,
  RotateServiceClientSecretResponse,
  ServiceClientPublic as ContractServiceClientPublic,
  UpdateServiceClientResponse,
} from '@eva_solutions/auth-contracts'
import type { AccountState } from '../account-states'

/**
 * Configuración del cliente Admin: las credenciales de un service client con scope `admin`.
 * Cada request se firma con HMAC S2S; el secret nunca viaja.
 */
export type AdminClientConfig = {
  /** Slug del service client con scope `admin` (clientId). */
  clientId: string
  /** Secret del service client admin en hex (64 chars), el que devuelve su creación o rotación. */
  secretHex: string
  /**
   * URL base del Auth Service API (sin trailing slash).
   * Validada en `createAdminClient`: se requiere https (o http con host loopback para tests).
   */
  baseUrl: string
}

/**
 * Service client público (sin el plaintext del secret).
 * Shape del wire en GET /admin/service-clients/*.
 * Las fechas vienen serializadas como ISO strings en el wire.
 */
export type ServiceClientPublic = ContractServiceClientPublic

/**
 * Input para crear un nuevo service client.
 *
 * Tipo propio del SDK, no alias del contrato: `scopes` acepta cualquier string y es el API quien lo
 * valida contra el catálogo (`SERVICE_CLIENT_SCOPES`).
 */
export type CreateServiceClientInput = {
  /** Slug único del service client (lowercase, sin espacios). */
  slug: string
  /** Nombre descriptivo del service client. Opcional. */
  name?: string
  /** Lista de scopes a asignar. Default: [] en el API. */
  scopes?: string[]
}

/**
 * Resultado de crear un service client.
 * El `secret` solo se devuelve UNA VEZ — guardarlo de inmediato.
 */
export type CreateServiceClientResult = CreateServiceClientResponse['data']

/**
 * Input para actualizar un service client (patch parcial).
 * Al menos un campo debe estar presente. Tipo propio del SDK por la misma razón que
 * {@link CreateServiceClientInput}.
 */
export type UpdateServiceClientInput = {
  enabled?: boolean
  scopes?: string[]
  name?: string
}

/**
 * Resultado de actualizar un service client.
 * Incluye `warning` cuando se modifican los scopes.
 */
export type UpdateServiceClientResult = UpdateServiceClientResponse['data']

/**
 * Resultado de rotar el secret de un service client.
 * El `secret` nuevo solo se devuelve UNA VEZ.
 */
export type RotateSecretResult = RotateServiceClientSecretResponse['data']

/**
 * Resultado de restaurar una cuenta de usuario eliminada.
 * REQ-RESTORE-01 LOCKED.
 *
 * Tipo propio del SDK: `stateAccount` es la unión completa `AccountState`, y en el wire es el único
 * literal `no_verificado`.
 */
export type RestoreUserResult = {
  userId: string
  /** Estado de la cuenta tras la restauración. */
  stateAccount: AccountState
  previouslyDeletedAt: string | null
  restoredAt: string
}

/**
 * Query de `republishPendingWebhooks`. Tipo propio del SDK (como `ListWebhookDeliveriesQuery`):
 * el query del contrato coacciona strings y su tipo de entrada es `unknown`. Los rangos los valida
 * el API (400).
 */
export type RepublishPendingWebhooksQuery = {
  /** Antigüedad mínima en minutos de las entregas `pending` a republicar. Default del API: 10. */
  older_than_minutes?: number
  /** Máximo de entregas por llamada. Default y tope del API: 100. */
  limit?: number
}

/**
 * Resultado de `republishPendingWebhooks`: cuántas entregas se republicaron y si quedan más
 * (`hasMore`: vuelve a llamar). Un 503 `service_unavailable` indica que QStash no aceptó el lote.
 */
export type RepublishPendingWebhooksResult = RepublishPendingResponse['data']

/**
 * Query de `maintenanceCleanup`. Tipo propio del SDK (como {@link RepublishPendingWebhooksQuery}):
 * el rango lo valida el API (400).
 */
export type MaintenanceCleanupQuery = {
  /** Máximo por lote en cada una de las dos limpiezas. Default y tope del API: 100. */
  limit?: number
}

/**
 * Resultado de `maintenanceCleanup`: cuentas `eliminado` purgadas (ventana de restauración vencida),
 * `webhook_events` sin entregas vivas borrados (fuera de la retención) y si queda más (`hasMore`:
 * vuelve a llamar).
 */
export type MaintenanceCleanupResult = MaintenanceCleanupResponse['data']

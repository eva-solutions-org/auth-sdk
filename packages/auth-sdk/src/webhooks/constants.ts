/**
 * Constantes del módulo webhooks.
 *
 * REQ-WH-01, REQ-WH-02 LOCKED: la ventana de tiempo para validar la firma del webhook es de 300
 * segundos (5 minutos), igual que el API.
 *
 * Los tres valores son re-exports del contrato compartido (`@eva_solutions/auth-contracts`, que se
 * empaqueta dentro del SDK): el API y el SDK leen la misma fuente. Este módulo no es alcanzable
 * desde `react`, así que puede importar el barrel del contrato por valor.
 */
export {
  /**
   * Catálogo de event codes que el Auth Service puede emitir en webhooks (REQ-WH-07 LOCKED:
   * 15 event codes).
   */
  EVENT_CODES,
  /**
   * Headers HTTP que el Auth Service incluye en cada webhook entregado, en minúsculas. Usarlos
   * para extraer firma e identificador en el handler receptor.
   *
   * @example
   * ```ts
   * import { WEBHOOK_HEADERS } from '@eva_solutions/auth-sdk/webhooks'
   *
   * const sig = req.headers[WEBHOOK_HEADERS.SIGNATURE]
   * const id  = req.headers[WEBHOOK_HEADERS.ID]
   * ```
   */
  WEBHOOK_HEADERS,
  /**
   * Ventana máxima (en segundos) para aceptar un webhook entrante.
   * Si |now - timestamp| > WEBHOOK_TIMESTAMP_WINDOW_SECONDS → firma rechazada.
   */
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
} from '@eva_solutions/auth-contracts'

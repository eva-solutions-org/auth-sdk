/**
 * Criterio común para una petición en curso que el runtime canceló: en Cloudflare Workers, si la
 * request que la inició termina sin esperarla, su promesa NUNCA se resuelve y su `.finally` no
 * corre. Una petición en curso más vieja que lo que dura un pedido (10 s) más un margen (1 s) se
 * da por huérfana, sin depender de timers (mueren con la request).
 */
export const ORPHAN_AFTER_MS = 11_000

export const isOrphaned = (startedMs: number): boolean =>
  Date.now() - startedMs >= ORPHAN_AFTER_MS

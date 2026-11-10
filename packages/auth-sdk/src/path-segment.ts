/**
 * Valida y codifica un valor para usarlo como UN segmento del path. Retorna `null` si el valor no
 * es un string, es vacío, `.` o `..` (crudo o percent-decodificado, `%2e` en cualquier caso): como
 * los clientes insertan el segmento en la URL (el S2S además firma el pathname normalizado), un
 * valor así redirigiría la request a otro endpoint. `encodeURIComponent` solo no basta: no
 * codifica `.`.
 *
 * El resultado ya está codificado: pásalo tal cual a `apiPath`, que no codifica (codificarlo dos
 * veces convertiría `%` en `%25`).
 */
export function encodePathSegment(value: string): string | null {
  if (typeof value !== 'string') return null
  const isDotSegment = (candidate: string) =>
    candidate === '.' || candidate === '..'
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // percent-encoding malformado: no decodifica a nada peligroso; se codifica tal cual.
  }
  if (value === '' || isDotSegment(value) || isDotSegment(decoded)) return null
  return encodeURIComponent(value)
}

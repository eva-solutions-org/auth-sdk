/**
 * Errores internos del módulo S2S. No se exportan desde el barrel público.
 */

/**
 * El query string tiene percent-encoding malformado (p. ej. `%ZZ`) y no se puede
 * canonicalizar. El firmante la deja propagar con su mensaje claro; el verificador es el
 * único que la captura (la trata como `signature_invalid`) y relanza cualquier otro error.
 */
export class S2SMalformedQueryError extends Error {
  constructor() {
    super('[eva-auth-sdk] s2s: rawQuery inválido (percent-encoding malformado)')
    this.name = 'S2SMalformedQueryError'
  }
}

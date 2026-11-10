import { errors } from 'jose'
import type { JWTVerifyGetKey } from 'jose'

/**
 * Restringe un resolutor de claves a las de un tipo de token. El tipo lo da el prefijo del `kid`
 * (`usr-` usuario, `svc-` servicio): el JWKS publica las dos claves y, sin este filtro, un token
 * firmado con una clave de servicio pasaría por token de usuario (y al revés).
 *
 * Un token sin `kid`, o con un `kid` de otro prefijo, nunca llega al JWKS: se rechaza como "sin clave
 * aplicable". Sin esto jose elegiría por algoritmo cuando el conjunto tiene una sola clave candidata.
 */
export function withKidPrefix(
  resolveKey: JWTVerifyGetKey,
  prefix: string,
): JWTVerifyGetKey {
  return (protectedHeader, token) => {
    const kid = protectedHeader.kid
    if (typeof kid !== 'string' || !kid.startsWith(prefix)) {
      throw new errors.JWKSNoMatchingKey()
    }
    return resolveKey(protectedHeader, token)
  }
}

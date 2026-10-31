/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). Vocabulary of companies shared by the API, the SDK and the products: roles,
 * company and contract states, directions of an authorization listing.
 */

/** Role of a person in a company, from the most to the least powerful. Auth reads it from the DB on every operation. */
export const EMPRESA_ROLES = ['titular', 'administrador', 'miembro'] as const

export type EmpresaRole = (typeof EMPRESA_ROLES)[number]

/** True when `role` is at least `minimum` (`titular` > `administrador` > `miembro`). */
export function empresaRoleAtLeast(
  role: EmpresaRole,
  minimum: EmpresaRole,
): boolean {
  return EMPRESA_ROLES.indexOf(role) <= EMPRESA_ROLES.indexOf(minimum)
}

/** States of a company. A company in `baja` answers 404 to every mutation except `reactivar`. */
export const EMPRESA_ESTADOS = ['activa', 'baja'] as const

export type EmpresaEstado = (typeof EMPRESA_ESTADOS)[number]

/** States of the contract of a product by a company (`empresa_productos.estado`). */
export const CONTRATACION_ESTADOS = [
  'prueba',
  'pendiente_pago',
  'activo',
  'suspendido',
  'cancelado',
] as const

export type ContratacionEstado = (typeof CONTRATACION_ESTADOS)[number]

/**
 * The only states that count as contracted (and only while `hasta` is empty or in the future; Auth
 * evaluates it on every read, no event fires when `hasta` passes).
 */
export const CONTRATACION_ESTADOS_VIGENTES = [
  'prueba',
  'activo',
] as const satisfies readonly ContratacionEstado[]

/** States billing or the Auth admin can write on any contract row (a product only asks for `pendiente_pago` or `cancelado`). */
export const CONTRATACION_ESTADOS_FACTURACION = [
  'prueba',
  'activo',
  'suspendido',
  'cancelado',
] as const satisfies readonly ContratacionEstado[]

/** True when a contract in `estado` counts as contracted, ignoring `hasta`. */
export function isContratacionVigente(estado: ContratacionEstado): boolean {
  return (CONTRATACION_ESTADOS_VIGENTES as readonly string[]).includes(estado)
}

/** Directions of the authorizations listing of a company. */
export const AUTORIZACION_DIRECCIONES = ['otorgadas', 'recibidas'] as const

export type AutorizacionDireccion = (typeof AUTORIZACION_DIRECCIONES)[number]

/** What happens to the previous holder when the Auth admin reassigns the holder of a company. */
export const TITULAR_ANTERIOR_DESTINOS = ['miembro', 'fuera'] as const

export type TitularAnteriorDestino = (typeof TITULAR_ANTERIOR_DESTINOS)[number]

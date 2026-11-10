/**
 * Cliente S2S (service-to-service) para llamar a la API interna del Auth Service desde servicios
 * backend. Autentica cada llamada con `Authorization: Bearer <token de servicio>` (audiencia
 * `auth-api`) que entrega un `ServiceTokenProvider`; ante un 401 invalida el token y reintenta UNA vez.
 *
 * REQ-S2S-01, REQ-S2S-04, REQ-INT-01, REQ-INT-02 LOCKED.
 *
 * Endpoints disponibles:
 *   GET  /internal/users/:id
 *   POST /internal/users/batch
 *   POST /internal/webhooks/subscriptions
 *   GET  /internal/webhooks/subscriptions
 *   GET  /internal/webhooks/subscriptions/:id
 *   PATCH /internal/webhooks/subscriptions/:id
 *   DELETE /internal/webhooks/subscriptions/:id
 *   POST /internal/webhooks/subscriptions/:id/rotate-secret
 *   GET  /internal/webhooks/deliveries
 *   POST /internal/empresas
 *   GET  /internal/empresas/:id
 *   POST /internal/empresas/:id/miembros
 *   DELETE /internal/empresas/:id/miembros/:userId
 *   POST /internal/empresas/:id/sucursales
 *   (fase 2) PATCH /internal/empresas/:id, GET /internal/empresas, POST .../baja|reactivar,
 *   PATCH .../miembros/:userId, PATCH|DELETE .../sucursales/:sucursalId, contratación
 *   (.../productos), grupos (/internal/grupos), directorio (/directorio) y autorizaciones.
 *
 * Los paths salen de `INTERNAL_USER_ROUTES`, `WEBHOOK_ROUTES` e `INTERNAL_EMPRESA_ROUTES`
 * (contrato compartido) vía `apiPath`.
 */

import {
  DIRECTORIO_ROUTES,
  INTERNAL_AUTORIZACION_ROUTES,
  INTERNAL_EMPRESA_ROUTES,
  INTERNAL_GRUPO_ROUTES,
  INTERNAL_USER_ROUTES,
  SUBJECT_TOKEN_HEADER,
  SUBJECT_TOKEN_INVALID_CODE,
  USERS_BATCH_MAX_IDS,
  WEBHOOK_ROUTES,
} from '@eva_solutions/auth-contracts'
import { apiPath } from '../api-path'
import { validateHttpsUrl } from '../config'
import { parseErrorResponse } from '../parse-error-response'
import { encodePathSegment } from '../path-segment'
import type { Result } from '../types'
import { AUTORIZACION_CACHE_TTL_MS } from './constants'
import type {
  S2SClientConfig,
  S2SGetUserResult,
  S2SBatchUsersInput,
  S2SBatchUsersResult,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
  ListWebhookDeliveriesQuery,
  AddEmpresaMemberInput,
  AddGrupoEmpresaInput,
  AutorizacionResult,
  CheckAutorizacionInput,
  CheckAutorizacionResult,
  ContratacionResult,
  ContratadoResult,
  CreateAutorizacionInput,
  CreateEmpresaInput,
  CreateGrupoInput,
  CreateSucursalInput,
  DeactivateSucursalInput,
  DeleteAutorizacionInput,
  DirectorioResult,
  EmpresaEstadoResult,
  EmpresaMemberResult,
  EmpresaResult,
  GetEmpresaResult,
  GrupoResult,
  ListAutorizacionesInput,
  ListAutorizacionesResult,
  ListEmpresasInput,
  ListEmpresasResult,
  RemoveEmpresaMemberInput,
  RemoveGrupoEmpresaInput,
  RenameGrupoInput,
  SearchDirectorioInput,
  SetContratacionInput,
  SubjectTokenInput,
  SucursalResult,
  UpdateEmpresaInput,
  UpdateEmpresaMemberInput,
  UpdateSucursalInput,
} from './types'
import { ServiceTokenRequestError } from './token-provider'
import type {
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
  WebhookDelivery,
  RotateWebhookSecretResult,
} from '../webhooks/types'

/**
 * Tipo del cliente S2S retornado por `createS2SClient`.
 */
export type S2SClient = {
  getUser(userId: string): Promise<Result<S2SGetUserResult>>
  batchUsers(input: S2SBatchUsersInput): Promise<Result<S2SBatchUsersResult>>
  createWebhookSubscription(
    input: CreateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionWithSecret>>
  listWebhookSubscriptions(): Promise<
    Result<{ subscriptions: WebhookSubscription[] }>
  >
  getWebhookSubscription(id: string): Promise<Result<WebhookSubscription>>
  updateWebhookSubscription(
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscription>>
  deleteWebhookSubscription(id: string): Promise<Result<void>>
  rotateWebhookSubscriptionSecret(
    id: string,
  ): Promise<Result<RotateWebhookSecretResult>>
  listWebhookDeliveries(
    query?: ListWebhookDeliveriesQuery,
  ): Promise<Result<{ deliveries: WebhookDelivery[] }>>
  // ----- Empresas (token de servicio + `subjectToken` de la persona donde actúa una persona) -----

  /**
   * Crea una empresa (`empresas:escribir`, el actor necesita `producto`). La persona del
   * `subjectToken` queda como titular y el producto del actor en `prueba`. 409 si el RUC, la razón
   * social o el slug ya existen; 429 si la persona superó el límite de altas.
   */
  createEmpresa(input: CreateEmpresaInput): Promise<Result<EmpresaResult>>
  /** Edita datos maestros, perfil y visibilidad en el directorio (administrador o titular; `empresas:escribir`). */
  updateEmpresa(
    empresaId: string,
    input: UpdateEmpresaInput,
  ): Promise<Result<EmpresaResult>>
  /** Empresas que contrataron el producto del actor, paginadas con `cursor` (`empresas:leer`). */
  listEmpresas(query?: ListEmpresasInput): Promise<Result<ListEmpresasResult>>
  /**
   * Una empresa (`empresas:leer`): vista completa (`vista: 'completa'`) si el actor tiene producto y
   * la empresa lo contrató; recortada (`vista: 'recortada'`, sin contacto ni miembros) si el actor
   * no tiene producto (servicio compartido). 404 si no existe o no la contrató.
   */
  getEmpresa(empresaId: string): Promise<Result<GetEmpresaResult>>
  /** Da de baja una empresa (solo facturación, permiso `empresas:baja`; no lleva persona). */
  bajaEmpresa(empresaId: string): Promise<Result<EmpresaEstadoResult>>
  /** Reactiva una empresa de baja (solo facturación, permiso `empresas:baja`). */
  reactivarEmpresa(empresaId: string): Promise<Result<EmpresaEstadoResult>>
  /** Agrega un miembro como `miembro`; si ya lo es, 409 `conflict` (administrador o titular; `empresas:escribir`). */
  addEmpresaMember(
    empresaId: string,
    input: AddEmpresaMemberInput,
  ): Promise<Result<EmpresaMemberResult>>
  /** Cambia el rol de un miembro (solo titular; `empresas:escribir`). */
  setEmpresaMemberRole(
    empresaId: string,
    userId: string,
    input: UpdateEmpresaMemberInput,
  ): Promise<Result<EmpresaMemberResult>>
  /**
   * Quita un miembro (`empresas:escribir`); si no lo es, 404 `not_found`. Con `userId` igual a la
   * persona del token es salir por cuenta propia (cualquier rol, salvo el último titular).
   */
  removeEmpresaMember(
    empresaId: string,
    userId: string,
    input: RemoveEmpresaMemberInput,
  ): Promise<Result<void>>
  /** Crea una sucursal de la empresa (administrador o titular; `empresas:escribir`). */
  createSucursal(
    empresaId: string,
    input: CreateSucursalInput,
  ): Promise<Result<SucursalResult>>
  /** Edita una sucursal (administrador o titular; `empresas:escribir`). */
  updateSucursal(
    empresaId: string,
    sucursalId: string,
    input: UpdateSucursalInput,
  ): Promise<Result<SucursalResult>>
  /** Baja lógica de una sucursal, `activa = false` (administrador o titular; `empresas:escribir`). */
  deactivateSucursal(
    empresaId: string,
    sucursalId: string,
    input: DeactivateSucursalInput,
  ): Promise<Result<void>>

  // ----- Contratación de productos -----

  /**
   * Pide la contratación del PROPIO producto del actor para una empresa existente
   * (`pendiente_pago`; `contrataciones:pedir`). La persona del `subjectToken` debe ser titular:
   * 404 igual si la empresa no existe o no es titular. Solo si no hay fila o está `cancelado`.
   */
  requestContratacion(
    empresaId: string,
    input: SubjectTokenInput,
  ): Promise<Result<ContratacionResult>>
  /** Cancela la contratación del propio producto (`cancelado`, desde cualquier estado; solo titular). */
  cancelContratacion(
    empresaId: string,
    input: SubjectTokenInput,
  ): Promise<Result<void>>
  /**
   * ¿La empresa tiene contratado ese producto? (`contrataciones:leer`). Para servicios compartidos
   * que atienden llamadas de servicio donde no hay token delegado.
   */
  getContratacion(
    empresaId: string,
    producto: string,
  ): Promise<Result<ContratadoResult>>
  /** Facturación: escribe el estado y el vencimiento de cualquier fila (`contrataciones:escribir`, actor sin producto). */
  setContratacion(
    empresaId: string,
    producto: string,
    input: SetContratacionInput,
  ): Promise<Result<ContratacionResult>>

  // ----- Grupos de empresas (solo titular; `empresas:escribir`) -----

  /** Crea un grupo con una empresa de la persona. */
  createGrupo(input: CreateGrupoInput): Promise<Result<GrupoResult>>
  /** Renombra el grupo (titular de alguna de sus empresas). */
  renameGrupo(
    grupoId: string,
    input: RenameGrupoInput,
  ): Promise<Result<GrupoResult>>
  /** Agrega una empresa de la que la persona es titular. */
  addGrupoEmpresa(
    grupoId: string,
    input: AddGrupoEmpresaInput,
  ): Promise<Result<GrupoResult>>
  /** Quita una empresa del grupo; un grupo que queda vacío se borra solo. */
  removeGrupoEmpresa(
    grupoId: string,
    empresaId: string,
    input: RemoveGrupoEmpresaInput,
  ): Promise<Result<void>>

  // ----- Directorio -----

  /** Busca en el directorio de empresas visibles (`directorio:leer`). Solo campos de perfil público; 50 por página. */
  searchDirectorio(
    query?: SearchDirectorioInput,
  ): Promise<Result<DirectorioResult>>

  // ----- Autorizaciones entre empresas -----

  /** Concede un permiso del catálogo entre empresas a otra empresa (administrador o titular de la otorgante; `autorizaciones:escribir`). 409 si ya está vigente. */
  createAutorizacion(
    otorganteId: string,
    input: CreateAutorizacionInput,
  ): Promise<Result<AutorizacionResult>>
  /** Revoca (otorgante) o renuncia a (beneficiaria) una autorización; administrador o titular (`autorizaciones:escribir`). */
  deleteAutorizacion(
    empresaId: string,
    autorizacionId: string,
    input: DeleteAutorizacionInput,
  ): Promise<Result<void>>
  /** Autorizaciones vigentes de la empresa, `otorgadas` o `recibidas` (administrador o titular; `autorizaciones:leer`). La persona viaja en el header `x-eva-subject-token`. */
  listAutorizaciones(
    empresaId: string,
    input: ListAutorizacionesInput,
  ): Promise<Result<ListAutorizacionesResult>>
  /**
   * ¿La otorgante autorizó ese permiso a la beneficiaria? (`autorizaciones:leer`, solo actores cuya
   * audiencia es dueña del permiso; puede tener además `producto`). Vale solo si las dos empresas están activas.
   *
   * Guarda el resultado 30 s (`AUTORIZACION_CACHE_TTL_MS`) por cliente: una revocación o una baja
   * tardan como máximo eso en notarse. Los errores no se guardan.
   */
  checkAutorizacion(
    input: CheckAutorizacionInput,
  ): Promise<Result<CheckAutorizacionResult>>
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Construye el query string a partir de un objeto de parámetros.
 * Omite valores undefined.
 */
function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      )
    }
  }
  return parts.join('&')
}

function invalidIdResult(method: string): Result<never> {
  return {
    ok: false,
    error: {
      kind: 'sdk',
      reason: 'malformed',
      message: `${method}: id inválido (no puede ser vacío, "." ni "..")`,
      status: 0,
    },
  }
}

/**
 * Codifica cada id como UN segmento del path (`encodePathSegment`). Devuelve los segmentos listos
 * para `apiPath` o, si alguno es vacío, `.` o `..`, el `Result` de error (sin hacer la request).
 */
function encodeSegments<K extends string>(
  method: string,
  values: Record<K, string>,
): Record<K, string> | Result<never> {
  const out = {} as Record<K, string>
  for (const key of Object.keys(values) as K[]) {
    const segment = encodePathSegment(values[key])
    if (segment === null) return invalidIdResult(method)
    out[key] = segment
  }
  return out
}

/** ¿El cuerpo de error es el fallo del token de la persona (`subject_token_invalid`)? */
const isSubjectTokenFailure = (body: unknown): boolean =>
  (body as { error?: { code?: unknown } } | null)?.error?.code ===
  SUBJECT_TOKEN_INVALID_CODE

const isInvalid = (value: object): value is Result<never> => 'ok' in value

/** Entradas que guarda el caché de `checkAutorizacion` antes de soltar las vencidas y luego la más vieja. */
const AUTORIZACION_CACHE_MAX_ENTRIES = 1000

/**
 * Realiza un fetch autenticado con el token de servicio del proveedor. Un 401 invalida el token y
 * reintenta una sola vez con uno nuevo. Retorna `Result<T>` con la propiedad `data` del body.
 */
async function s2sFetch<T>({
  config,
  method,
  pathname,
  rawQuery = '',
  body,
  headers: extraHeaders,
}: {
  config: S2SClientConfig
  method: string
  pathname: string
  rawQuery?: string
  body?: unknown
  /** Headers extra de ESTA llamada (p. ej. la persona en un GET que no tiene body). */
  headers?: Record<string, string>
}): Promise<Result<T>> {
  try {
    const bodyText = body !== undefined ? JSON.stringify(body) : undefined
    const url = rawQuery
      ? `${config.baseUrl}${pathname}?${rawQuery}`
      : `${config.baseUrl}${pathname}`

    let usedToken = ''
    const send = async (): Promise<Response> => {
      const token = await config.tokenProvider.getToken()
      usedToken = token
      return fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...extraHeaders,
          authorization: `Bearer ${token}`,
        },
        body: bodyText,
        signal: AbortSignal.timeout(10_000),
      })
    }

    let res = await send()
    if (res.status === 401) {
      // Solo un 401 del Bearer de servicio descarta el token de servicio. Si Auth dice que el que
      // falló es el token de la PERSONA, el de servicio está bien: no se invalida ni se reintenta.
      const body: unknown = await res.json().catch(() => null)
      if (isSubjectTokenFailure(body)) {
        return { ok: false, error: parseErrorResponse(res.status, body) }
      }
      // El token pudo vencer o revocarse antes de lo que creía el proveedor: se descarta y se
      // reintenta UNA vez. Un segundo 401 es definitivo.
      // Se pasa el token rechazado: con N 401 simultáneos solo el primero descarta; el resto
      // comparte el token renovado en vez de provocar un pedido por cada uno.
      config.tokenProvider.invalidate(usedToken)
      res = await send()
    }

    if (!res.ok) {
      const responseBody = await res.json().catch(() => null)
      return { ok: false, error: parseErrorResponse(res.status, responseBody) }
    }

    // 204 No Content — Result<void>
    if (res.status === 204) {
      return { ok: true, data: undefined as T }
    }

    const json = (await res.json()) as { data: T }
    return { ok: true, data: json.data }
  } catch (err) {
    // El Auth Service rechazó el pedido de token (firma inválida, client deshabilitado, sin
    // concesión): es un error de API con su `error` RFC 6749 como code.
    if (err instanceof ServiceTokenRequestError) {
      return {
        ok: false,
        error: {
          kind: 'api',
          code: err.code,
          message: err.message,
          status: err.status,
        },
      }
    }
    const message = err instanceof Error ? err.message : 'Network error'
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'network',
        message,
        status: 0,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Crea un cliente S2S autenticado para comunicarse con la API interna del Auth Service.
 *
 * @example
 * ```ts
 * const tokenProvider = createServiceTokenProvider({
 *   authUrl: 'https://auth.miapp.com',
 *   clientId: 'mi-servicio',
 *   secretHex: env.AUTH_CLIENT_SECRET_HEX,
 *   audience: 'auth-api',
 * })
 * const s2s = createS2SClient({ baseUrl: 'https://auth.miapp.com', tokenProvider })
 * const result = await s2s.getUser(userId)
 * if (!result.ok) return handleError(result.error)
 * return result.data // perfil del usuario
 * ```
 */
export function createS2SClient(config: S2SClientConfig): S2SClient {
  validateHttpsUrl(config.baseUrl, 'S2SClientConfig.baseUrl')
  // Caché de `checkAutorizacion`: vive en el cliente (un cliente por isolate, como el proveedor).
  const autorizacionCache = new Map<
    string,
    { autorizado: boolean; expiresAtMs: number }
  >()
  return {
    async getUser(userId: string): Promise<Result<S2SGetUserResult>> {
      const segment = encodePathSegment(userId)
      if (segment === null) return invalidIdResult('getUser')
      return s2sFetch<S2SGetUserResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_USER_ROUTES.get, { id: segment }),
      })
    },

    /**
     * Consulta múltiples usuarios por ID en una sola llamada.
     *
     * @param input - Input con la lista de IDs a consultar.
     * @param input.ids - Máximo `USERS_BATCH_MAX_IDS` (100, constante del contrato compartido)
     *   IDs por llamada. El schema del request no lleva ese tope: lo aplica este cliente.
     *   Si se superan, retorna error sin hacer fetch al API.
     */
    async batchUsers(
      input: S2SBatchUsersInput,
    ): Promise<Result<S2SBatchUsersResult>> {
      if (input.ids.length > USERS_BATCH_MAX_IDS) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `batchUsers acepta máximo ${USERS_BATCH_MAX_IDS} IDs por llamada (recibidos: ${input.ids.length})`,
            status: 0,
          },
        }
      }
      return s2sFetch<S2SBatchUsersResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_USER_ROUTES.batch),
        body: input,
      })
    },

    async createWebhookSubscription(
      input: CreateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscriptionWithSecret>> {
      return s2sFetch<WebhookSubscriptionWithSecret>({
        config,
        method: 'POST',
        pathname: apiPath(WEBHOOK_ROUTES.createSubscription),
        body: input,
      })
    },

    async listWebhookSubscriptions(): Promise<
      Result<{ subscriptions: WebhookSubscription[] }>
    > {
      return s2sFetch<{ subscriptions: WebhookSubscription[] }>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.listSubscriptions),
      })
    },

    async getWebhookSubscription(
      id: string,
    ): Promise<Result<WebhookSubscription>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('getWebhookSubscription')
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.getSubscription, { id: segment }),
      })
    },

    async updateWebhookSubscription(
      id: string,
      input: UpdateWebhookSubscriptionInput,
    ): Promise<Result<WebhookSubscription>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('updateWebhookSubscription')
      return s2sFetch<WebhookSubscription>({
        config,
        method: 'PATCH',
        pathname: apiPath(WEBHOOK_ROUTES.updateSubscription, { id: segment }),
        body: input,
      })
    },

    async deleteWebhookSubscription(id: string): Promise<Result<void>> {
      const segment = encodePathSegment(id)
      if (segment === null) return invalidIdResult('deleteWebhookSubscription')
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(WEBHOOK_ROUTES.deleteSubscription, { id: segment }),
      })
    },

    async rotateWebhookSubscriptionSecret(
      id: string,
    ): Promise<Result<RotateWebhookSecretResult>> {
      const segment = encodePathSegment(id)
      if (segment === null)
        return invalidIdResult('rotateWebhookSubscriptionSecret')
      return s2sFetch<RotateWebhookSecretResult>({
        config,
        method: 'POST',
        pathname: apiPath(WEBHOOK_ROUTES.rotateSubscriptionSecret, {
          id: segment,
        }),
      })
    },

    async listWebhookDeliveries(
      query?: ListWebhookDeliveriesQuery,
    ): Promise<Result<{ deliveries: WebhookDelivery[] }>> {
      if (
        query?.limit !== undefined &&
        (query.limit < 1 || query.limit > 100)
      ) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `listWebhookDeliveries: limit debe estar entre 1 y 100 (recibido: ${query.limit})`,
            status: 0,
          },
        }
      }
      if (query?.offset !== undefined && query.offset < 0) {
        return {
          ok: false,
          error: {
            kind: 'sdk',
            reason: 'malformed',
            message: `listWebhookDeliveries: offset no puede ser negativo (recibido: ${query.offset})`,
            status: 0,
          },
        }
      }
      const rawQuery = query
        ? buildQueryString(query as Record<string, string | number | undefined>)
        : ''
      return s2sFetch<{ deliveries: WebhookDelivery[] }>({
        config,
        method: 'GET',
        pathname: apiPath(WEBHOOK_ROUTES.listDeliveries),
        rawQuery,
      })
    },

    async createEmpresa(
      input: CreateEmpresaInput,
    ): Promise<Result<EmpresaResult>> {
      return s2sFetch<EmpresaResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.create),
        body: input,
      })
    },

    async updateEmpresa(
      empresaId: string,
      input: UpdateEmpresaInput,
    ): Promise<Result<EmpresaResult>> {
      const seg = encodeSegments('updateEmpresa', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<EmpresaResult>({
        config,
        method: 'PATCH',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.update, seg),
        body: input,
      })
    },

    async listEmpresas(
      query?: ListEmpresasInput,
    ): Promise<Result<ListEmpresasResult>> {
      return s2sFetch<ListEmpresasResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.list),
        rawQuery: query ? buildQueryString({ ...query }) : '',
      })
    },

    async getEmpresa(empresaId: string): Promise<Result<GetEmpresaResult>> {
      const seg = encodeSegments('getEmpresa', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<GetEmpresaResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.get, seg),
      })
    },

    async bajaEmpresa(empresaId: string): Promise<Result<EmpresaEstadoResult>> {
      const seg = encodeSegments('bajaEmpresa', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<EmpresaEstadoResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.baja, seg),
      })
    },

    async reactivarEmpresa(
      empresaId: string,
    ): Promise<Result<EmpresaEstadoResult>> {
      const seg = encodeSegments('reactivarEmpresa', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<EmpresaEstadoResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.reactivar, seg),
      })
    },

    async addEmpresaMember(
      empresaId: string,
      input: AddEmpresaMemberInput,
    ): Promise<Result<EmpresaMemberResult>> {
      const seg = encodeSegments('addEmpresaMember', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<EmpresaMemberResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.addMember, seg),
        body: input,
      })
    },

    async setEmpresaMemberRole(
      empresaId: string,
      userId: string,
      input: UpdateEmpresaMemberInput,
    ): Promise<Result<EmpresaMemberResult>> {
      const seg = encodeSegments('setEmpresaMemberRole', {
        id: empresaId,
        userId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<EmpresaMemberResult>({
        config,
        method: 'PATCH',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.updateMember, seg),
        body: input,
      })
    },

    async removeEmpresaMember(
      empresaId: string,
      userId: string,
      input: RemoveEmpresaMemberInput,
    ): Promise<Result<void>> {
      const seg = encodeSegments('removeEmpresaMember', {
        id: empresaId,
        userId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.removeMember, seg),
        body: input,
      })
    },

    async createSucursal(
      empresaId: string,
      input: CreateSucursalInput,
    ): Promise<Result<SucursalResult>> {
      const seg = encodeSegments('createSucursal', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<SucursalResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.createBranch, seg),
        body: input,
      })
    },

    async updateSucursal(
      empresaId: string,
      sucursalId: string,
      input: UpdateSucursalInput,
    ): Promise<Result<SucursalResult>> {
      const seg = encodeSegments('updateSucursal', {
        id: empresaId,
        sucursalId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<SucursalResult>({
        config,
        method: 'PATCH',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.updateBranch, seg),
        body: input,
      })
    },

    async deactivateSucursal(
      empresaId: string,
      sucursalId: string,
      input: DeactivateSucursalInput,
    ): Promise<Result<void>> {
      const seg = encodeSegments('deactivateSucursal', {
        id: empresaId,
        sucursalId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.deactivateBranch, seg),
        body: input,
      })
    },

    async requestContratacion(
      empresaId: string,
      input: SubjectTokenInput,
    ): Promise<Result<ContratacionResult>> {
      const seg = encodeSegments('requestContratacion', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<ContratacionResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.requestContratacion, seg),
        body: input,
      })
    },

    async cancelContratacion(
      empresaId: string,
      input: SubjectTokenInput,
    ): Promise<Result<void>> {
      const seg = encodeSegments('cancelContratacion', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.cancelContratacion, seg),
        body: input,
      })
    },

    async getContratacion(
      empresaId: string,
      producto: string,
    ): Promise<Result<ContratadoResult>> {
      const seg = encodeSegments('getContratacion', { id: empresaId, producto })
      if (isInvalid(seg)) return seg
      return s2sFetch<ContratadoResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.getContratacion, seg),
      })
    },

    async setContratacion(
      empresaId: string,
      producto: string,
      input: SetContratacionInput,
    ): Promise<Result<ContratacionResult>> {
      const seg = encodeSegments('setContratacion', { id: empresaId, producto })
      if (isInvalid(seg)) return seg
      return s2sFetch<ContratacionResult>({
        config,
        method: 'PUT',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.setContratacion, seg),
        body: input,
      })
    },

    async createGrupo(input: CreateGrupoInput): Promise<Result<GrupoResult>> {
      return s2sFetch<GrupoResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_GRUPO_ROUTES.create),
        body: input,
      })
    },

    async renameGrupo(
      grupoId: string,
      input: RenameGrupoInput,
    ): Promise<Result<GrupoResult>> {
      const seg = encodeSegments('renameGrupo', { id: grupoId })
      if (isInvalid(seg)) return seg
      return s2sFetch<GrupoResult>({
        config,
        method: 'PATCH',
        pathname: apiPath(INTERNAL_GRUPO_ROUTES.rename, seg),
        body: input,
      })
    },

    async addGrupoEmpresa(
      grupoId: string,
      input: AddGrupoEmpresaInput,
    ): Promise<Result<GrupoResult>> {
      const seg = encodeSegments('addGrupoEmpresa', { id: grupoId })
      if (isInvalid(seg)) return seg
      return s2sFetch<GrupoResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_GRUPO_ROUTES.addEmpresa, seg),
        body: input,
      })
    },

    async removeGrupoEmpresa(
      grupoId: string,
      empresaId: string,
      input: RemoveGrupoEmpresaInput,
    ): Promise<Result<void>> {
      const seg = encodeSegments('removeGrupoEmpresa', {
        id: grupoId,
        empresaId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_GRUPO_ROUTES.removeEmpresa, seg),
        body: input,
      })
    },

    async searchDirectorio(
      query?: SearchDirectorioInput,
    ): Promise<Result<DirectorioResult>> {
      return s2sFetch<DirectorioResult>({
        config,
        method: 'GET',
        pathname: apiPath(DIRECTORIO_ROUTES.search),
        rawQuery: query ? buildQueryString({ ...query }) : '',
      })
    },

    async createAutorizacion(
      otorganteId: string,
      input: CreateAutorizacionInput,
    ): Promise<Result<AutorizacionResult>> {
      const seg = encodeSegments('createAutorizacion', { id: otorganteId })
      if (isInvalid(seg)) return seg
      return s2sFetch<AutorizacionResult>({
        config,
        method: 'POST',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.createAutorizacion, seg),
        body: input,
      })
    },

    async deleteAutorizacion(
      empresaId: string,
      autorizacionId: string,
      input: DeleteAutorizacionInput,
    ): Promise<Result<void>> {
      const seg = encodeSegments('deleteAutorizacion', {
        id: empresaId,
        autorizacionId,
      })
      if (isInvalid(seg)) return seg
      return s2sFetch<void>({
        config,
        method: 'DELETE',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.deleteAutorizacion, seg),
        body: input,
      })
    },

    async listAutorizaciones(
      empresaId: string,
      input: ListAutorizacionesInput,
    ): Promise<Result<ListAutorizacionesResult>> {
      const seg = encodeSegments('listAutorizaciones', { id: empresaId })
      if (isInvalid(seg)) return seg
      return s2sFetch<ListAutorizacionesResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_EMPRESA_ROUTES.listAutorizaciones, seg),
        rawQuery: buildQueryString({ direccion: input.direccion }),
        headers: { [SUBJECT_TOKEN_HEADER]: input.subjectToken },
      })
    },

    async checkAutorizacion(
      input: CheckAutorizacionInput,
    ): Promise<Result<CheckAutorizacionResult>> {
      const key = `${input.otorgante}|${input.beneficiaria}|${input.permiso}`
      const hit = autorizacionCache.get(key)
      if (hit !== undefined) {
        if (Date.now() < hit.expiresAtMs) {
          return { ok: true, data: { autorizado: hit.autorizado } }
        }
        autorizacionCache.delete(key)
      }
      const result = await s2sFetch<CheckAutorizacionResult>({
        config,
        method: 'GET',
        pathname: apiPath(INTERNAL_AUTORIZACION_ROUTES.verificar),
        rawQuery: buildQueryString({
          otorgante: input.otorgante,
          beneficiaria: input.beneficiaria,
          permiso: input.permiso,
        }),
      })
      if (result.ok) {
        if (autorizacionCache.size >= AUTORIZACION_CACHE_MAX_ENTRIES) {
          const now = Date.now()
          for (const [k, v] of autorizacionCache) {
            if (now >= v.expiresAtMs) autorizacionCache.delete(k)
          }
          if (autorizacionCache.size >= AUTORIZACION_CACHE_MAX_ENTRIES) {
            const oldest = autorizacionCache.keys().next().value
            if (oldest !== undefined) autorizacionCache.delete(oldest)
          }
        }
        autorizacionCache.set(key, {
          autorizado: result.data.autorizado,
          expiresAtMs: Date.now() + AUTORIZACION_CACHE_TTL_MS,
        })
      }
      return result
    },
  }
}

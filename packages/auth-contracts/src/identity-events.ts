import { z } from 'zod'
import { EVENT_CODES } from './event-codes'
import { CONTRATACION_ESTADOS, EMPRESA_ROLES } from './empresa-vocab'

/**
 * SCHEMA module: `data` of the webhook events added by identity phase 2. Ids only: no contact
 * data travels in an event, so the receiver reads what it needs through the API (which applies the
 * contract and role rules). `empresa.*`, `grupo.*` and `autorizacion.*` reach only the clients that
 * contracted the product of the affected company, or have no product.
 */

const empresaId = z.string()

export const empresaEventPayloadSchema = z.object({ empresaId })

export const empresaMemberRoleChangedPayloadSchema = z.object({
  empresaId,
  userId: z.string(),
  rol: z.enum(EMPRESA_ROLES),
})

export const empresaBranchEventPayloadSchema = z.object({
  empresaId,
  sucursalId: z.string(),
})

export const empresaProductChangedPayloadSchema = z.object({
  empresaId,
  producto: z.string(),
  estado: z.enum(CONTRATACION_ESTADOS),
})

/** Phase 1 events: `empresa.member_added` and `empresa.member_removed`. */
export const empresaMemberEventPayloadSchema = z.object({
  empresaId,
  userId: z.string(),
})

export const grupoEventPayloadSchema = z.object({ grupoId: z.string() })

export const grupoMemberEventPayloadSchema = z.object({
  grupoId: z.string(),
  empresaId,
})

export const autorizacionEventPayloadSchema = z.object({
  autorizacionId: z.string(),
  otorganteId: z.string(),
  beneficiariaId: z.string(),
  permiso: z.string(),
})

/** `data` schema of each `empresa.*`, `grupo.*` and `autorizacion.*` event (ids only: no `slug`, no first member), by event code. */
export const IDENTITY_EVENT_PAYLOAD_SCHEMAS = {
  [EVENT_CODES.EMPRESA_CREATED]: empresaEventPayloadSchema,
  [EVENT_CODES.EMPRESA_MEMBER_ADDED]: empresaMemberEventPayloadSchema,
  [EVENT_CODES.EMPRESA_MEMBER_REMOVED]: empresaMemberEventPayloadSchema,
  [EVENT_CODES.EMPRESA_BRANCH_CREATED]: empresaBranchEventPayloadSchema,
  [EVENT_CODES.EMPRESA_UPDATED]: empresaEventPayloadSchema,
  [EVENT_CODES.EMPRESA_DEACTIVATED]: empresaEventPayloadSchema,
  [EVENT_CODES.EMPRESA_REACTIVATED]: empresaEventPayloadSchema,
  [EVENT_CODES.EMPRESA_MEMBER_ROLE_CHANGED]:
    empresaMemberRoleChangedPayloadSchema,
  [EVENT_CODES.EMPRESA_BRANCH_UPDATED]: empresaBranchEventPayloadSchema,
  [EVENT_CODES.EMPRESA_BRANCH_DEACTIVATED]: empresaBranchEventPayloadSchema,
  [EVENT_CODES.EMPRESA_PRODUCT_CHANGED]: empresaProductChangedPayloadSchema,
  [EVENT_CODES.GRUPO_UPDATED]: grupoEventPayloadSchema,
  [EVENT_CODES.GRUPO_MEMBER_ADDED]: grupoMemberEventPayloadSchema,
  [EVENT_CODES.GRUPO_MEMBER_REMOVED]: grupoMemberEventPayloadSchema,
  [EVENT_CODES.AUTORIZACION_GRANTED]: autorizacionEventPayloadSchema,
  [EVENT_CODES.AUTORIZACION_REVOKED]: autorizacionEventPayloadSchema,
} as const

export type EmpresaProductChangedPayload = z.output<
  typeof empresaProductChangedPayloadSchema
>
export type AutorizacionEventPayload = z.output<
  typeof autorizacionEventPayloadSchema
>

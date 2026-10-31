/**
 * PURE module: it must never reference `zod` or any schema module of this package (see
 * `constants.ts`). It is apart from `constants.ts` on purpose: the catalog grows with every
 * feature and the SDK `react` entry imports `constants.ts` (header names), so keeping the event
 * codes here keeps them out of the browser bundle.
 */

/**
 * Event codes of the webhooks the service emits. Each key is the upper-case form of its value
 * (`user.created` -> `USER_CREATED`); the catalog is closed and the API owns what triggers each one.
 */
export const EVENT_CODES = {
  USER_CREATED: 'user.created',
  USER_VERIFIED: 'user.verified',
  USER_LOGIN_SUCCESS: 'user.login_success',
  USER_LOGIN_FAILED: 'user.login_failed',
  SESSION_CREATED: 'session.created',
  SESSION_DELETED: 'session.deleted',
  SESSION_DELETED_ALL: 'session.deleted_all',
  USER_PROFILE_UPDATED: 'user.profile_updated',
  USER_DELETED: 'user.deleted',
  USER_RESTORED: 'user.restored',
  USER_HARD_DELETED: 'user.hard_deleted',
  EMPRESA_CREATED: 'empresa.created',
  EMPRESA_MEMBER_ADDED: 'empresa.member_added',
  EMPRESA_MEMBER_REMOVED: 'empresa.member_removed',
  EMPRESA_BRANCH_CREATED: 'empresa.branch_created',
  EMPRESA_UPDATED: 'empresa.updated',
  EMPRESA_DEACTIVATED: 'empresa.deactivated',
  EMPRESA_REACTIVATED: 'empresa.reactivated',
  EMPRESA_MEMBER_ROLE_CHANGED: 'empresa.member_role_changed',
  EMPRESA_BRANCH_UPDATED: 'empresa.branch_updated',
  EMPRESA_BRANCH_DEACTIVATED: 'empresa.branch_deactivated',
  EMPRESA_PRODUCT_CHANGED: 'empresa.product_changed',
  GRUPO_UPDATED: 'grupo.updated',
  GRUPO_MEMBER_ADDED: 'grupo.member_added',
  GRUPO_MEMBER_REMOVED: 'grupo.member_removed',
  AUTORIZACION_GRANTED: 'autorizacion.granted',
  AUTORIZACION_REVOKED: 'autorizacion.revoked',
} as const

export type EventCode = (typeof EVENT_CODES)[keyof typeof EVENT_CODES]

import { z } from 'zod'
import { ACTIVITY_STATES, PRIVACY_STATES } from './constants'

/**
 * SCHEMA module: the user profile and its update body. The update body is the strict BASE object
 * with no `.refine`, so the API can plug it into `createRoute` without changing the OpenAPI
 * document; the API adds its own rules ("at least one field", "latitude and longitude together").
 */

/** Public profile of a user (allowlist: it carries no internal fields). */
export const publicProfileSchema = z.object({
  id: z.string().meta({ description: 'ID del usuario' }),
  phone: z.string().meta({ description: 'Teléfono del usuario' }),
  name: z.string().nullable().meta({ description: 'Nombre' }),
  lastName: z.string().nullable().meta({ description: 'Apellido' }),
  email: z.string().nullable().meta({ description: 'Correo electrónico' }),
  dni: z.string().nullable().meta({ description: 'Documento de identidad' }),
  stateActivity: z
    .enum(ACTIVITY_STATES)
    .meta({ description: 'Estado de actividad' }),
  statePrivacy: z
    .enum(PRIVACY_STATES)
    .meta({ description: 'Estado de privacidad' }),
  createdAt: z.string().meta({ description: 'Fecha de creación' }),
})

export const profileResponseSchema = z.object({
  data: publicProfileSchema,
})

/** Companies the user belongs to. */
export const companyListResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().meta({ description: 'ID de la empresa' }),
        ruc: z.string().meta({ description: 'RUC de la empresa' }),
        razonSocial: z.string().meta({ description: 'Razón social' }),
        slug: z.string().meta({ description: 'Slug identificador' }),
        direccion: z
          .string()
          .nullable()
          .meta({ description: 'Dirección de la empresa' }),
        celular: z
          .string()
          .nullable()
          .meta({ description: 'Celular de contacto' }),
        email: z.string().nullable().meta({ description: 'Email de contacto' }),
        img: z.string().nullable().meta({ description: 'URL de imagen/logo' }),
      }),
    )
    .meta({ description: 'Lista de empresas' }),
})

/** Update body: strict BASE object, every field optional. */
export const updateUserRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .meta({ description: 'Nombre' }),
    lastName: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .meta({ description: 'Apellido' }),
    // trim + lowercase before validating: what the API stores is already normalized. Uniqueness
    // is case and whitespace insensitive on the database side.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email()
      .nullable()
      .optional()
      .meta({ description: 'Correo electrónico' }),
    // trim + uppercase before validating, like the email: the ID document is stored normalized.
    dni: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(20)
      .nullable()
      .optional()
      .meta({ description: 'Documento de identidad' }),
    address: z
      .string()
      .min(1)
      .max(500)
      .nullable()
      .optional()
      .meta({ description: 'Dirección' }),
    locationLat: z
      .string()
      .regex(/^-?(?:[0-8]?\d(?:\.\d+)?|90(?:\.0+)?)$/, {
        error: 'Formato de latitud inválido',
      })
      .nullable()
      .optional()
      .meta({ description: 'Latitud', example: '-34.6037' }),
    locationLon: z
      .string()
      .regex(/^-?(?:\d{1,2}(?:\.\d+)?|1[0-7]\d(?:\.\d+)?|180(?:\.0+)?)$/, {
        error: 'Formato de longitud inválido',
      })
      .nullable()
      .optional()
      .meta({ description: 'Longitud', example: '-58.3816' }),
  })
  .strict()

export type PublicProfile = z.output<typeof publicProfileSchema>
export type ProfileResponse = z.output<typeof profileResponseSchema>
export type CompanyListResponse = z.output<typeof companyListResponseSchema>
export type Company = CompanyListResponse['data'][number]
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>

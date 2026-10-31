import { z } from 'zod'

/**
 * SCHEMA module: wire schemas of the login flow. Body schemas stay plain strict objects (no
 * `.refine`), so the API can plug them into `createRoute` without changing the OpenAPI document.
 * Metadata uses `.meta()` only. Refresh answers with `loginResponseSchema`; logout with the
 * generic message response from `common.ts`. The refresh header schema is API-owned.
 */

// "00" is the international dialing prefix: `0051999000901` and `51999000901` are the same number.
// It is stripped before the length check so both map to the same E.164 digits (same account, same
// per-number counters). It is stripped ONCE: no E.164 country code starts with 0, so a number that
// still starts with 0 afterwards is rejected (otherwise `000051…` and `51…` would look like
// different accounts).
const INTERNATIONAL_DIALING_PREFIX = /^00/
const VALID_COUNTRY_CODE = /^[1-9]/

const phoneSchema = z
  .string()
  .min(8)
  .max(22)
  .regex(/^\d+$/, { error: 'Solo dígitos permitidos' })
  .transform((val) => val.replace(INTERNATIONAL_DIALING_PREFIX, ''))
  .pipe(
    z
      .string()
      .min(8)
      .max(20)
      .regex(VALID_COUNTRY_CODE, { error: 'Formato internacional inválido' }),
  )
  .meta({
    description: 'Número de teléfono en formato internacional',
    example: '5491155551234',
  })

/**
 * Product slug: same shape as a service client slug. It never equals a service audience; the API
 * checks that with `isServiceAudience`.
 */
export const productoSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{2,63}$/, {
    error: 'producto debe matchear ^[a-z][a-z0-9-]{2,63}$',
  })
  .meta({
    description: 'Producto al que entra la persona',
    example: 'whatsapp-panel',
  })

export const getCodeRequestSchema = z
  .object({
    phone: phoneSchema,
  })
  .strict()

/**
 * The two `challengeId` descriptions (here and in the login request) name no route and no path:
 * route names and prefixes live only in the route descriptors, so a path change never leaves a
 * stale description in the published OpenAPI document.
 */
export const getCodeResponseSchema = z.object({
  data: z.object({
    message: z.string().meta({ description: 'Mensaje de confirmación' }),
    challengeId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .meta({
        description:
          'Identificador opaco del desafío; enviarlo en el login junto con el código. Vence con el código y se invalida con cada get-code nuevo.',
        example: '9f86d081884c7d659a2feaa0c55ad015',
      }),
  }),
})

/** Login body. `challengeId` is lowercase hex and is rejected, never normalized. */
export const loginRequestSchema = z
  .object({
    phone: phoneSchema,
    code: z
      .string()
      .length(6)
      .regex(/^[0-9A-Za-z]+$/, { error: 'Solo dígitos y letras' })
      .transform((val) => val.toUpperCase())
      .meta({
        description: 'Código OTP de 6 caracteres',
        example: 'A1B2C3',
      }),
    producto: productoSlugSchema,
    empresaId: z.string().min(1).max(64).optional().meta({
      description: 'Empresa que queda activa en la sesión (opcional)',
    }),
    challengeId: z
      .string()
      .regex(/^[0-9a-f]{32}$/, { error: 'Formato de challenge inválido' })
      .meta({
        description:
          'challengeId devuelto por la solicitud de código (get-code)',
        example: '9f86d081884c7d659a2feaa0c55ad015',
      }),
    deviceType: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[\x20-\x7E\xA0-\xFF]*$/, {
        error: 'Caracteres de control no permitidos',
      })
      .meta({
        description: 'Tipo de dispositivo (mobile, desktop, tablet)',
        example: 'mobile',
      }),
    // Max sizes are deliberately wide (os/browser 100, userAgent 500): real User-Agents can exceed
    // 200 chars (WebViews, embedded apps). The sessions table already has a UNIQUE constraint that
    // bounds the combinations; truncating here would cause artificial session collisions.
    os: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\x20-\x7E\xA0-\xFF]*$/, {
        error: 'Caracteres de control no permitidos',
      })
      .meta({
        description: 'Sistema operativo del dispositivo',
        example: 'Android 14',
      }),
    browser: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\x20-\x7E\xA0-\xFF]*$/, {
        error: 'Caracteres de control no permitidos',
      })
      .meta({
        description: 'Navegador o aplicación cliente',
        example: 'Chrome 120',
      }),
    userAgent: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[\x20-\x7E\xA0-\xFF]*$/, {
        error: 'Caracteres de control no permitidos',
      })
      .meta({
        description: 'User-Agent completo del cliente',
        example: 'Mozilla/5.0 ...',
      }),
  })
  .strict()

export const loginResponseSchema = z.object({
  data: z.object({
    user: z.object({
      id: z.string().meta({ description: 'ID del usuario' }),
    }),
  }),
})

/** Active company switch body: an id, or `null` to leave the session without one. */
export const setActiveEmpresaRequestSchema = z
  .object({
    empresaId: z.string().min(1).max(64).nullable().meta({
      description: 'Empresa que queda activa, o null para ninguna',
    }),
  })
  .strict()

/** Active company switch answer. The re-issued access token travels in the `x-eva-new-access-token` header; the refresh token does not rotate. */
export const setActiveEmpresaResponseSchema = z.object({
  data: z.object({
    empresaId: z.string().nullable().meta({ description: 'Empresa activa' }),
  }),
})

export type GetCodeRequest = z.input<typeof getCodeRequestSchema>
export type GetCodeResponse = z.output<typeof getCodeResponseSchema>
export type LoginRequest = z.input<typeof loginRequestSchema>
export type LoginResponse = z.output<typeof loginResponseSchema>
export type SetActiveEmpresaRequest = z.input<
  typeof setActiveEmpresaRequestSchema
>
export type SetActiveEmpresaResponse = z.output<
  typeof setActiveEmpresaResponseSchema
>

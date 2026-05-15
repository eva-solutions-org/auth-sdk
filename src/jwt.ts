import { jwtVerify } from 'jose'
import { z, ZodObject } from 'zod'
import type { ZodType } from 'zod'
import { getPublicKey } from './jwks'
import { JWT_CONFIG } from './constants'
import { RESERVED_JWT_CLAIMS } from './jwt-claims'
import type { EvaTokenPayload, Result, EvaSdkError } from './types'

// Shape base que SIEMPRE debe estar en el JWT decodificado.
const BaseClaimsSchema = z.object({
  sub: z.string(),
  sessionId: z.string(),
})

// Set de keys excluidas al construir extrasCandidate.
// Incluye todos los reserved claims RFC/OIDC + las keys del shape base.
// 'id' se agrega como defensa contra colisión si el JWT trae un claim 'id' distinto a sub.
const EXCLUDED_FROM_EXTRAS = new Set<string>([
  ...RESERVED_JWT_CLAIMS,
  'sub',
  'sessionId',
  'id',
])

// WeakMap para cachear validación de schema (no re-inspeccionar por request).
const _schemaValidationCache = new WeakMap<ZodType<unknown>, true>()

/**
 * Valida que el schema no declare claims reservados (RFC 7519 / OIDC Core 1.0)
 * ni claves del shape base (id, sessionId).
 * Lanza Error sincrono con mensaje claro — falla rápido en la primera invocación.
 * Solo se llama dentro del schema branch (zero overhead en path zero-config).
 * Cachea por referencia de schema con WeakMap.
 */
function assertSchemaNoReservedKeys(schema: ZodType<unknown>): void {
  if (_schemaValidationCache.has(schema)) return

  if (schema instanceof ZodObject) {
    for (const key of Object.keys(schema.shape as Record<string, unknown>)) {
      if (EXCLUDED_FROM_EXTRAS.has(key)) {
        throw new Error(
          `extraClaimsSchema declara un claim reservado o del shape base: "${key}". ` +
          `Claims reservados (RFC 7519/8725 + OIDC Core 1.0 §2): ${RESERVED_JWT_CLAIMS.join(', ')}. ` +
          `Shape base del SDK (no permitidos en extraClaimsSchema): id, sessionId.`,
        )
      }
    }
  }
  // Schemas no-ZodObject (refinements, transforms, unions): no se puede inspeccionar
  // estáticamente. extrasCandidate ya viene filtrado de reservados antes del parse,
  // así que un schema que requiera 'exp' fallará por ausencia con mensaje claro de Zod.

  _schemaValidationCache.set(schema, true)
}

export type VerifyAccessTokenOptions<TExtra extends Record<string, unknown>> = {
  extraClaimsSchema?: ZodType<TExtra>
}

export async function verifyAccessToken<TExtra extends Record<string, unknown> = {}>(
  token: string,
  opts: VerifyAccessTokenOptions<TExtra> = {},
): Promise<Result<EvaTokenPayload<TExtra>>> {
  try {
    // 1. Verificar firma + standard claims con jose.
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_CONFIG.ISSUER,
      audience: JWT_CONFIG.AUDIENCE,
    })

    // 2. Validar shape base (sub + sessionId presentes).
    const base = BaseClaimsSchema.safeParse(payload)
    if (!base.success) {
      return {
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'token_invalid',
          message: 'Payload del token inválido',
          status: 401,
        } satisfies EvaSdkError,
      }
    }

    const id = base.data.sub
    const sessionId = base.data.sessionId

    // 3. Path SIN schema → drop everything excepto id/sessionId.
    //    Defense-in-depth: el SDK NO expone claims que no validó.
    if (!opts.extraClaimsSchema) {
      return {
        ok: true,
        data: { id, sessionId } as EvaTokenPayload<TExtra>,
      }
    }

    // 4. Path CON schema:
    //    a) fail-fast si schema declara claims reservados o del shape base (cacheado).
    assertSchemaNoReservedKeys(opts.extraClaimsSchema)

    //    b) construir extrasCandidate: todos los claims del JWT raw EXCEPTO los excluidos.
    const raw = payload as Record<string, unknown>
    const extrasCandidate: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!EXCLUDED_FROM_EXTRAS.has(k)) extrasCandidate[k] = v
    }

    //    c) parse async (cubre refinements/transforms async).
    const parsed = await opts.extraClaimsSchema.safeParseAsync(extrasCandidate)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          kind: 'sdk',
          reason: 'token_invalid',
          message: 'Payload del token inválido (claims extra)',
          status: 401,
        } satisfies EvaSdkError,
      }
    }

    //    d) merge: base + parsed extras.
    return {
      ok: true,
      data: {
        id,
        sessionId,
        ...parsed.data,
      } as EvaTokenPayload<TExtra>,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verificación de token fallida'
    return {
      ok: false,
      error: {
        kind: 'sdk',
        reason: 'token_invalid',
        message,
        status: 401,
      } satisfies EvaSdkError,
    }
  }
}

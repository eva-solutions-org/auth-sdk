import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contract from '../src/index'

const SRC_DIR = join(import.meta.dirname, '..', 'src')

// Distinct schemas carrying `.meta({ example })` in S1: phone, code, challengeId (request),
// deviceType, os, browser, userAgent, challengeId (response). Raise it as slices add schemas so the
// loops below cannot pass vacuously.
const MIN_SCHEMAS_WITH_EXAMPLE = 8

// Exact example strings the API already uses today (`features/auth/domain/schemas.ts`):
// placeholders only, no real phone, id, hostname or URL (REQ-CONTRACT-07).
const ALLOWED_EXAMPLES = new Set([
  '5491155551234',
  'A1B2C3',
  '9f86d081884c7d659a2feaa0c55ad015',
  'mobile',
  'Android 14',
  'Chrome 120',
  'Mozilla/5.0 ...',
])

const REAL_LOOKING = [
  /https?:\/\//i,
  /\b[\w-]+\.(?:com|net|org|io|dev|app|workers\.dev|internal|local)\b/i,
  /@[\w-]+\.[a-z]{2,}/i,
]

/** Walks exported schemas (objects and arrays, recursively) and returns every distinct schema that has an `example` in its metadata. */
const schemasWithExample = (): z.ZodType[] => {
  const found = new Set<z.ZodType>()
  const visit = (schema: unknown): void => {
    if (!(schema instanceof z.ZodType)) return
    if (z.globalRegistry.get(schema)?.example !== undefined) found.add(schema)
    if (schema instanceof z.ZodObject) {
      for (const child of Object.values(schema.shape)) visit(child)
    } else if (schema instanceof z.ZodArray) {
      visit(schema.element)
    }
  }
  for (const value of Object.values(contract as Record<string, unknown>)) {
    visit(value)
  }
  return [...found]
}

describe('contract examples', () => {
  it('no_dot_openapi_in_sources', () => {
    const offenders = readdirSync(SRC_DIR, {
      withFileTypes: true,
      recursive: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => readFileSync(file, 'utf8').includes('.openapi('))

    expect(offenders).toEqual([])
  })

  it('every_meta_example_parses', () => {
    const withExample = schemasWithExample()

    expect(withExample.length).toBeGreaterThanOrEqual(MIN_SCHEMAS_WITH_EXAMPLE)
    for (const schema of withExample) {
      const example = z.globalRegistry.get(schema)?.example
      expect(schema.safeParse(example).success, JSON.stringify(example)).toBe(
        true,
      )
    }
  })

  it('examples_use_placeholders_only', () => {
    const examples = schemasWithExample().map(
      (schema) => z.globalRegistry.get(schema)?.example,
    )

    expect(examples.length).toBeGreaterThanOrEqual(MIN_SCHEMAS_WITH_EXAMPLE)
    for (const example of examples) {
      expect(typeof example).toBe('string')
      expect(ALLOWED_EXAMPLES.has(example as string), String(example)).toBe(
        true,
      )
      for (const pattern of REAL_LOOKING) {
        expect(pattern.test(example as string), String(example)).toBe(false)
      }
    }
  })
})

describe('contract body schemas', () => {
  it('body_schemas_are_plain_objects_without_refine', () => {
    for (const schema of [
      contract.getCodeRequestSchema,
      contract.loginRequestSchema,
    ]) {
      expect(schema).toBeInstanceOf(z.ZodObject)
      expect(schema._zod.def.checks ?? []).toEqual([])
    }

    const sources = readdirSync(SRC_DIR, {
      withFileTypes: true,
      recursive: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    for (const source of sources) {
      expect(source).not.toMatch(/\.(?:refine|superRefine)\(/)
    }
  })
})

const validLogin = {
  phone: '5491155551234',
  code: 'A1B2C3',
  challengeId: '9f86d081884c7d659a2feaa0c55ad015',
  deviceType: 'mobile',
  os: 'Android 14',
  browser: 'Chrome 120',
  userAgent: 'Mozilla/5.0 ...',
}

describe('auth schemas accept and reject (REQ-CONTRACT-10)', () => {
  it('login_get_code_refresh_logout_accept_reject', () => {
    // get-code
    expect(
      contract.getCodeRequestSchema.safeParse({ phone: '5491155551234' })
        .success,
    ).toBe(true)
    expect(
      contract.getCodeRequestSchema.safeParse({ phone: '12ab' }).success,
    ).toBe(false)
    expect(
      contract.getCodeRequestSchema.safeParse({
        phone: '5491155551234',
        extra: 1,
      }).success,
    ).toBe(false)
    expect(
      contract.getCodeResponseSchema.safeParse({
        data: {
          message: 'ok',
          challengeId: '9f86d081884c7d659a2feaa0c55ad015',
        },
      }).success,
    ).toBe(true)
    expect(
      contract.getCodeResponseSchema.safeParse({
        data: { message: 'ok', challengeId: 'NOT-HEX' },
      }).success,
    ).toBe(false)

    // login: 32-hex challengeId accepted, non-hex / uppercase rejected, extra key rejected
    expect(contract.loginRequestSchema.safeParse(validLogin).success).toBe(true)
    expect(
      contract.loginRequestSchema.safeParse({
        ...validLogin,
        challengeId: 'zz86d081884c7d659a2feaa0c55ad015',
      }).success,
    ).toBe(false)
    expect(
      contract.loginRequestSchema.safeParse({
        ...validLogin,
        challengeId: '9F86D081884C7D659A2FEAA0C55AD015',
      }).success,
    ).toBe(false)
    expect(
      contract.loginRequestSchema.safeParse({ ...validLogin, extra: 1 })
        .success,
    ).toBe(false)

    // login normalizes: phone loses the international prefix, code is upper-cased
    const parsed = contract.loginRequestSchema.parse({
      ...validLogin,
      phone: '005491155551234',
      code: 'a1b2c3',
    })
    expect(parsed.phone).toBe('5491155551234')
    expect(parsed.code).toBe('A1B2C3')

    // refresh and login answer with the same response; logout with a message
    expect(
      contract.loginResponseSchema.safeParse({ data: { user: { id: 'u1' } } })
        .success,
    ).toBe(true)
    expect(contract.loginResponseSchema.safeParse({ data: {} }).success).toBe(
      false,
    )
    expect(
      contract.messageResponseSchema.safeParse({ data: { message: 'ok' } })
        .success,
    ).toBe(true)
    expect(
      contract.messageWithCountResponseSchema.safeParse({
        data: { message: 'ok', count: 2 },
      }).success,
    ).toBe(true)
    expect(
      contract.messageWithCountResponseSchema.safeParse({
        data: { message: 'ok' },
      }).success,
    ).toBe(false)
  })

  it('error_response_schema_matches_the_wire', () => {
    expect(
      contract.errorResponseSchema.safeParse({
        error: { code: 'not_found', message: 'x' },
      }).success,
    ).toBe(true)
    expect(
      contract.errorResponseSchema.safeParse({ error: 'legacy string' })
        .success,
    ).toBe(false)
    expect(z.globalRegistry.get(contract.errorResponseSchema)?.id).toBe(
      'ErrorBody',
    )
  })
})

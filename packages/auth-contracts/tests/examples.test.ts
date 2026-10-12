import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contract from '../src/index'

const SRC_DIR = join(import.meta.dirname, '..', 'src')

// Raise from S1 on (first slice that exports schemas with `.meta({ example })`) so the loop
// below cannot pass vacuously once schemas exist.
const MIN_SCHEMAS_WITH_EXAMPLE = 0

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

  it('every_schema_example_parses_with_its_own_schema', () => {
    const withExample = Object.values(
      contract as Record<string, unknown>,
    ).filter(
      (value): value is z.ZodType =>
        value instanceof z.ZodType &&
        z.globalRegistry.get(value)?.example !== undefined,
    )

    expect(withExample.length).toBeGreaterThanOrEqual(MIN_SCHEMAS_WITH_EXAMPLE)
    for (const schema of withExample) {
      expect(
        schema.safeParse(z.globalRegistry.get(schema)?.example).success,
      ).toBe(true)
    }
  })
})

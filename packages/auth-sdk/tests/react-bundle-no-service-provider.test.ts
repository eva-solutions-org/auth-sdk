/**
 * The react entry (the browser) must not carry the service token provider that
 * `configureEvaAuth({ serviceCredentials })` builds on the server entries. Builds the REAL entries
 * with tsdown (same options as `tsdown.config.ts`) and reads the closure of each one.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// Strings of the code (not of the shared contract constants, which chunks may share): the
// provider's own error messages, the signer's, and the server configuration's.
const PROVIDER_MARKERS = [
  'Respuesta de token inválida',
  'rawQuery inválido',
  'serviceCredentials es obligatorio',
]

let out: string

// Text of every file reachable from `entry` through relative imports/requires.
const closureText = (entry: string): string => {
  const seen = new Set<string>()
  const queue = [entry]
  let text = ''
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    text += source
    for (const [, target] of source.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s+|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      queue.push(resolve(dirname(file), target))
    }
  }
  return text
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'react-bundle-'))
  await build({
    config: false,
    cwd: ROOT,
    entry: {
      'react/index': 'src/react/index.ts',
      'root/index': 'src/index.ts',
    },
    outDir: out,
    format: ['esm'],
    dts: false,
    clean: true,
    target: 'es2022',
    treeshake: true,
    logLevel: 'silent',
    outExtensions: () => ({ js: '.js' }),
    outputOptions: {
      codeSplitting: {
        groups: [{ name: 'rolldown-runtime', test: /rolldown\/runtime/ }],
      },
    },
    deps: {
      neverBundle: ['hono', 'react', 'react-dom', '@hono/zod-openapi'],
      alwaysBundle: ['@eva_solutions/auth-contracts'],
    },
  })
}, 60_000)

afterAll(() => {
  rmSync(out, { recursive: true, force: true })
})

describe('react bundle', () => {
  it('has no service token provider in its closure', () => {
    const text = closureText(join(out, 'react/index.js'))
    for (const marker of PROVIDER_MARKERS) {
      expect(text, marker).not.toContain(marker)
    }
  })

  it('the detector can fail: the root entry does carry the provider', () => {
    expect(readdirSync(join(out, 'root'))).toContain('index.js')
    const text = closureText(join(out, 'root/index.js'))
    for (const marker of PROVIDER_MARKERS) {
      expect(text, marker).toContain(marker)
    }
  })

  it('rejects serviceCredentials at runtime', () => {
    const text = closureText(join(out, 'react/index.js'))
    expect(text).toContain('serviceCredentials: server only')
  })
})

import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = join(import.meta.dirname, '..')
const SRC_DIR = join(PACKAGE_ROOT, 'src')

type Manifest = {
  private?: boolean
  version?: string
  type?: string
  sideEffects?: boolean
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const readManifest = (): Manifest =>
  JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as Manifest

const FORBIDDEN_DEPENDENCIES = [
  'hono',
  '@hono/zod-openapi',
  '@asteasolutions/zod-to-openapi',
  'drizzle-orm',
]

// REQ-CONTRACT-14: hostnames/URLs, env-derived values, secrets/peppers, rate-limit thresholds,
// DB access. Header NAMES, windows and the batch max are allowed because none matches these.
const DENYLIST: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'url', pattern: /https?:\/\//i },
  {
    name: 'hostname',
    pattern:
      /\b[\w-]+\.(?:workers\.dev|internal|local|localhost)\b|\blocalhost\b/i,
  },
  { name: 'process.env', pattern: /process\.env/ },
  { name: 'import.meta.env', pattern: /import\.meta\.env/ },
  { name: 'secret-like', pattern: /\b(?:pepper|secret|rate[-_ ]?limit)/i },
  { name: 'drizzle', pattern: /drizzle/i },
]

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))

const scanForDenylist = (dir: string): string[] =>
  sourceFiles(dir).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return DENYLIST.filter(({ pattern }) => pattern.test(text)).map(
      ({ name }) => `${file}: ${name}`,
    )
  })

describe('contract package manifest', () => {
  it('package_manifest_flags_private_esm_sideeffects_peer_zod', () => {
    const manifest = readManifest()

    expect(manifest.private).toBe(true)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.type).toBe('module')
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.peerDependencies?.zod).toBe('^4.4.3')
    expect(manifest.devDependencies?.zod).toBe('4.4.3')
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.'])
    expect(JSON.stringify(manifest.exports)).not.toMatch(/require|\.cjs/)
  })

  it('no_hono_or_zod_openapi_or_drizzle_dependency', () => {
    const manifest = readManifest()
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]

    expect(
      declared.filter((name) => FORBIDDEN_DEPENDENCIES.includes(name)),
    ).toEqual([])

    const importedSpecifiers = sourceFiles(SRC_DIR).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (m) => m[1],
      ),
    )
    expect(
      importedSpecifiers.filter((spec) =>
        FORBIDDEN_DEPENDENCIES.some(
          (name) => spec === name || spec.startsWith(`${name}/`),
        ),
      ),
    ).toEqual([])
  })
})

describe('contract source denylist', () => {
  it('denylist_scan_sources', () => {
    expect(scanForDenylist(SRC_DIR)).toEqual([])
  })

  it('denylist_scan_detects_a_planted_url (negative control)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'planted.ts'),
        "export const host = 'https://auth-dev.example'\n",
      )

      expect(scanForDenylist(temp)).toHaveLength(1)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})

import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as contract from '../src/index'
import {
  ACCOUNT_STATES,
  ACTIVITY_STATES,
  ERROR_CODES,
  HEADERS,
  INTERNAL_HEADERS,
  PRIVACY_STATES,
  USERS_BATCH_MAX_IDS,
  type CoreErrorCode,
} from '../src/constants'
import {
  API_PREFIX,
  AUTH_ROUTES,
  INTERNAL_USER_ROUTES,
  SESSION_ROUTES,
  USER_ROUTES,
} from '../src/routes'

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
  // No `\b`: identifiers glue the term to other words (`clientSecret`, `OTP_PEPPER`, `authRateLimit`,
  // `MAX_RATE_LIMIT`), and `_`/camelCase boundaries are not word boundaries. The wire error code
  // `rate_limited` is a legitimate constant, not a threshold, so `limit` followed by `ed` is allowed
  // except as the `RATE_LIMITED_MAX` threshold name.
  {
    name: 'secret-like',
    pattern: /pepper|secret|rate[-_ ]?limit(?!ed)|rate[-_ ]?limited[-_ ]?max/i,
  },
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

  it('denylist_scan_flags_rate_limit_thresholds_but_not_the_rate_limited_code (negative control)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'allowed.ts'),
        "export const code = 'rate_limited'\n",
      )
      expect(scanForDenylist(temp)).toEqual([])

      writeFileSync(join(temp, 'planted.ts'), 'export const rateLimit = 5\n')
      expect(scanForDenylist(temp)).toHaveLength(1)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it.each([
    'clientSecret',
    'otpSecret',
    'OTP_PEPPER',
    'authPepper',
    'authRateLimit',
    'AUTH_RATE_LIMIT',
    'MAX_RATE_LIMIT',
    'RATE_LIMITED_MAX',
  ])('denylist_flags_glued_term_%s (negative control)', (identifier) => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'planted.ts'),
        `export const ${identifier} = 1\n`,
      )

      expect(scanForDenylist(temp)).toHaveLength(1)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('denylist_allows_the_rate_limited_code_in_every_legitimate_spelling', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'allowed.ts'),
        "export const ERROR_CODES = { rate_limited: 'rate_limited' }\nexport const c = ERROR_CODES.rate_limited\n",
      )

      expect(scanForDenylist(temp)).toEqual([])
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})

// Wire values copied from the API sources (`src/core/constants/{error-codes,headers,internal-headers}.ts`).
// HEADERS here has 4 entries: the API adds `CF_CONNECTING_IP` on top, it is not a wire contract.
const TODAY_ERROR_CODES = {
  account_state_locked: 'account_state_locked',
  unauthorized: 'unauthorized',
  validation_error: 'validation_error',
  not_found: 'not_found',
  conflict: 'conflict',
  forbidden: 'forbidden',
  rate_limited: 'rate_limited',
  gone: 'gone',
  unprocessable_entity: 'unprocessable_entity',
  bad_request: 'bad_request',
  internal_error: 'internal_error',
  service_unavailable: 'service_unavailable',
}

const TODAY_HEADERS = {
  AUTHORIZATION: 'authorization',
  REFRESH_TOKEN: 'x-eva-refresh-token',
  NEW_ACCESS_TOKEN: 'x-eva-new-access-token',
  NEW_REFRESH_TOKEN: 'x-eva-new-refresh-token',
}

const TODAY_INTERNAL_HEADERS = {
  X_EVA_CLIENT_ID: 'x-eva-client-id',
  X_EVA_TIMESTAMP: 'x-eva-timestamp',
  X_EVA_NONCE: 'x-eva-nonce',
  X_EVA_SIGNATURE: 'x-eva-signature',
  X_EVA_SERVER_TIME: 'x-eva-server-time',
}

describe('contract wire constants (REQ-CONTRACT-08)', () => {
  it('wire_values_equal_today', () => {
    expect({ ...ERROR_CODES }).toEqual(TODAY_ERROR_CODES)
    expect({ ...HEADERS }).toEqual(TODAY_HEADERS)
    expect({ ...INTERNAL_HEADERS }).toEqual(TODAY_INTERNAL_HEADERS)
    expect(Object.keys(ERROR_CODES)).toHaveLength(12)
  })

  it('error_codes_are_key_equal_value', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key)
    }
    const code: CoreErrorCode = ERROR_CODES.not_found
    expect(code).toBe('not_found')
  })

  it('barrel_re_exports_the_constants', () => {
    expect(contract.ERROR_CODES).toBe(ERROR_CODES)
    expect(contract.HEADERS).toBe(HEADERS)
    expect(contract.INTERNAL_HEADERS).toBe(INTERNAL_HEADERS)
  })
})

describe('contract route descriptors (REQ-CONTRACT-09)', () => {
  it('route_descriptors_relative_and_complete', () => {
    expect(API_PREFIX).toBe('/api/v1')
    expect({ ...AUTH_ROUTES }).toEqual({
      getCode: { method: 'post', path: '/login/get-code' },
      login: { method: 'post', path: '/login' },
      refresh: { method: 'post', path: '/login/refresh' },
      logout: { method: 'post', path: '/login/logout' },
    })
    for (const { path } of Object.values(AUTH_ROUTES)) {
      expect(path.startsWith('/')).toBe(true)
      expect(path.startsWith(API_PREFIX)).toBe(false)
    }
  })

  it('user_session_internal_user_descriptors_relative_and_complete', () => {
    expect({ ...USER_ROUTES }).toEqual({
      get: { method: 'get', path: '/user' },
      update: { method: 'patch', path: '/user' },
      deactivate: { method: 'delete', path: '/user' },
      listCompanies: { method: 'get', path: '/user/empresas' },
    })
    expect({ ...SESSION_ROUTES }).toEqual({
      list: { method: 'get', path: '/sessions' },
      deleteOne: { method: 'delete', path: '/sessions/{id}' },
      deleteAll: { method: 'delete', path: '/sessions' },
    })
    expect({ ...INTERNAL_USER_ROUTES }).toEqual({
      get: { method: 'get', path: '/internal/users/{id}' },
      batch: { method: 'post', path: '/internal/users/batch' },
    })
    for (const { path } of [
      ...Object.values(USER_ROUTES),
      ...Object.values(SESSION_ROUTES),
      ...Object.values(INTERNAL_USER_ROUTES),
    ]) {
      expect(path.startsWith('/')).toBe(true)
      expect(path.startsWith(API_PREFIX)).toBe(false)
    }
  })

  it('barrel_re_exports_the_s2_routes', () => {
    expect(contract.USER_ROUTES).toBe(USER_ROUTES)
    expect(contract.SESSION_ROUTES).toBe(SESSION_ROUTES)
    expect(contract.INTERNAL_USER_ROUTES).toBe(INTERNAL_USER_ROUTES)
  })
})

describe('contract state constants (REQ-CONTRACT-08, D-03)', () => {
  it('account_states_is_object_and_activity_privacy_are_tuples', () => {
    expect({ ...ACCOUNT_STATES }).toEqual({
      no_verificado: 'no_verificado',
      verificado: 'verificado',
      pendiente_de_verificacion: 'pendiente_de_verificacion',
      suspendido: 'suspendido',
      baneado: 'baneado',
      eliminado: 'eliminado',
    })
    expect(Object.keys(ACCOUNT_STATES)).toHaveLength(6)
    for (const [key, value] of Object.entries(ACCOUNT_STATES)) {
      expect(value).toBe(key)
    }

    expect(Array.isArray(ACCOUNT_STATES)).toBe(false)
    expect(Array.isArray(ACTIVITY_STATES)).toBe(true)
    expect(Array.isArray(PRIVACY_STATES)).toBe(true)
    expect([...ACTIVITY_STATES]).toEqual([
      'activo',
      'ausente',
      'ocupado',
      'desconectado',
    ])
    expect([...PRIVACY_STATES]).toEqual(['publico', 'amigos', 'invisible'])
  })

  it('users_batch_max_ids_is_100_and_re_exported', () => {
    expect(USERS_BATCH_MAX_IDS).toBe(100)
    expect(contract.USERS_BATCH_MAX_IDS).toBe(USERS_BATCH_MAX_IDS)
    expect(contract.ACCOUNT_STATES).toBe(ACCOUNT_STATES)
    expect(contract.ACTIVITY_STATES).toBe(ACTIVITY_STATES)
    expect(contract.PRIVACY_STATES).toBe(PRIVACY_STATES)
  })
})

describe('contract export surface (REQ-CONTRACT-13)', () => {
  it('api_only_artifacts_not_exported', () => {
    const names = Object.keys(contract)
    const apiOnly = [
      'refreshTokenHeaderSchema',
      'createRoute',
      'secretFormatSchema',
      'crearErrorResponse',
      'obtenerCodigoSchema',
      'loginSchema',
      'CF_CONNECTING_IP',
      // S2: the refine of the update body, the param schemas and the API-side state constants
      'actualizarUsuarioSchema',
      'actualizarUsuarioBaseSchema',
      'usuarioIdParamSchema',
      'restaurarUsuarioParamsSchema',
      'sessionIdParamSchema',
      'ESTADO_CUENTA',
    ]

    expect(names.filter((name) => apiOnly.includes(name))).toEqual([])
    expect(names.filter((name) => /^createRoute|Router$/.test(name))).toEqual(
      [],
    )
    expect('CF_CONNECTING_IP' in HEADERS).toBe(false)
  })
})

// REQ-CONTRACT-15 (D-35): constants.ts and routes.ts are PURE. The SDK `react` entry imports their
// VALUES; a zod or schema-module import would drag `.meta()` side effects into that closure.
const PURE_MODULES = ['constants', 'routes']

const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/(?:\bfrom|\bimport)\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1] as string,
  )

const purityViolations = (file: string): string[] =>
  importSpecifiers(readFileSync(file, 'utf8')).filter((specifier) => {
    if (!specifier.startsWith('.')) return true // zod or any bare specifier
    const target = specifier.replace(/^\.\//, '').replace(/\.(?:js|ts)$/, '')
    return !PURE_MODULES.includes(target)
  })

describe('contract pure modules (REQ-CONTRACT-15)', () => {
  it('pure_modules_import_no_zod_nor_schema_modules', () => {
    for (const name of PURE_MODULES) {
      expect(purityViolations(join(SRC_DIR, `${name}.ts`))).toEqual([])
    }
  })

  it('purity_scan_flags_a_planted_zod_or_schema_import (negative control)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-purity-'))
    try {
      for (const name of PURE_MODULES) {
        const copy = join(temp, `${name}.ts`)
        writeFileSync(copy, readFileSync(join(SRC_DIR, `${name}.ts`), 'utf8'))
        expect(purityViolations(copy)).toEqual([])

        appendFileSync(copy, "\nimport { z } from 'zod'\n")
        expect(purityViolations(copy)).toEqual(['zod'])

        writeFileSync(copy, readFileSync(join(SRC_DIR, `${name}.ts`), 'utf8'))
        appendFileSync(copy, "\nimport './auth'\n")
        expect(purityViolations(copy)).toEqual(['./auth'])
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})

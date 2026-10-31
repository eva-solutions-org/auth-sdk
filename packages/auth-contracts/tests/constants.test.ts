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
  DELIVERY_STATUSES,
  ERROR_CODES,
  HEADERS,
  INTERNAL_HEADERS,
  PRIVACY_STATES,
  USERS_BATCH_MAX_IDS,
  WEBHOOK_HEADERS,
  WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
  type CoreErrorCode,
} from '../src/constants'
import { EVENT_CODES, type EventCode } from '../src/event-codes'
import { SERVICE_AUDIENCE_SCOPES, type ServiceScope } from '../src/catalog'
import {
  ADMIN_ROUTES,
  API_PREFIX,
  AUTH_ROUTES,
  INTERNAL_USER_ROUTES,
  SESSION_ROUTES,
  USER_ROUTES,
  WEBHOOK_ROUTES,
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

// D-IF-3 (S3): the service-client and webhook contracts carry the NAME of a wire field, route and
// schema that hands out a freshly generated key (`secret`, `rotate-secret`, `AdminRotateSecretResponse`).
// None of that is secret material, so the `secret-like` pattern ignores exactly these spellings and
// nothing broader:
//   1. the route tail `rotate-secret` closed by its quote;
//   2. the rotate schema/route/type names: `rotate(Subscription|ServiceClient)Secret[Response[Schema]]`,
//      the creation answer `subscriptionWithSecretResponse[Schema]` and `AdminRotateSecretResponse`
//      (a component id);
//   3. the response property declared as a bare `secret: z.string()` (a schema key, never a value):
//      the lookahead requires the declaration to END on the SAME line with `,` or `}`, so a chained
//      `.default()`/`.meta()`/`.catch()` (even one on the next line) that could smuggle a value fails.
// Anything else (`clientSecret`, `secret: 'abc'`, any "secret"/"secreto" in a description, peppers,
// keys) still fails. Known limit of a denylist by NAME: a tolerated name reused as an identifier for
// a value (`export const rotateServiceClientSecret = 'x'`) passes; a test below pins it on purpose.
const SECRET_WIRE_NAMES: ReadonlyArray<RegExp> = [
  /rotate-secret(?=['"`])/g,
  /\b[rR]otate(?:Subscription|ServiceClient)Secret(?:Response(?:Schema)?)?\b/g,
  /\b[sS]ubscriptionWithSecretResponse(?:Schema)?\b/g,
  /\bAdminRotateSecretResponse\b/g,
  /\bsecret:\s*z\.string\(\)(?=[ \t]*[,}])/g,
]

function tolerateSecretWireNames(text: string): string {
  return SECRET_WIRE_NAMES.reduce(
    (current, pattern) => current.replace(pattern, ''),
    text,
  )
}

// REQ-CONTRACT-14: hostnames/URLs, env-derived values, secrets/peppers, rate-limit thresholds,
// DB access. Header NAMES, windows and the batch max are allowed because none matches these.
const DENYLIST: ReadonlyArray<{
  name: string
  pattern: RegExp
  // Removes the exact spellings the contract legitimately carries before the pattern runs.
  tolerate?: (text: string) => string
}> = [
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
    tolerate: tolerateSecretWireNames,
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
    return DENYLIST.filter(({ pattern, tolerate }) =>
      pattern.test(tolerate ? tolerate(text) : text),
    ).map(({ name }) => `${file}: ${name}`)
  })

describe('contract package manifest', () => {
  it('package_manifest_flags_private_esm_sideeffects_peer_zod', () => {
    const manifest = readManifest()

    expect(manifest.private).toBe(true)
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.type).toBe('module')
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.peerDependencies?.zod).toBe('^4.6.7')
    expect(manifest.devDependencies?.zod).toBe('4.6.7')
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

  it('denylist_tolerates_the_secret_wire_names (D-IF-3)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'allowed.ts'),
        [
          "export const route = '/x/{id}/rotate-secret'",
          'export const rotateServiceClientSecretResponseSchema = z.object({',
          '  secret: z.string(),',
          '})',
          'export type RotateSubscriptionSecretResponse = 1',
          'export const subscriptionWithSecretResponseSchema = 1',
          'export type SubscriptionWithSecretResponse = 1',
          "const a = z.string().meta({ id: 'AdminRotateSecretResponse' })",
          'const inline = { secret: z.string() }',
        ].join('\n'),
      )

      expect(scanForDenylist(temp)).toEqual([])
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'a secret VALUE under the tolerated key',
      "const o = { secret: 'abc123' }",
    ],
    ['a glued identifier', 'export const rotateSecretKey = 1'],
    ['the Spanish word outside a description', "export const secreto = 'x'"],
    ['the Spanish word in an identifier', 'export const secretoReal = 1'],
    [
      'the Spanish word inside a description',
      "const d = z.string().meta({ description: 'secreto x' })",
    ],
    [
      'the tolerated key with a default value',
      "const o = { secret: z.string().default('x') }",
    ],
    [
      'the tolerated key with a meta example',
      "const o = { secret: z.string().meta({ example: 'x' }) }",
    ],
    [
      'the tolerated key with a catch value',
      "const o = { secret: z.string().catch('x') }",
    ],
    [
      'the tolerated key with a chained default on the next line',
      "const o = {\n  secret: z.string()\n    .default('x'),\n}",
    ],
    [
      'the tolerated key with a chained default on the next line (CRLF)',
      "const o = {\r\n  secret: z.string()\r\n    .default('x'),\r\n}",
    ],
    [
      'the English word inside a description',
      "const d = z.string().meta({ description: 'the client secret' })",
    ],
    [
      'a pepper in a description',
      "const d = { description: 'pepper del OTP' }",
    ],
    [
      'env access next to a tolerated name',
      'export const rotate = process.env.X',
    ],
    ['an unclosed rotate route', "export const p = '/x/rotate-secret-key'"],
  ])(
    'denylist_still_flags_real_secret_material_%s (negative control, D-IF-3)',
    (_label, source) => {
      const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
      try {
        writeFileSync(join(temp, 'planted.ts'), `${source}\n`)

        expect(scanForDenylist(temp)).toHaveLength(1)
      } finally {
        rmSync(temp, { recursive: true, force: true })
      }
    },
  )

  it('denylist_known_limit_a_tolerated_name_reused_as_a_value_identifier_passes (documented, D-IF-3)', () => {
    const temp = mkdtempSync(join(tmpdir(), 'auth-contracts-denylist-'))
    try {
      writeFileSync(
        join(temp, 'known-limit.ts'),
        "export const rotateServiceClientSecret = 'x'\n",
      )

      expect(scanForDenylist(temp)).toEqual([])
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
      setActiveEmpresa: { method: 'post', path: '/auth/empresa-activa' },
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

// Copied from API `src/features/webhooks/domain/event-codes.ts` (order included).
const TODAY_EVENT_CODES = {
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
}

describe('contract webhook and service client constants (REQ-CONTRACT-08, REQ-CONTRACT-12)', () => {
  it('s3_constants_equal_today', () => {
    expect({ ...EVENT_CODES }).toEqual(TODAY_EVENT_CODES)
    expect(Object.keys(EVENT_CODES)).toEqual(Object.keys(TODAY_EVENT_CODES))
    expect(Object.keys(EVENT_CODES)).toHaveLength(27)
    // Webhook headers as the SDK receiver reads them (lowercase names; the API sends mixed case).
    expect({ ...WEBHOOK_HEADERS }).toEqual({
      SIGNATURE: 'x-eva-webhook-signature',
      ID: 'x-eva-webhook-id',
      TIMESTAMP: 'x-eva-webhook-timestamp',
    })
    expect(WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBe(300)
    // Exact order of the audience catalog; the other tests in identity-phase1 pin the semantics.
    expect(SERVICE_AUDIENCE_SCOPES['auth-api']).toEqual([
      'users:read',
      'webhooks:read',
      'webhooks:write',
      'empresas:leer',
      'empresas:escribir',
      'tokens:exchange',
      'contrataciones:pedir',
      'contrataciones:escribir',
      'contrataciones:leer',
      'empresas:baja',
      'autorizaciones:escribir',
      'autorizaciones:leer',
      'directorio:leer',
    ])
    expect(Array.isArray(DELIVERY_STATUSES)).toBe(true)
    expect([...DELIVERY_STATUSES]).toEqual([
      'pending',
      'delivering',
      'success',
      'expired',
    ])

    const code: EventCode = EVENT_CODES.USER_CREATED
    const scope: ServiceScope<'auth-api'> =
      SERVICE_AUDIENCE_SCOPES['auth-api'][0]
    expect([code, scope]).toEqual(['user.created', 'users:read'])
  })

  it('s3_constants_are_re_exported_by_the_barrel', () => {
    expect(contract.EVENT_CODES).toBe(EVENT_CODES)
    expect(contract.WEBHOOK_HEADERS).toBe(WEBHOOK_HEADERS)
    expect(contract.WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBe(
      WEBHOOK_TIMESTAMP_WINDOW_SECONDS,
    )
    expect(contract.SERVICE_AUDIENCE_SCOPES).toBe(SERVICE_AUDIENCE_SCOPES)
    expect(contract.DELIVERY_STATUSES).toBe(DELIVERY_STATUSES)
    expect(contract.WEBHOOK_ROUTES).toBe(WEBHOOK_ROUTES)
    expect(contract.ADMIN_ROUTES).toBe(ADMIN_ROUTES)
  })

  it('webhook_and_admin_route_descriptors_relative_and_complete', () => {
    expect({ ...WEBHOOK_ROUTES }).toEqual({
      createSubscription: {
        method: 'post',
        path: '/internal/webhooks/subscriptions',
      },
      listSubscriptions: {
        method: 'get',
        path: '/internal/webhooks/subscriptions',
      },
      getSubscription: {
        method: 'get',
        path: '/internal/webhooks/subscriptions/{id}',
      },
      updateSubscription: {
        method: 'patch',
        path: '/internal/webhooks/subscriptions/{id}',
      },
      deleteSubscription: {
        method: 'delete',
        path: '/internal/webhooks/subscriptions/{id}',
      },
      rotateSubscriptionSecret: {
        method: 'post',
        path: '/internal/webhooks/subscriptions/{id}/rotate-secret',
      },
      listDeliveries: { method: 'get', path: '/internal/webhooks/deliveries' },
    })
    expect({ ...ADMIN_ROUTES }).toEqual({
      createServiceClient: { method: 'post', path: '/admin/service-clients' },
      listServiceClients: { method: 'get', path: '/admin/service-clients' },
      getServiceClient: {
        method: 'get',
        path: '/admin/service-clients/{slug}',
      },
      updateServiceClient: {
        method: 'patch',
        path: '/admin/service-clients/{slug}',
      },
      deleteServiceClient: {
        method: 'delete',
        path: '/admin/service-clients/{slug}',
      },
      rotateServiceClientSecret: {
        method: 'post',
        path: '/admin/service-clients/{slug}/rotate-secret',
      },
      listServiceClientGrants: {
        method: 'get',
        path: '/admin/service-clients/{slug}/grants',
      },
      setServiceClientGrant: {
        method: 'put',
        path: '/admin/service-clients/{slug}/grants',
      },
      deleteServiceClientGrant: {
        method: 'delete',
        path: '/admin/service-clients/{slug}/grants/{audience}',
      },
      listServiceClientDelegations: {
        method: 'get',
        path: '/admin/service-clients/{slug}/delegations',
      },
      setServiceClientDelegation: {
        method: 'put',
        path: '/admin/service-clients/{slug}/delegations',
      },
      deleteServiceClientDelegation: {
        method: 'delete',
        path: '/admin/service-clients/{slug}/delegations/{audience}',
      },
      listProductos: { method: 'get', path: '/admin/productos' },
      createProducto: { method: 'post', path: '/admin/productos' },
      updateProducto: { method: 'patch', path: '/admin/productos/{slug}' },
      getProductoPermisosAutorizables: {
        method: 'get',
        path: '/admin/productos/{slug}/permisos-autorizables',
      },
      setProductoPermisosAutorizables: {
        method: 'put',
        path: '/admin/productos/{slug}/permisos-autorizables',
      },
      reassignEmpresaTitular: {
        method: 'post',
        path: '/admin/empresas/{id}/titular',
      },
      bajaEmpresa: { method: 'post', path: '/admin/empresas/{id}/baja' },
      reactivarEmpresa: {
        method: 'post',
        path: '/admin/empresas/{id}/reactivar',
      },
      setContratacion: {
        method: 'put',
        path: '/admin/empresas/{id}/productos/{producto}',
      },
      restoreUser: { method: 'post', path: '/admin/users/{id}/restore' },
      republishPendingWebhooks: {
        method: 'post',
        path: '/admin/webhooks/republish-pending',
      },
      maintenanceCleanup: {
        method: 'post',
        path: '/admin/maintenance/cleanup',
      },
    })
    expect(Object.keys(WEBHOOK_ROUTES)).toHaveLength(7)
    expect(Object.keys(ADMIN_ROUTES)).toHaveLength(24)
    for (const { path } of [
      ...Object.values(WEBHOOK_ROUTES),
      ...Object.values(ADMIN_ROUTES),
    ]) {
      expect(path.startsWith('/')).toBe(true)
      expect(path.startsWith(API_PREFIX)).toBe(false)
    }
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
      // S3: the refine of the admin update body, the param schemas, the API-side delivery enum
      'actualizarAdminClientInputSchema',
      'crearAdminClientInputSchema',
      'slugParamSchema',
      'slugSchema',
      'webhookIdParamSchema',
      'DELIVERY_STATUS',
      'ADMIN_HEADERS',
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
const PURE_MODULES = [
  'catalog',
  'constants',
  'empresa-vocab',
  'event-codes',
  'routes',
  'tokens',
]

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

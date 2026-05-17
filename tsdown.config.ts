/**
 * tsdown configuration for building the SDK.
 *
 * NOTE: `envUrls` values below are PLACEHOLDERS for build-time defaults.
 * Consumers configure their actual Auth Service URL at runtime via
 * `configureEvaAuth({ apiUrl: '...' })`. These values are NEVER used by
 * published packages — they exist only to provide build-time defaults for
 * local development of this SDK.
 */
import { defineConfig } from 'tsdown'

const env = (process.env.EVA_BUILD_ENV ?? 'production') as 'local' | 'development' | 'production'

const envUrls: Record<string, string> = {
  local: 'http://localhost:4000',
  development: 'https://auth-dev.example.com',
  production: 'https://auth.example.com',
}

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/hono/index.ts',
    'src/generic/index.ts',
    'src/react/index.ts',
    'src/hono-openapi/index.ts',
    'src/webhooks/index.ts',
    'src/admin/index.ts',
    'src/s2s/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  treeshake: true,
  // splitting: not a tsdown option — Rolldown handles it automatically with multiple entries
  // outExtensions: force .js/.d.ts for ESM (package.json "type":"module" would default to .mjs/.d.mts)
  // and .cjs/.d.cts for CJS — matching the exports map exactly.
  outExtensions: ({ format }) =>
    format === 'cjs' ? { js: '.cjs', dts: '.d.cts' } : { js: '.js', dts: '.d.ts' },
  deps: {
    neverBundle: ['hono', 'react', 'react-dom', '@hono/zod-openapi'],
  },
  define: {
    __EVA_AUTH_URL__: JSON.stringify(envUrls[env]),
    __EVA_ENV__: JSON.stringify(env),
  },
})

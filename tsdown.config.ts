/**
 * tsdown configuration for building the SDK.
 *
 * NOTE: `envUrls` values below define the Auth Service URL baked into each
 * build variant. The URL is a BUILD-TIME constant — not configurable at runtime.
 * Select the variant with EVA_BUILD_ENV=local|development|production at build time.
 * These PLACEHOLDER values are replaced with real URLs in the published packages.
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

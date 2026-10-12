import { defineConfig } from 'tsdown'

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
    'src/contracts/index.ts',
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
  outputOptions: {
    // Rolldown emits its CJS interop helpers (__toESM...) inside whichever chunk it picks; that
    // made `react/index.cjs` require the `auth-handlers` chunk (schemas, http-client, bowser) for a
    // helper it does not even use. A dedicated chunk keeps the react entry closure small (R-8).
    codeSplitting: { groups: [{ name: 'rolldown-runtime', test: /rolldown\/runtime/ }] },
  },
  deps: {
    neverBundle: ['hono', 'react', 'react-dom', '@hono/zod-openapi'],
    // The contract is private and never published: it must be inlined (JS and d.ts).
    alwaysBundle: ['@eva_solutions/auth-contracts'],
  },
})

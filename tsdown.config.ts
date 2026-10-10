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
})

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  // One dist file per source module: with "sideEffects": false the SDK bundler can drop whole
  // contract modules a given SDK entry does not use (.meta() calls write zod's global registry,
  // so a single bundled file would drag every schema into any chunk that touches the contract).
  unbundle: true,
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  treeshake: true,
  // package.json "type":"module" would default to .mjs/.d.mts; the exports map points at .js/.d.ts.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/hono/index.ts',
    'src/generic/index.ts',
    'src/react/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: true,
  target: 'es2022',
  external: ['hono', 'react', 'react-dom'],
  treeshake: true,
})

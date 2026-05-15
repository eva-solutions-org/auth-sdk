import { defineConfig } from 'tsup'

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
  splitting: true,
  target: 'es2022',
  external: ['hono', 'react', 'react-dom', '@hono/zod-openapi'],
  treeshake: true,
  define: {
    __EVA_AUTH_URL__: JSON.stringify(envUrls[env]),
    __EVA_ENV__: JSON.stringify(env),
  },
})
